const fetch = require('node-fetch');
const { spawn } = require('child_process');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash-latest'; // 推荐快速且经济的模型
let geminiClient = null;
if (GEMINI_API_KEY) {
  geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

// 多语言支持 - 仅保留中文
const I18N = {
  zh: {
    welcome: '👋 欢迎使用 Gemini 小红书助手！请选择功能或输入指令：',
    menu: '请选择功能：',
    help: `🧃 Gemini 小红书助手 Bot 支持以下指令：

🪝 /hook 背景描述 —— 小红书钩子型开头生成
📁 /history —— 查看最近请求记录
🔍 /search 关键词 —— 查询历史记录
❓ /xhs-help —— 显示帮助列表
/menu —— 弹出主菜单按钮
`,
  }
};

function getLangByCode(code) {
  return 'zh'; // 强制使用中文
}

const userLangMap = new Map(); // chat_id => lang

function getUserLang(chat_id) {
  return 'zh'; // 强制使用中文
}

function setUserLang(chat_id, code) {
  userLangMap.set(chat_id, 'zh'); // 强制使用中文
}

// 优化版帮助信息 - 仅中文
const helpMessage = `🧃 Gemini 小红书助手 Bot 支持以下指令：

🪝 /hook 背景描述 —— 小红书钩子型开头生成
📁 /history —— 查看最近请求记录
🔍 /search 关键词 —— 查询历史记录
❓ /xhs-help —— 显示帮助列表
/menu —— 弹出主菜单按钮
`;

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 主菜单按钮列表
const MAIN_MENU_BUTTONS = [
  ['/hook'],
  ['/search', '/history'],
  ['/xhs-help', '/menu']
];

// Inline Keyboard 菜单按钮
const INLINE_MENU = [
  [
    { text: '🪝 钩子开头', callback_data: 'menu_hook' }
  ],
  [
    { text: '📁 历史记录', callback_data: 'menu_history' },
    { text: '❓ 帮助', callback_data: 'menu_help' }
  ]
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, '[]', 'utf-8');
  }
}

