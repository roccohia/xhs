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

// 多语言支持
const I18N = {
  zh: {
    welcome: '👋 欢迎使用 Gemini 小红书助手！请选择功能或输入指令：',
    menu: '请选择功能：',
    help: `🧃 Gemini 小红书助手 Bot 支持以下指令：

/xhs-help  查看功能列表
/title 主题    生成爆款标题
/post 主题     生成图文内容
/tags 主题     推荐小红书标签
/cover 主题    封面文案生成
/covertext 主题 叠字标题生成
/batch 主题1,主题2,...  批量标题生成
/abtest 主题   AB测试内容生成
/reply 主题    评论回复助手
/seo-check 类型 内容  SEO分析（类型可省略，支持标题/正文/标签）
/seoopt 文案内容   生成SEO优化建议和改写
/search 关键词   查询你历史生成内容
/history        查看你最近5条请求记录
/menu           弹出主菜单
`,
    // 其它提示可继续扩展
  },
  en: {
    welcome: '👋 Welcome to Gemini Xiaohongshu Assistant! Please select a feature or enter a command:',
    menu: 'Please select a feature:',
    help: `🧃 Gemini Xiaohongshu Assistant Bot supports the following commands:

/xhs-help  Show help menu
/title topic    Generate viral titles
/post topic     Generate post content
/tags topic     Recommend tags
/cover topic    Generate cover text
/covertext topic Generate repeated-word titles
/batch topic1,topic2,...  Batch title generation
/abtest topic   AB test content
/reply topic    Comment reply assistant
/seo-check type content  SEO analysis (type optional: title/body/tags)
/seoopt content   Generate SEO optimization suggestions and rewrite
/search keyword   Search your history
/history         View your last 5 requests
/menu            Show main menu
`,
  }
};

function getLangByCode(code) {
  if (!code) return 'zh';
  if (code.startsWith('zh')) return 'zh';
  if (code.startsWith('en')) return 'en';
  return 'zh';
}

const userLangMap = new Map(); // chat_id => lang

function getUserLang(chat_id) {
  return userLangMap.get(chat_id) || 'zh';
}

function setUserLang(chat_id, code) {
  userLangMap.set(chat_id, getLangByCode(code));
}

