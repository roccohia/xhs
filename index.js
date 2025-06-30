const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`; 

const HELP_TEXT = `🧃 Gemini 小红书助手 Bot 支持以下指令：

/xhs-help  查看功能列表
/title 主题    生成爆款标题
/post 主题     生成图文内容
/tags 主题     推荐小红书标签
/cover 主题    封面文案生成
/covertext 主题 叠字标题生成
/batch 主题1,主题2,...  批量标题生成
/abtest 主题   AB测试内容生成
/reply 主题    评论回复助手
/ptime 主题 年龄段  发布时间建议
/hotspot 主题  话题爆点分析
/comment 主题  评论引导语生成
`;

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