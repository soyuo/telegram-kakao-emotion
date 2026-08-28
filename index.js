const config = require('./config.json');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const telegram_bot = require('node-telegram-bot-api');
const crypto = require('crypto');
const sharp = require('sharp');

const EMOTIONS_DIR = path.join(__dirname, 'emotions');

const bot = new telegram_bot(config.BOT_TOKEN, { polling: true });

if (!fs.existsSync(config.STORAGE)) {
    const sourceDir = config.STORAGE.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir);
    }
    fs.writeFileSync(config.STORAGE, '{}', 'utf-8');
}

if (!fs.existsSync(EMOTIONS_DIR)) {
    fs.mkdirSync(EMOTIONS_DIR, { recursive: true });
}

const accounts = JSON.parse(
    String(
        fs.readFileSync(config.STORAGE, 'utf8')
    )
);

const Options = {
    android: {
        version: '26.1.2',
        osVersion: '13',
        apiVersion: '33',
        device: 'SM-T870',
        name: 'Emoticon Tab',
        xvcKey: ['BARD', 'DANTE', 'SIAN']
    },
    win32: {
        version: '26.1.2',
        osVersion: '10',
        apiVersion: '10.0',
        device: '',
        name: 'Emoticon Desktop',
        xvcKey: ['CELINA', 'ANDERSON']
    }
};

const HEX_LIST = "0123456789abcdef";
const BASE64_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const STICKER_EMOJI = '😎';
const CDN_DOWNLOAD_TIMEOUT = 15000;
const CDN_DOWNLOAD_RETRIES = 3;
const CDN_DOWNLOAD_CONCURRENCY = 4;

let saving = false;
let intervals = new Map();
let botProfilePromise;