// 优化版帮助信息
const helpMessage = `🧃 Gemini 小红书助手 Bot 支持以下指令：

📌 核心功能
/title 主题 —— 生成爆款标题
/post 主题 —— 生成图文内容
/tags 主题 —— 推荐小红书标签
/cover 主题 —— 封面文案生成
/covertext 主题 —— 封面叠字标题生成

🧪 实验功能
/batch 主题1,主题2,... —— 批量生成标题
/abtest 主题 —— AB测试内容生成
/reply 主题 —— 评论回复助手

📈 SEO 分析
/seo-check 类型 内容 —— 分析标题/文案/标签 SEO
/seoopt 内容 —— 生成优化建议与改写

🔍 历史记录
/search 关键词 —— 查询历史请求
/history —— 查看最近请求记录

🛠️ 辅助指令
/xhs-help —— 查看全部指令
/menu —— 弹出主菜单按钮
`;
const helpMessageEn = `🧃 Gemini Xiaohongshu Assistant Bot supports the following commands:

📌 Core Features
/title topic —— Generate viral titles
/post topic —— Generate post content
/tags topic —— Recommend tags
/cover topic —— Generate cover text
/covertext topic —— Generate repeated-word cover titles

🧪 Experimental
/batch topic1,topic2,... —— Batch title generation
/abtest topic —— AB test content
/reply topic —— Comment reply assistant

📈 SEO Analysis
/seo-check type content —— Analyze SEO for title/body/tags
/seoopt content —— Generate optimization suggestions and rewrite

🔍 History
/search keyword —— Search your history
/history —— View your recent requests

🛠️ Utilities
/xhs-help —— Show all commands
/menu —— Show main menu buttons
`;

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// 主菜单按钮列表
const MAIN_MENU_BUTTONS = [
  ['/title', '/post', '/tags'],
  ['/cover', '/covertext', '/batch'],
  ['/abtest', '/reply', '/seo-check'],
  ['/seoopt', '/search', '/history'],
  ['/xhs-help']
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
  if (lang === 'en') {
    switch (cmd) {
      case '/title':
        return `You are an expert in crafting viral Xiaohongshu (RED) titles. Please create 10 viral titles for the topic "${topic}".\n\nRequirements:\n1. Target young users (18-25), use colloquial, internet-savvy, curiosity-inducing style.\n2. Avoid exaggeration and marketing tone, sound like a real user sharing.\n3. Use emoji, numbers, and scenario descriptions to enhance appeal.\n4. Output a list, one title per line, no numbering or extra explanation.`;
      case '/post':
        return `You are a senior Xiaohongshu (RED) blogger, skilled at writing highly engaging posts. Please create a complete Xiaohongshu post for the topic "${topic}".\n\nRequirements:\n1. Use first-person, friendly, authentic tone, as if sharing with a friend.\n2. Clear structure, use points/paragraphs, lots of emoji.\n3. Start: Grab attention with a question or statement.\n4. End: Summarize and encourage comments/likes/saves.\n5. At the end, generate 5-8 relevant hashtags.\n6. Output the full post and tags, no extra explanation or title.`;
      case '/tags':
        return `You are a Xiaohongshu (RED) operations expert, skilled in tag strategy. Please recommend 10-15 suitable tags for a post about "${topic}".\n\nRequirements:\n1. Tags should be layered: 2-3 broad, 3-5 core, 3-5 scenario/audience, 2-3 potential hot/long-tail.\n2. Output all tags, separated by spaces, each starting with #.\n3. No extra explanation.`;
      case '/cover':
        return `You are a viral copywriting expert. Please create 5 sets of repeated-word cover copy for the topic "${topic}".\n\nEach set: Main title + subtitle.\nMain: eye-catching, simple, impactful.\nSub: concise supplement.\nStyle: lively, fun, curiosity-inducing.\nUse emoji.\nFormat:\nMain | Sub\n...`;
      case '/covertext':
        return `You are a copywriting genius for young users. Please create 5 repeated-word cover titles for the topic "${topic}".\n\nRequirements:\n1. Must use repeated words (e.g. "Go go go", "So pretty", "Awesome").\n2. Extremely eye-catching, emotional, click-inducing.\n3. 10-15 characters, suitable for image.\n4. Output a list, one per line, no numbering or extra explanation.`;
      case '/abtest':
        return `You are a viral content expert. For the topic "${topic}", generate 3 sets of Xiaohongshu content (title, body, tags) in 3 styles:\nA. Real-life: natural, authentic, like sharing with friends.\nB. Curiosity/conflict: reversal, conflict, curiosity.\nC. Emotional: strong empathy and emotion.\nFormat:\n[Style A]\nTitle:...\nBody:...\nTags: #... #...\n[Style B]...\n[Style C]...\nSeparate groups with ===, no extra explanation.`;
      case '/reply':
        return `You are a top Xiaohongshu blogger, skilled at interacting with fans. For the topic "${topic}", generate 2 high-quality replies for each of 4 comment types:\n1. User question\n2. Compliment\n3. Doubt\n4. Inquiry\nFormat:\n[User question]\nReply1:...\nReply2:...\n[Compliment]...\n[...]
No extra explanation.`;
      default:
        return '';
    }
  }
  // 中文原逻辑
  return buildPromptOrigin(cmd, topic);
}

