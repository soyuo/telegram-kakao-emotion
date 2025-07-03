const config = require('./config.json');
const axios = require('axios');
const fs = require('fs');
const telegram_bot = require('node-telegram-bot-api');
const bot = new telegram_bot('YOUR_BOT_TOKEN', { polling: true });

if (!fs.existsSync(config.STORAGE)) {
    fs.mkdirSync(config.STORAGE);
}
if (!fs.existsSync(config.TEMP)) {
    fs.mkdirSync(config.TEMP);
}

bot.onText(/^.*$/, async (event) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;

    if(event.text.startsWith('/login')) {
        let cmd = event.text.split(' ').slice(1);
    }
})