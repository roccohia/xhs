const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`; 

async function pollUpdates() {
  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`${API_URL}/getUpdates?timeout=30&offset=${offset}`);
      const data = await res.json();
      if (data.result && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (!update.message || !update.message.text) continue;
          const chat_id = update.message.chat.id;
          const text = update.message.text.trim();
          console.log(`[Telegram] 收到消息:`, text);
          // ...后续处理逻辑
        }
      }
    } catch (e) {
      await new Promise(res => setTimeout(res, 3000));
    }
  }
} 