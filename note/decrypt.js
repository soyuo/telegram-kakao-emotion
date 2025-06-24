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