function buildPromptOrigin(cmd, topic) {
  switch (cmd) {
    case '/title':
      return `你是一位深谙小红书爆款标题精髓的文案专家。请为以下主题「${topic}」创作 10 个爆款小红书标题。\n\n要求：\n1.  面向年轻用户（18-25岁），风格口语化、有网感、能引发好奇心。\n2.  避免浮夸和营销腔，要像真实用户在分享。\n3.  可以适当运用 emoji、数字、场景化描述来增强吸引力。\n4.  直接输出列表，每行一个标题，不要添加任何序号或多余的解释。`;
    case '/post':
      return `你是一位资深的小红书博主，尤其擅长撰写高互动率的图文"种草"笔记。请围绕主题「${topic}」，创作一篇完整的小红书图文笔记内容。\n\n要求：\n1.  使用第一人称视角，语气亲切、真实，像在和好朋友分享。\n2.  内容结构清晰，善用分点或分段来组织，并大量使用 emoji 增加生动性。\n3.  开头：用一个引人入胜的问题或一句话抓住读者眼球。\n4.  结尾：有一个总结性的句子，并用一句话引导用户评论、点赞或收藏。\n5.  在文末，另起一行，根据内容生成 5-8 个相关的小红书热门标签（hashtags）。\n6.  直接输出完整的笔记内容和标签，不要有任何额外的说明或标题。`;
    case '/tags':
      return `你是一位小红书运营专家，精通流量分发和标签（hashtag）策略。请为一篇关于「${topic}」的小红书笔记，推荐 10-15 个最合适的标签。\n\n要求：\n1.  推荐的标签需要有层次感，组合使用以达到最佳曝光效果，应包括：\n    -   2-3 个宽泛的类目大词 (如 #笔记灵感 #好物分享)\n    -   3-5 个精准的核心主题词 (直接与 ${topic} 相关)\n    -   3-5 个相关的场景或人群词 (如 #周末去哪儿 #学生党)\n    -   2-3 个潜在的热门或长尾词\n2.  直接输出所有标签，用空格隔开，以 # 开头。\n3.  不要添加任何分类标题或解释。`;
    case '/cover':
      return `你是一位小红书爆款文案专家。请为主题"${topic}"创作5组适合放在笔记封面上的"叠字文案"。\n\n要求：\n1.  每组文案由一个"主标题"和一个"副标题"构成。\n2.  主标题要非常吸引眼球，用词简单、有冲击力。\n3.  副标题是对主标题的补充或解释，言简意赅。\n4.  整体风格要适合小红书用户，活泼、有趣、或能引发好奇。\n5.  使用 emoji 增强表达力。\n6.  严格按照下面的格式输出，不要有任何多余的解释：\n\n主标题 | 副标题\n主标题 | 副标题\n主标题 | 副标题\n主标题 | 副标题\n主标题 | 副标题`;
    case '/covertext':
      return `你是一位极其擅长拿捏年轻用户情绪的小红书文案鬼才。请为主题「${topic}」创作 5 个用在笔记封面上的"叠字标题"。\n\n要求：\n1.  核心是"叠字"，如"冲冲冲"、"美哭了"、"绝绝子"，必须用这种形式来构建标题。\n2.  风格要极其吸睛、夸张、有强烈的情绪价值，让人一看就有点击的冲动。\n3.  长度控制在 10-15 字，适合在图片上展示。\n4.  直接输出列表，每行一个标题，不要添加任何序号或多余的解释。`;
    case '/abtest':
      return `你是一位小红书爆款内容专家。请围绕主题「${topic}」，分别用三种不同风格各生成一组完整的小红书内容（每组包含：标题、正文、标签），风格要求如下：\n\nA. 真实生活流：内容自然真实，像朋友间的真实分享。\nB. 猎奇冲突流：内容有反转、冲突感，能激发好奇心。\nC. 情绪感染流：内容有强烈代入感和情绪渲染。\n\n每组内容请严格按照如下格式输出：\n【风格A】\n标题：...\n正文：...\n标签：#... #... #...\n【风格B】\n标题：...\n正文：...\n标签：#... #... #...\n【风格C】\n标题：...\n正文：...\n标签：#... #... #...\n\n三组内容之间用"==="分隔，不要有任何多余解释。`;
    case '/reply':
      return `你是一位小红书高赞博主，善于与粉丝互动。请针对主题「${topic}」的笔记，分别为以下4类常见评论各生成2条高赞风格的互动回复：\n\n1. 用户疑问（如 敏感肌能用吗）\n2. 用户夸赞（如 好漂亮！）\n3. 用户质疑（如 会不会踩雷？）\n4. 用户咨询（如 哪里可以买到）\n\n要求：\n- 每类评论生成2条回复，风格自然、有代入感、略带引导性。\n- 回复要有亲和力，适当引导用户点赞、关注或私信。\n- 输出格式如下：\n【用户疑问】\n回复1：...\n回复2：...\n【用户夸赞】\n回复1：...\n回复2：...\n【用户质疑】\n回复1：...\n回复2：...\n【用户咨询】\n回复1：...\n回复2：...\n\n不要有任何多余解释。`;
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

// 统一错误提示
const ERROR_TIPS = {
  zh: {
    empty_topic: '❗️主题不能为空，请在指令后输入你想要生成的主题或内容。例如：/title 珠宝店开业\n\n常见原因：\n- 忘记输入主题或内容\n- 指令后有多余空格\n\n请重新输入正确格式。',
    empty_content: '❗️内容不能为空，请在指令后输入需要分析或优化的内容。',
    api_timeout: '❗️AI 响应超时，可能是网络不佳或请求过于复杂。\n建议：\n- 稍后重试\n- 换个主题或缩短内容',
    api_fail: '❗️AI 生成失败，可能是网络异常、API 配额不足或内容不合规。\n建议：\n- 稍后重试\n- 检查输入内容是否合规',
    not_found: '未找到相关历史记录。',
    no_history: '暂无历史记录。',
    too_long: '❗️输入内容过长，建议缩短后重试。',
    unknown: '❗️发生未知错误，请稍后重试。',
    preview_tip: '\n\n回复【全文】查看全部内容',
  },
  en: {
    empty_topic: '❗️Topic cannot be empty. Please enter the topic or content after the command.\n\nCommon reasons:\n- Forgot to enter topic/content\n- Extra spaces after command\n\nPlease try again in the correct format.',
    empty_content: '❗️Content cannot be empty. Please enter the content to analyze or optimize after the command.',
    api_timeout: '❗️AI response timed out. This may be due to network issues or a complex request.\nSuggestions:\n- Try again later\n- Use a simpler or shorter topic',
    api_fail: '❗️AI generation failed. Possible reasons: network error, API quota exceeded, or content not allowed.\nSuggestions:\n- Try again later\n- Check if your input is appropriate',
    not_found: 'No related history found.',
    no_history: 'No history yet.',
    too_long: '❗️Input is too long. Please shorten and try again.',
    unknown: '❗️An unknown error occurred. Please try again later.',
    preview_tip: '\n\nReply "全文" to view the full content.',
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
          if (!update.message || !update.message.text) continue;
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
            await sendMenu(chat_id, I18N[lang]?.welcome || I18N.zh.welcome, lang);
          }

          if (text === '/xhs-help') {
            await sendMessage(chat_id, lang === 'en' ? helpMessageEn : helpMessage, lang);
          } else if (text === '/menu') {
            await sendMenu(chat_id, undefined, lang);
          } else if (text.startsWith('/title ')) {
            const topic = text.replace('/title', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating viral titles, please wait...' : '⏳ 正在为你生成爆款标题，请稍候...', lang);
            try {
              const prompt = buildPrompt('/title', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '标题生成', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/post ')) {
            const topic = text.replace('/post', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating post content, please wait...' : '⏳ 正在为你生成图文内容，请稍候...', lang);
            try {
              const prompt = buildPrompt('/post', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '图文生成', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/tags ')) {
            const topic = text.replace('/tags', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating tags, please wait...' : '⏳ 正在为你推荐标签，请稍候...', lang);
            try {
              const prompt = buildPrompt('/tags', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '标签生成', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/cover ')) {
            const topic = text.replace('/cover', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating cover text, please wait...' : '⏳ 正在为你生成封面文案，请稍候...', lang);
            try {
              const prompt = buildPrompt('/cover', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '封面文案', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/covertext ')) {
            const topic = text.replace('/covertext', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating repeated-word titles, please wait...' : '⏳ 正在为你生成叠字标题，请稍候...', lang);
            try {
              const prompt = buildPrompt('/covertext', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '叠字标题', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/batch ')) {
            const topics = text.replace('/batch', '').trim();
            if (!topics) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating batch titles, please wait...' : '⏳ 正在为你批量生成标题，请稍候...', lang);
            try {
              const topicArr = topics.split(/,|，/).map(t => t.trim()).filter(Boolean);
              let allResults = [];
              for (const t of topicArr) {
                const prompt = buildPrompt('/title', t, lang);
                const result = await callGemini(prompt);
                allResults.push(`【${t}】\n${result}`);
                logHistory({ chat_id, type: '批量标题', topic: t, result });
              }
              await sendMessage(chat_id, allResults.join('\n\n---\n\n'), lang);
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/abtest ')) {
            const topic = text.replace('/abtest', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating AB test content, please wait...' : '⏳ 正在为你生成AB测试内容，请稍候...', lang);
            try {
              const prompt = buildPrompt('/abtest', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: 'AB测试', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/reply ')) {
            const topic = text.replace('/reply', '').trim();
            if (!topic) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Generating comment replies, please wait...' : '⏳ 正在为你生成评论回复，请稍候...', lang);
            try {
              const prompt = buildPrompt('/reply', topic, lang);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: '评论回复', topic, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/search ')) {
            const keyword = text.replace('/search', '').trim();
            if (!keyword) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_topic, lang);
            const found = searchHistory(keyword, chat_id);
            if (found.length === 0) return await sendMessage(chat_id, ERROR_TIPS[lang].not_found, lang);
            let msg = found.slice(-5).reverse().map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg, lang);
          } else if (text === '/history') {
            const logs = getUserHistory(chat_id, 5);
            if (logs.length === 0) return await sendMessage(chat_id, ERROR_TIPS[lang].no_history, lang);
            let msg = logs.map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg, lang);
          } else if (text.startsWith('/seo-check ') || text.startsWith('/seo ')) {
            let input = text.replace(/^\/seo-check|^\/seo/, '').trim();
            let type = '', content = '';
            // 支持 /seo-check 标题 xxx
            const match = input.match(/^(标题|正文|标签)\s+([\s\S]+)/);
            if (match) {
              type = match[1];
              content = match[2].trim();
            } else {
              // 自动判断类型
              content = input;
              type = guessSeoType(content);
            }
            if (!content) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_content, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Analyzing SEO performance, please wait...' : '⏳ 正在分析SEO表现，请稍候...', lang);
            try {
              const prompt = getSeoPrompt(type, content);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: 'SEO检查', topic: `${type}:${content.slice(0,30)}`, result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          } else if (text.startsWith('/seoopt ')) {
            const content = text.replace('/seoopt', '').trim();
            if (!content) return await sendMessage(chat_id, ERROR_TIPS[lang].empty_content, lang);
            await sendMessage(chat_id, lang === 'en' ? '⏳ Analyzing and optimizing content, please wait...' : '⏳ 正在为你分析并优化文案，请稍候...', lang);
            try {
              const prompt = getSeoOptPrompt(content);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result, lang);
              logHistory({ chat_id, type: 'SEO优化建议', topic: content.slice(0,30), result });
            } catch (e) {
              let msg = ERROR_TIPS[lang].api_fail;
              if (e && /timeout|超时/i.test(e.message)) msg = ERROR_TIPS[lang].api_timeout;
              await sendMessage(chat_id, msg, lang);
            }
          }
        }
      }
    } catch (e) {
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

pollUpdates(); 