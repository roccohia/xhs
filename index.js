const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`; 

const chat_id = update.message.chat.id;
const text = update.message.text.trim();
console.log(`[Telegram] 收到消息:`, text); 