bot.onText(/^.*$/, async (event) => {
    const userId = event.from.id;
    const chatId = event.chat.id;
    const reply = event.reply_to_message;

    if (typeof event.date === 'number' && (Date.now() / 1000) - event.date > 3) {
        return;
    }

    if (event.text === '/start') {
        bot.sendMessage(chatId,
            `/login - 카카오톡 계정에 로그인합니다.
/account (id) (pwd) (?: android/win32) (duuid?) - 계정을 설정합니다.
/search (keyword) - 이모티콘을 자신의 카카오톡 계정으로 검색합니다.
/create (emotId) - 카카오톡 이모티콘을 스티커팩으로 만듭니다.`);
    }

    if (event.text.startsWith('/create')) {
        const ItemId = event.text.split(' ').slice(1).join(' ');

        if (!accounts[userId]) {
            return bot.sendMessage(chatId, 'Cannot find your account');
        }

        if (!accounts[userId].isLogined) {
            return bot.sendMessage(chatId, 'Your account does not login yet');
        }

        let response;

        try {
            response = await axios.post(
                `https://talk-pilsner.kakao.com/emoticon/api/store/v3/items/${ItemId}`,
                new URLSearchParams({
                    referer: 'one_tap'
                }).toString(),
                {
                    headers: {
                        'Authorization': `${accounts[userId].access_token}-${accounts[userId].duuid}`,
                        'Talk-Agent': `${accounts[userId].platform}/${accounts[userId].version}`,
                        'Talk-Language': 'ko',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
        } catch (err) {
            response = err?.response ?? { error: true };
        }

        const InfoRes = response.data;

        if (InfoRes.reason && InfoRes.reason === 'UNAUTHENTICATED') {
            return bot.sendMessage(chatId, 'Retry after use "/login"');
        }

        if (InfoRes.error) {
            return bot.sendMessage(chatId, "Unavailable error");
        }

        const MetaData = InfoRes.itemMetaInfo.itemMetaData;
        const previewData = InfoRes.itemUnitInfo[0].previewData;

        if (previewData.playPathFormat.endsWith('.mp4')) {
            return bot.sendMessage(chatId, 'mp4 형식 이모티콘은 아직 스티커팩 생성이 지원되지 않아요.');
        }

        const needsDecrypt = ['webp', 'mp4'].some(ext => previewData.playPathFormat.endsWith(ext)); // playPathFormat - dw/2222413.emot_0##.png
        if (false) {

            await bot.sendMessage(chatId, `${MetaData.title} - ${MetaData.name} [${MetaData.duration}]\n${previewData.num}개 (복호화 ${needsDecrypt ? '' : '불'}필요)`);

        }

        const stickerPackLink = buildKakaoEmoticonLink(MetaData);

        await bot.sendMessage(
            chatId,
            `${buildLinkedTitle(MetaData.title, stickerPackLink)} - ${escapeHtml(MetaData.name)} [${escapeHtml(MetaData.duration)}]\n${previewData.num}개 (복호화 ${needsDecrypt ? '' : '불'}필요)`,
            { parse_mode: 'HTML' }
        );
        const playUrls = buildPreviewUrls(previewData.playPathFormat, previewData.num);

        await bot.sendMessage(chatId, '이미지 위치 파악 완료!\n데이터를 가지고 오고 있습니다..\n( 평균 소요 시간: 1분 )');

        let buffers;

        try {
            buffers = await getStickerBuffers(MetaData, previewData, playUrls, needsDecrypt);
        } catch (err) {
            console.error(err);
            return bot.sendMessage(chatId, '이모티콘 다운로드 중 네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
        }

        if (!buffers.length) {
            return bot.sendMessage(chatId, '스티커로 만들 이모티콘 데이터를 찾지 못했어요.');
        }

        await bot.sendMessage(chatId, `데이터를 불러왔어요 (${buffers.length}/${previewData.num})\n스티커팩을 생성중이에요..\n( 평균 소요 시간: 2~3분 )`);

        const stickerSetLink = await createStickerPackFromBuffers(userId, MetaData, buffers);
        return bot.sendMessage(
            chatId,
            `${buildLinkedTitle(`${MetaData.title} - ${MetaData.name}`, escapeHtml(stickerSetLink))}\n이모티콘 생성 완료!`,
            { parse_mode: 'HTML' }
        );
    }

    if (event.text.startsWith('/search')) {
        const Keyword = event.text.split(' ').slice(1).join(' ');

        if (!accounts[userId]) {
            return bot.sendMessage(chatId, 'Cannot find your account');
        }

        if (!accounts[userId].isLogined) {
            return bot.sendMessage(chatId, 'Your account does not login yet');
        }

        let response;

        try {
            response = await axios.post(
                'https://talk-pilsner.kakao.com/emoticon/item_store/search',
                new URLSearchParams({
                    type: Keyword,
                    referer: 'search'
                }).toString(),
                {
                    headers: {
                        'Authorization': `${accounts[userId].access_token}-${accounts[userId].duuid}`,
                        'Talk-Agent': `${accounts[userId].platform}/${accounts[userId].version}`,
                        'Talk-Language': 'ko',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
        } catch (err) {
            response = err?.response ?? { error: true };
        }

        const searchRes = response.data;

        if (searchRes.reason && searchRes.reason === 'UNAUTHENTICATED') {
            return bot.sendMessage(chatId, 'Retry after use "/login"');
        }

        if (searchRes.error) {
            return bot.sendMessage(chatId, "Unavailable error");
        }

        return bot.sendMessage(chatId, `[ '${Keyword}' 상위 검색 결과]\n${searchRes.emoticons.slice(0, 10).map(item => `${item.title} - ${item.item_id}`).join('\n')}`);
    }

    if (event.text.startsWith('/login') && event.text.split(' ').filter(String).length === 1) {
        if (!accounts[userId]) {
            return bot.sendMessage(chatId, 'Cannot find your account');
        }

        if (intervals.has(userId)) {
            return bot.sendMessage(chatId, `${buildName(event.from)} ${intervals.get(userId).passcode}`);
        }

        if (accounts[userId].refresh_token.length > 0) {
            const RefreshRes = await oauth2_login(userId);
            if (RefreshRes.access_token) {
                accounts[userId].access_token = RefreshRes.access_token;
                accounts[userId].refresh_token = RefreshRes.refresh_token;
                saveAccounts();
                return bot.sendMessage(chatId, 'Refreshed Login Info');
            }
            RefreshRes.access_token = '';
            RefreshRes.refresh_token = '';
            RefreshRes.isLogined = false;
            saveAccounts();
        }

        let LoginRes = await login_request(userId);

        if (LoginRes.status === 0) {
            accounts[userId].access_token = LoginRes.access_token;
            accounts[userId].refresh_token = LoginRes.refresh_token;
            accounts[userId].userId = LoginRes.userId;
            accounts[userId].isLogined = true;
            saveAccounts();
            return bot.sendMessage(chatId, 'Logined');
        } else if (LoginRes.status === -100) {
            bot.sendMessage(chatId, 'creating passcode for device registeration');
            if (accounts[userId].platform === 'android') {
                accounts[userId].duuid = randomAndroidSubDeviceUUID();
            } else {
                accounts[userId].duuid = randomWin32SubDeviceUUID();
            }
            const authorization = randomAndroidSubDeviceUUID();
            const PasscodeRes = await generatePasscode(userId, authorization);
            if (!PasscodeRes.passcode) {
                return bot.sendMessage(chatId, 'failed to create passcode');
            }
            let registerRes = await registerDevice(userId, authorization);
            intervals.set(userId, {
                passcode: PasscodeRes.passcode,
                repeat: setInterval(async () => {
                    registerRes = await registerDevice(userId, authorization);
                    if (registerRes.status === -100) {
                        return;
                    }
                    if (registerRes.status === 0) {
                        LoginRes = await login_request(userId);
                        accounts[userId].access_token = LoginRes.access_token;
                        accounts[userId].refresh_token = LoginRes.refresh_token;
                        accounts[userId].userId = LoginRes.userId;
                        accounts[userId].isLogined = true;
                        saveAccounts();
                        await bot.sendMessage(chatId, `${buildName(event.from)} Device Registered!`);
                    }
                    if (registerRes.status !== 0) {
                        await bot.sendMessage(chatId, `${buildName(event.from)} Session Expired`);
                    }
                    clearInterval(intervals.get(userId).repeat);
                    intervals.delete(userId);
                }, 3000)
            });
            await bot.sendMessage(chatId, `${buildName(event.from)} ${PasscodeRes.passcode}`);
        } else {
            delete accounts[userId];
            saveAccounts();
            return bot.sendMessage(chatId, 'Unknown Account');
        }
    }

    if (event.text.startsWith('/account')) {
        let cmd = event.text.split(' ').slice(1);

        if (!cmd) {
            return bot.sendMessage(chatId, 'wrong command using');
        }

        let [email, password, platform, duuid] = cmd;

        if (!email || !password) {
            return bot.sendMessage(chatId, 'email and password are required!');
        }

        if (platform) {
            if (!['android', 'win32'].includes(platform)) {
                platform = 'android';
            }
        }

        if (duuid) {
            if (platform === 'android' && duuid.length !== 40) {
                duuid = randomAndroidSubDeviceUUID();
            } else if (platform === 'win32' && duuid.length !== 88) {
                duuid = randomWin32SubDeviceUUID();
            }
        } else {
            if (platform === 'android') {
                duuid = randomAndroidSubDeviceUUID();
            } else {
                duuid = randomWin32SubDeviceUUID();
            }
        }

        accounts[userId] = {
            email,
            password,
            platform,
            duuid,
            access_token: '',
            refresh_token: '',
            userId: '',
            isLogined: false
        };

        saveAccounts();
        bot.sendMessage(chatId, 'account set');
    }
})

function saveAccounts() {
    if (saving) {
        return saveAccounts();
    }
    saving = true;
    fs.writeFileSync(config.STORAGE, JSON.stringify(accounts, null, 4));
    saving = false;
}

function randomAndroidSubDeviceUUID() {
    return Array.from(
        { length: 40 },
        () => HEX_LIST[~~(Math.random() * 16)]
    ).join("");
}

function randomWin32SubDeviceUUID() {
    return Array.from(
        { length: 86 },
        () => BASE64_LIST[~~(Math.random() * 64)])
        .join('') + '==';
}

function caculateXVCKey(platform, userAgent, email, deviceUuid) {
    const hash = crypto.createHash('sha512');
    if (platform === 'win32') {
        hash.update(`${Options.win32.xvcKey[0]}|${userAgent}|${Options.win32.xvcKey[1]}|${email}|${deviceUuid}`, 'utf8');
    } else {
        hash.update(`${Options.android.xvcKey[0]}|${userAgent}|${Options.android.xvcKey[1]}|${email}|${Options.android.xvcKey[2]}`, 'utf8');
    }
    return hash.digest('hex').substring(0, 16);
}

function createUserAgent(platform) {
    if (platform === 'win32') {
        return `KT/${Options.win32.version} Wd/${Options.win32.osVersion} ko`;
    } else {
        return `KT/${Options.android.version} An/${Options.android.osVersion} ko`;
    }
}

function createHeaders(platform, email, deviceUuid) {
    const userAgent = createUserAgent(platform);
    const xvc = caculateXVCKey(platform, userAgent, email, deviceUuid);
    const AInfo = `${platform}/${Options[platform].version}/ko`;

    return {
        "X-Vc": xvc,
        "User-Agent": userAgent,
        "A": AInfo
    };
}

async function login_request(userId) {
    const account = accounts[userId];
    let response;
    try {
        response = await axios.post(
            `https://katalk.kakao.com/${account.platform}/account/login.json`,
            new URLSearchParams({
                email: account.email,
                password: account.password,
                device_name: Options[account.platform].name,
                device_uuid: account.duuid,
                permanent: 'true',
                forced: 'true'
            }).toString(),
            {
                headers: {
                    ...createHeaders(account.platform, account.email, account.duuid),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
    } catch (err) {
        console.log(err);
        response = err?.response ?? { data: { status: -999 } };
    }
    return response.data;
}

async function oauth2_login(userId) {
    const account = accounts[userId];
    let response;
    try {
        response = await axios.post(
            `https://katalk.kakao.com/${account.platform}/account/oauth2_token.json`,
            new URLSearchParams({
                grant_type: 'refresh_token',
                access_token: account.access_token,
                refresh_token: account.refresh_token
            }).toString(),
            {
                headers: {
                    ...createHeaders(account.platform, account.email, account.duuid),
                    'Authorization': `${account.access_token}-${account.duuid}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
    } catch (err) {
        console.log(err);
        response = err?.response ?? { data: { status: -999 } };
    }
    return response.data;
}

async function generatePasscode(userId, authorization, permanent = true) {
    const account = accounts[userId];
    let response;
    try {
        response = await axios.post(
            `https://katalk.kakao.com/${account.platform}/account/passcodeLogin/generate`,
            {
                email: account.email,
                password: account.password,
                permanent,
                device: {
                    name: Options[account.platform].name,
                    uuid: account.duuid,
                    model: Options[account.platform].device,
                    osVersion: Options[account.platform].apiVersion
                }
            },
            {
                headers: {
                    ...createHeaders(account.platform, account.email, account.duuid),
                    'Authorization': authorization
                }
            }
        );
    } catch (err) {
        console.log(err);
        response = err?.response ?? { data: { status: -999 } };
    }
    return response.data;
}

async function registerDevice(userId, authorization) {
    const account = accounts[userId];
    let response;
    try {
        response = await axios.post(
            `https://katalk.kakao.com/${account.platform}/account/passcodeLogin/registerDevice`,
            {
                email: account.email,
                password: account.password,
                device: {
                    uuid: account.duuid
                }
            },
            {
                headers: {
                    ...createHeaders(account.platform, account.email, account.duuid),
                    'Authorization': authorization
                }
            }
        );
    } catch (err) {
        console.log(err);
        response = err?.response ?? { data: { status: -999 } };
    }
    return response.data;
}

function buildName(user) {
    const displayName = escapeHtml(
        user.username
            ? `@${user.username}`
            : [user.first_name, user.last_name].filter(Boolean).join(' ') || 'user'
    );

    return displayName;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildPreviewUrls(pathFormat, count) {
    const match = pathFormat.match(/#+/);

    if (!match) {
        return Array.from(
            { length: count },
            () => `https://item.kakaocdn.net/${pathFormat}`
        );
    }

    const placeholder = match[0];

    return Array.from({ length: count }, (_, index) => {
        const frame = String(index + 1).padStart(placeholder.length, '0');
        const path = pathFormat.replace(placeholder, frame);

        return `https://item.kakaocdn.net/${path}`;
    });
}

function buildKakaoEmoticonLink(metaData) {
    if (!metaData?.itemCode) {
        return null;
    }

    return `https://e.kakao.com/t/${encodeURIComponent(String(metaData.itemCode))}`;
}

function buildLinkedTitle(title, url) {
    const escapedTitle = escapeHtml(title);

    if (!url) {
        return escapedTitle;
    }

    return `<a href="${escapeHtml(url)}">${escapedTitle}</a>`;
}

async function getBotUsername() {
    if (!botProfilePromise) {
        botProfilePromise = bot.getMe();
    }

    const profile = await botProfilePromise;
    return String(profile.username).toLowerCase();
}

function buildStickerSetName(userId, hashedItemCode, botUsername) {
    const normalizedHashedItemCode = String(hashedItemCode).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'emoticon';
    const unixTimestamp = Math.floor(Date.now() / 1000);
    let setName = `${normalizedHashedItemCode}_${unixTimestamp}_by_${botUsername}`
        .replace(/_+/g, '_')
        .replace(/^[^a-zA-Z]+/, 's');

    if (setName.length > 64) {
        const suffix = `_by_${botUsername}`;
        const prefixLimit = 64 - suffix.length;
        setName = `${setName.slice(0, prefixLimit)}${suffix}`;
    }

    return setName;
}

function createStickerFileOptions(index, extension) {
    const safeExtension = extension === 'png' ? 'png' : 'webp';

    return {
        filename: `sticker_${String(index + 1).padStart(2, '0')}.${safeExtension}`,
        contentType: safeExtension === 'png' ? 'image/png' : 'image/webp'
    };
}

async function downloadBufferWithRetry(url, needsDecrypt, retries = CDN_DOWNLOAD_RETRIES) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const fileResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: CDN_DOWNLOAD_TIMEOUT
            });

            return fixEmotBuffer(Buffer.from(fileResponse.data), needsDecrypt);
        } catch (err) {
            lastError = err;

            if (attempt === retries) {
                break;
            }

            await sleep(500 * attempt);
        }
    }

    throw lastError;
}

async function downloadStickerBuffers(playUrls, needsDecrypt) {
    const buffers = new Array(playUrls.length);

    for (let start = 0; start < playUrls.length; start += CDN_DOWNLOAD_CONCURRENCY) {
        const chunk = playUrls.slice(start, start + CDN_DOWNLOAD_CONCURRENCY);
        const chunkBuffers = await Promise.all(
            chunk.map((url) => downloadBufferWithRetry(url, needsDecrypt))
        );

        chunkBuffers.forEach((buffer, index) => {
            buffers[start + index] = buffer;
        });
    }

    return buffers;
}

async function getStickerBuffers(meta, preview, urls, needsDecrypt) {
    await fs.promises.mkdir(EMOTIONS_DIR, { recursive: true });

    const dir = path.join(EMOTIONS_DIR, safeName(meta.itemCode));

    if (fs.existsSync(dir)) {
        const files = (await fs.promises.readdir(dir))
            .filter((file) => /\.(png|webp|jpg|jpeg)$/i.test(file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        return Promise.all(files.map(async (file) => {
            const buffer = await fs.promises.readFile(path.join(dir, file));
            return fixEmotBuffer(buffer, needsDecrypt);
        }));
    }

    const ext = path.extname(preview.playPathFormat) || '.png';
    const buffers = await downloadStickerBuffers(urls, needsDecrypt);

    await fs.promises.mkdir(dir, { recursive: true });
    await Promise.all(buffers.map((buffer, index) => {
        const id = String(index + 1).padStart(3, '0');
        return fs.promises.writeFile(path.join(dir, `${id}${ext}`), buffer);
    }));

    return buffers;
}

function safeName(value) {
    return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function fixEmotBuffer(buffer, needsDecrypt) {
    if (!needsDecrypt || isImage(buffer)) {
        return buffer;
    }

    const decrypted = decryptEmoticon(buffer);
    return isImage(decrypted) ? decrypted : buffer;
}

function isImage(buffer) {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        || buffer.subarray(0, 4).toString() === 'RIFF'
        || buffer.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function normalizeStickerBuffer(buffer) {
    const image = sharp(buffer, { animated: false });
    const metadata = await image.metadata();

    if (metadata.width === 512 && metadata.height === 512 && metadata.format === 'png') {
        return buffer;
    }

    return image
        .resize(512, 512, {
            fit: 'contain',
            position: 'centre',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
}

async function createStickerPackFromBuffers(userId, metaData, buffers) {
    const botUsername = await getBotUsername();
    const setName = buildStickerSetName(userId, metaData.hashedItemCode, botUsername);
    const uploadedStickers = [];

    for (let index = 0; index < buffers.length; index += 1) {
        const normalizedBuffer = await normalizeStickerBuffer(buffers[index]);
        const uploaded = await bot.uploadStickerFile(
            userId,
            normalizedBuffer,
            'static',
            {},
            createStickerFileOptions(index, 'png')
        );

        uploadedStickers.push(uploaded.file_id);
    }

    try {
        await bot.createNewStickerSet(
            userId,
            setName,
            metaData.title,
            uploadedStickers[0],
            STICKER_EMOJI,
            {}
        );
    } catch (err) {
        const description = err?.response?.body?.description ?? '';

        if (!description.includes('STICKERSET_INVALID') && !description.includes('SHORT_NAME_OCCUPIED')) {
            throw err;
        }

        await bot.addStickerToSet(
            userId,
            setName,
            uploadedStickers[0],
            STICKER_EMOJI,
            'png_sticker'
        );
    }

    for (let index = 1; index < uploadedStickers.length; index += 1) {
        await bot.addStickerToSet(
            userId,
            setName,
            uploadedStickers[index],
            STICKER_EMOJI,
            'png_sticker'
        );
    }

    return `https://t.me/addstickers/${setName}`;
}

function preprocessKey(key) {
    const keyBytes = Buffer.alloc(32);
    const originalBytes = Buffer.from(key, 'utf8');
    originalBytes.copy(keyBytes, 0, 0, Math.min(originalBytes.length, 32));

    function computeKey(initial, offset) {
        let result = initial;
        for (let i = 0; i < 4; i++) {
            result = (result << 8) | (keyBytes[offset + i] & 0xFF);
        }
        return result === 0 ? initial : result;
    }

    return [
        computeKey(301989938, 0),
        computeKey(623357073, 4),
        computeKey(-2004086252, 8)
    ];
}

function processXor(key, source) {
    let [key1, key2, key3] = preprocessKey(key);
    const result = Buffer.alloc(source.length);

    for (let i = 0; i < source.length; i++) {
        const b = source[i];
        let b13 = 0;
        let i16 = 0;
        let i17 = 1;

        for (let j = 0; j < 8; j++) {
            if ((key1 & 1) !== 0) {
                key1 = ((-2147483550 ^ key1) >>> 1) | 0x80000000;
                if ((key2 & 1) !== 0) {
                    key2 = ((key2 ^ 0x40000030) >>> 1) | 0xC0000000;
                    i17 = 1;
                } else {
                    key2 = (key2 >>> 1) & 0x3FFFFFFF;
                    i17 = 0;
                }
            } else {
                key1 = (key1 >>> 1) & 0x7FFFFFFF;
                if ((key3 & 1) !== 0) {
                    key3 = ((key3 ^ 0x10000002) >>> 1) | 0xF0000000;
                    i16 = 1;
                } else {
                    key3 = (key3 >>> 1) & 0x0FFFFFFF;
                    i16 = 0;
                }
            }
            b13 = (b13 << 1) | (i17 ^ i16);
        }

        result[i] = b ^ b13;
    }

    return result;
}

function decryptEmoticon(buffer) {
    const key = 'a271730728cbe141e47fd9d677e9006d';
    const chunkSize = 128;
    const output = [];

    for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        const decrypted = processXor(key, chunk);
        output.push(decrypted);
    }

    return Buffer.concat(output);
}
