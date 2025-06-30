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
/seo-check 类型 内容  SEO分析（类型可省略，支持标题/正文/标签）
/seoopt 文案内容   生成SEO优化建议和改写
/search 关键词   查询你历史生成内容
/history        查看你最近5条请求记录
`;

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

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

async function sendMessage(chat_id, text) {
  const maxLength = 4096;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength - 20) + '\n...(内容过长已截断)';
  }
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

function buildPrompt(cmd, topic) {
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

          if (text === '/xhs-help') {
            await sendMessage(chat_id, HELP_TEXT);
          } else if (text.startsWith('/title ')) {
            const topic = text.replace('/title', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /title 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成爆款标题，请稍候...');
            try {
              const prompt = buildPrompt('/title', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '标题生成', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/post ')) {
            const topic = text.replace('/post', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /post 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成图文内容，请稍候...');
            try {
              const prompt = buildPrompt('/post', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '图文生成', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/tags ')) {
            const topic = text.replace('/tags', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /tags 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你推荐标签，请稍候...');
            try {
              const prompt = buildPrompt('/tags', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '标签生成', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/cover ')) {
            const topic = text.replace('/cover', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /cover 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成封面文案，请稍候...');
            try {
              const prompt = buildPrompt('/cover', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '封面文案', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/covertext ')) {
            const topic = text.replace('/covertext', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /covertext 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成叠字标题，请稍候...');
            try {
              const prompt = buildPrompt('/covertext', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '叠字标题', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/batch ')) {
            const topics = text.replace('/batch', '').trim();
            if (!topics) return await sendMessage(chat_id, '请在 /batch 后输入多个主题');
            await sendMessage(chat_id, '⏳ 正在为你批量生成标题，请稍候...');
            try {
              const topicArr = topics.split(/,|，/).map(t => t.trim()).filter(Boolean);
              let allResults = [];
              for (const t of topicArr) {
                const prompt = buildPrompt('/title', t);
                const result = await callGemini(prompt);
                allResults.push(`【${t}】\n${result}`);
                logHistory({ chat_id, type: '批量标题', topic: t, result });
              }
              await sendMessage(chat_id, allResults.join('\n\n---\n\n'));
            } catch (e) {
              await sendMessage(chat_id, e.message || '批量生成失败');
            }
          } else if (text.startsWith('/abtest ')) {
            const topic = text.replace('/abtest', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /abtest 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成AB测试内容，请稍候...');
            try {
              const prompt = buildPrompt('/abtest', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: 'AB测试', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/reply ')) {
            const topic = text.replace('/reply', '').trim();
            if (!topic) return await sendMessage(chat_id, '请在 /reply 后输入主题');
            await sendMessage(chat_id, '⏳ 正在为你生成评论回复，请稍候...');
            try {
              const prompt = buildPrompt('/reply', topic);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: '评论回复', topic, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || '生成失败');
            }
          } else if (text.startsWith('/search ')) {
            const keyword = text.replace('/search', '').trim();
            if (!keyword) return await sendMessage(chat_id, '请在 /search 后输入关键词');
            const found = searchHistory(keyword, chat_id);
            if (found.length === 0) return await sendMessage(chat_id, '未找到相关历史记录');
            let msg = found.slice(-5).reverse().map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg);
          } else if (text === '/history') {
            const logs = getUserHistory(chat_id, 5);
            if (logs.length === 0) return await sendMessage(chat_id, '暂无历史记录');
            let msg = logs.map(item => `【${item.type}】${item.topic}\n${item.result.slice(0, 200)}...\n时间: ${item.time}`).join('\n\n');
            await sendMessage(chat_id, msg);
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
            if (!content) return await sendMessage(chat_id, '请在 /seo-check 后输入内容，如：/seo-check 标题 XXX');
            await sendMessage(chat_id, `⏳ 正在分析${type}的 SEO 表现，请稍候...`);
            try {
              const prompt = getSeoPrompt(type, content);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: 'SEO检查', topic: `${type}:${content.slice(0,30)}`, result });
            } catch (e) {
              await sendMessage(chat_id, e.message || 'SEO 分析失败');
            }
          } else if (text.startsWith('/seoopt ')) {
            const content = text.replace('/seoopt', '').trim();
            if (!content) return await sendMessage(chat_id, '请在 /seoopt 后输入需要优化的文案内容');
            await sendMessage(chat_id, '⏳ 正在为你分析并优化文案，请稍候...');
            try {
              const prompt = getSeoOptPrompt(content);
              const result = await callGemini(prompt);
              await sendMessage(chat_id, result);
              logHistory({ chat_id, type: 'SEO优化建议', topic: content.slice(0,30), result });
            } catch (e) {
              await sendMessage(chat_id, e.message || 'SEO 优化失败');
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