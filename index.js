const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`; 

for (const update of data.result) {
  offset = update.update_id + 1;
  if (!update.message || !update.message.text) continue;
  const chat_id = update.message.chat.id;
  const text = update.message.text.trim();
  console.log(`[Telegram] 收到消息:`, text);
  // ...后续处理逻辑
} 