function logHistory({ chat_id, type, topic, result }) {
  ensureDataDir();
  const now = new Date().toISOString();
  let logs = [];
  try {
    logs = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (e) {}
  logs.push({ time: now, chat_id, type, topic, result });
  if (logs.length > 10000) logs = logs.slice(-10000); // 限制最大条数，防止膨胀
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

function searchHistory(keyword, chat_id = null) {
  ensureDataDir();
  let logs = [];
  try {
    logs = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (e) {}
  keyword = keyword.trim();
  return logs.filter(item => {
    if (chat_id && item.chat_id !== chat_id) return false;
    return (
      (item.topic && item.topic.includes(keyword)) ||
      (item.result && item.result.includes(keyword))
    );
  });
}

function getUserHistory(chat_id, limit = 5) {
  ensureDataDir();
  let logs = [];
  try {
    logs = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (e) {}
  return logs.filter(item => item.chat_id === chat_id).slice(-limit).reverse();
}

// 长回复分页与全文机制
const MAX_TELEGRAM_LEN = 4000;
const PREVIEW_LEN = 600;
const pendingFullText = new Map(); // chat_id => {text, lang}

async function sendMessage(chat_id, text, lang) {
  if (!text) return;
  // 1. 超过 4000 字节自动分页
  if (Buffer.byteLength(text, 'utf-8') > MAX_TELEGRAM_LEN) {
    let offset = 0;
    let part = 1;
    while (offset < text.length) {
      // 以字符为单位分页，防止多字节截断
      let chunk = text.slice(offset, offset + MAX_TELEGRAM_LEN);
      // 尽量不截断 Markdown 语法
      await fetch(`${API_URL}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text: (part > 1 ? `[第${part}页]\n` : '') + chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      offset += MAX_TELEGRAM_LEN;
      part++;
    }
    return;
  }
  // 2. 超过 600 字，首条仅展示前 600 字+“回复【全文】查看全部”
  if (text.length > PREVIEW_LEN) {
    const preview = text.slice(0, PREVIEW_LEN);
    pendingFullText.set(chat_id, { text, lang });
    const moreTip = lang === 'en' ? '\n\nReply "全文" to view the full content.' : '\n\n回复【全文】查看全部内容';
    await fetch(`${API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: preview + moreTip,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    return;
  }
  // 3. 普通短内容
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
}

function buildPrompt(cmd, topic, lang) {
  return buildPromptOrigin(cmd, topic);
}

function buildPromptOrigin(cmd, topic) {
  switch (cmd) {
    case '/hook':
      return `你是一个专为新加坡商家写小红书爆款内容的营销顾问。

请根据以下背景，生成 1~2 条适合用于小红书图文笔记开头的"钩子型文案"。

🎯 写作目标：
让读者在 2 秒内被吸引，愿意点赞、收藏、评论或私信咨询。

🎯 风格要求：
- 要像真实博主写的，不是广告、不是机器人
- 可以带情绪、有争议、制造反差、提问、造梗，选一种即可
- 用人话说事儿，不要用【标签】、不要解释类型
- 每条控制在 30 字以内，越短越上头
- 可以带 Emoji（适度），不要乱堆
- 不要输出任何说明、标签、解释，只要文案

背景如下：
${topic}
示例生成效果（用上面 prompt 可生成类似）：
说真的，我们是被这个价格吓到了…

双人瑜伽只要10块？姐妹直接拉我冲！

或者：

我以为我老板疯了，这活动他真放出来了…

有人说我们赔本赚吆喝，但她们都在转！`;
    default:
      return '';
  }
}

async function callGemini(prompt) {
  if (!geminiClient) throw new Error('❌ 未配置 GEMINI_API_KEY，无法调用 Gemini API');
  try {
    const result = await geminiClient.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    // Gemini API 返回对象结构
    if (result && result.text) {
      return result.text.trim();
    }
    // 兼容 candidates 结构
    if (result && result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
      return result.candidates[0].content.parts[0].text.trim();
    }
    return '（无内容）';
  } catch (e) {
    if (e && e.message) throw new Error('❌ Gemini API 错误: ' + e.message);
    throw new Error('❌ Gemini API 调用失败');
  }
}

// 读取 SEO 检查 prompt
function getSeoPrompt(type, content) {
  const fs = require('fs');
  const path = require('path');
  const promptPath = path.join(__dirname, 'prompts', 'seo_checker.txt');
  let template = '';
  try {
    template = fs.readFileSync(promptPath, 'utf-8');
  } catch (e) {
    template = '请你作为一名精通小红书平台算法推荐机制的运营专家，分析以下内容的 SEO 表现，并给出评分和优化建议：\n\n内容类型：{{type}}（可能是：标题 / 正文 / 标签）\n内容如下：\n{{content}}\n\n请按如下格式输出分析结果：\n📊 SEO 分析报告：\n- 类型：{{type}}\n- 评分：{{score}}/100\n- 关键词分析：{{keywords}}（列出检测到的关键关键词）\n- 存在问题：{{issues}}（如字数不合适、无钩子、情绪弱等）\n- 优化建议：{{suggestions}}\n\n请以简洁、专业的语气作答，分析结果适合发到 Telegram。';
  }
  return template.replace(/{{type}}/g, type).replace(/{{content}}/g, content);
}

function guessSeoType(content) {
  // 简单正则判断
  if (/^#/.test(content) || /#\w+/.test(content)) return '标签';
  if (/。|！|？|\n|\r|\s{2,}/.test(content) && content.length > 15) return '正文';
  if (content.length <= 30) return '标题';
  return '正文';
}

// 读取 SEO 优化建议 prompt
function getSeoOptPrompt(content) {
  const fs = require('fs');
  const path = require('path');
  const promptPath = path.join(__dirname, 'prompts', 'seo_optimizer.txt');
  let template = '';
  try {
    template = fs.readFileSync(promptPath, 'utf-8');
  } catch (e) {
    template = '请作为一名精通小红书 SEO 的运营专家，针对以下文案内容进行优化。请输出以下结构：\n\n1. 当前文案存在的 SEO 问题（最多 3 条）\n2. 针对每个问题给出优化建议\n3. 输出一份优化后的完整版本（风格仍保持原本风格）\n\n文案内容如下：\n{{content}}';
  }
  return template.replace(/{{content}}/g, content);
}

async function sendMenu(chat_id, text, lang) {
  text = text || (I18N[lang]?.menu || I18N.zh.menu);
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      reply_markup: {
        keyboard: MAIN_MENU_BUTTONS,
        resize_keyboard: true,
        one_time_keyboard: false
      }
    })
  });
}

async function sendInlineMenu(chat_id, text, lang) {
  text = text || (lang === 'en' ? 'Please select a function:' : '请选择功能：');
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      reply_markup: {
        inline_keyboard: INLINE_MENU
      }
    })
  });
}

// 拼写纠错映射
const CMD_CORRECT = {
  '/hool': '/hook',
  '/hok': '/hook',
  // 可继续扩展
};

function getCorrection(cmd) {
  return CMD_CORRECT[cmd.toLowerCase()] || null;
}

// 统一错误提示 - 仅中文
const ERROR_TIPS = {
  zh: {
    empty_topic: '❗️主题不能为空，请在指令后输入你想要生成的主题或内容。例如：/hook 珠宝店开业\n\n常见原因：\n- 忘记输入主题或内容\n- 指令后有多余空格\n\n请重新输入正确格式。',
    empty_content: '❗️内容不能为空，请在指令后输入需要分析或优化的内容。',
    api_timeout: '❗️AI 响应超时，可能是网络不佳或请求过于复杂。\n建议：\n- 稍后重试\n- 换个主题或缩短内容',
    api_fail: '❗️AI 生成失败，可能是网络异常、API 配额不足或内容不合规。\n建议：\n- 稍后重试\n- 检查输入内容是否合规',
    not_found: '未找到相关历史记录。',
    no_history: '暂无历史记录。',
    too_long: '❗️输入内容过长，建议缩短后重试。',
    unknown: '❗️发生未知错误，请稍后重试。',
    preview_tip: '\n\n回复【全文】查看全部内容',
  }
};

