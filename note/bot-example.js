const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp'); // webp 변환용
const path = require('path');

const bot = new TelegramBot('YOUR_BOT_TOKEN', { polling: true });

bot.onText(/\/create/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;

    if (!reply || (!reply.photo && !reply.sticker)) {
        return bot.sendMessage(chatId, '이미지나 스티커에 답장해서 /create 를 입력해주세요.');
    }

    let fileId;
    if (reply.photo) {
        fileId = reply.photo[reply.photo.length - 1].file_id;
    } else if (reply.sticker && !reply.sticker.is_animated && !reply.sticker.is_video) {
        fileId = reply.sticker.file_id;
    } else {
        return bot.sendMessage(chatId, '지원하지 않는 스티커 유형입니다.');
    }

    try {
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        const tmpPath = `./tmp_${msg.message_id}.webp`;

        // 이미지 다운로드 및 webp 변환
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = await sharp(response.data)
            .resize(512, 512, { fit: 'inside' })
            .webp()
            .toBuffer();

        fs.writeFileSync(tmpPath, buffer);

        const setName = `user${userId}_custom_by_${bot.username.toLowerCase()}`;
        const stickerEmoji = '😎';

        // 스티커 팩이 없으면 만들기
        try {
            await bot.createNewStickerSet(userId, setName, 'My Sticker Set', {
                png_sticker: fs.createReadStream(tmpPath),
                emojis: stickerEmoji
            });
            await bot.sendMessage(chatId, `새 스티커 팩을 만들었어요: https://t.me/addstickers/${setName}`);
        } catch (e) {
            if (e.response?.body?.description?.includes('STICKERSET_INVALID')) {
                // 이미 존재하면 추가
                await bot.addStickerToSet(userId, setName, {
                    png_sticker: fs.createReadStream(tmpPath),
                    emojis: stickerEmoji
                });
            } else {
                throw e;
            }
        }

        // 전송
        await bot.sendSticker(chatId, fs.createReadStream(tmpPath));

        fs.unlinkSync(tmpPath);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '스티커 생성에 실패했어요.');
    }
});