async function pollUpdates() {
  let offset = 0;
  let greeted = new Set();
  while (true) {
    try {
      const res = await fetch(`${API_URL}/getUpdates?timeout=30&offset=${offset}`);
      const data = await res.json();
      if (data.result && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (!update.message && !update.callback_query) continue;
          // Inline Keyboard 回调处理
          if (update.callback_query) {
            const chat_id = update.callback_query.message.chat.id;
            const lang_code = update.callback_query.from?.language_code || '';
            setUserLang(chat_id, lang_code);
            const lang = getUserLang(chat_id);
            const data = update.callback_query.data;
            if (data === 'menu_hook') {
              await sendMessage(chat_id, '请输入背景描述，例如 /hook 我是新加坡咖啡店，想推广新品', lang);
            } else if (data === 'menu_history') {
              const logs = getUserHistory(chat_id, 5);
              if (logs.length === 0) return await sendMessage(chat_id, ERROR_TIPS.zh.no_history, lang);
              let msg = logs.map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
              await sendMessage(chat_id, msg, lang);
            } else if (data === 'menu_help') {
              await sendMessage(chat_id, helpMessage, lang);
            }
            // 回调按钮点击后移除 loading
            await fetch(`${API_URL}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callback_query_id: update.callback_query.id
              })
            });
            continue;
          }
          const chat_id = update.message.chat.id;
          const text = update.message.text.trim();
          const lang_code = update.message.from?.language_code || '';
          setUserLang(chat_id, lang_code);
          const lang = getUserLang(chat_id);
          console.log(`[Telegram] 收到消息:`, text);

          // 查看全文机制
          if (/^(全文|view full|full)$/i.test(text) && pendingFullText.has(chat_id)) {
            const { text: full, lang } = pendingFullText.get(chat_id);
            pendingFullText.delete(chat_id);
            await sendMessage(chat_id, full, lang);
            continue;
          }

          // 首次对话欢迎
          if (!greeted.has(chat_id)) {
            greeted.add(chat_id);
            await sendMessage(chat_id, '👋 欢迎使用 Gemini 小红书助手！请选择功能或输入指令：', lang);
            await sendInlineMenu(chat_id, undefined, lang);
          }

          // 智能纠错与菜单
          const lower = text.toLowerCase();
          if (getCorrection(lower)) {
            const correct = getCorrection(lower);
            await sendMessage(chat_id, `你是不是想输入 ${correct}？`, lang);
            await sendInlineMenu(chat_id, undefined, lang);
            continue;
          }

          // /menu 指令：发送 Inline Keyboard
          if (text === '/menu') {
            await sendInlineMenu(chat_id, undefined, lang);
            continue;
          }

          if (text === '/xhs-help') {
            await sendMessage(chat_id, helpMessage, lang);
            continue;
          }

          // 指令纠错：如 /hook 无参数
          if (/^\/hook\s*$/i.test(text)) {
            await sendMessage(chat_id, '请输入背景描述，例如 /hook 我是新加坡咖啡店，想推广新品', lang);
            await sendInlineMenu(chat_id, undefined, lang);
            continue;
          }

          // /hook 指令主逻辑
          if (text.startsWith('/hook ')) {
            const topic = text.replace('/hook', '').trim();
            if (!topic) {
              await sendMessage(chat_id, '请输入背景描述，例如 /hook 我是新加坡咖啡店，想推广新品', lang);
              await sendInlineMenu(chat_id, undefined, lang);
              continue;
            }
            await sendMessage(chat_id, '⏳ 正在为你生成钩子型开头，请稍候...', lang);
            try {
              const prompt = buildPrompt('/hook', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '钩子开头', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS.zh.api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS.zh.api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
            continue;
          }
          // /search 指令
          if (text.startsWith('/search ')) {
            const keyword = text.replace('/search', '').trim();
            if (!keyword) return await sendMessage(chat_id, ERROR_TIPS.zh.empty_topic, lang);
            const found = searchHistory(keyword, chat_id);
            if (found.length === 0) return await sendMessage(chat_id, ERROR_TIPS.zh.not_found, lang);
            let msg = found.slice(-5).reverse().map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg, lang);
            continue;
          }
          // /history 指令
          if (text === '/history') {
            const logs = getUserHistory(chat_id, 5);
            if (logs.length === 0) return await sendMessage(chat_id, ERROR_TIPS.zh.no_history, lang);
            let msg = logs.map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg, lang);
            continue;
          }
          // /xhs-help 指令
          if (text === '/xhs-help') {
            await sendMessage(chat_id, helpMessage, lang);
            continue;
          }
          // /menu 指令
          if (text === '/menu') {
            await sendInlineMenu(chat_id, undefined, lang);
            continue;
          }
        }
      }
    } catch (e) {
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

pollUpdates(); 