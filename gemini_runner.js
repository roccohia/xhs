#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const fetch = require('node-fetch');

// 屏蔽特定的 DeprecationWarning
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return; // 忽略 punycode 相关的废弃警告
  }
  console.warn(warning); // 其他警告正常显示
});

// 菜单选项
const menu = `
🧃 Gemini 小红书助手 CLI
==================================
1 - 标题生成器
2 - 图文内容生成器
3 - 热门标签推荐器
4 - 封面叠字文案生成器
5 - 批量标题生成器
6 - 叠字标题生成器
7 - 内容整合导出器
8 - 自动封面图提示生成器
9 - AB测试内容生成器
10 - 评论回复助手
11 - 评论引导语生成器
0 - 退出
==================================
请选择功能编号：`;

// 文件名合法化
function sanitizeFileName(str) {
  return str.replace(/[\/\\\:\*\?\"\<\>\|]/g, '_');
}

const TELEGRAM_BOT_TOKEN = '7576767185:AAE_0LVCmKdfMPsI76_k4xQ3R5ew0TjwJmk';
const TELEGRAM_CHAT_ID = '7413280915';

async function sendToTelegram(content, filename) {
  const maxLength = 4000; // Telegram 单条消息最大长度
  let text = `【Gemini小红书助手】\n${filename}\n\n${content}`;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength - 20) + '\n...(内容过长已截断)';
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    if (!res.ok) {
      console.error('❌ Telegram 发送失败:', await res.text());
    } else {
      console.log('✅ 已通过 Telegram Bot 推送到你的 Telegram!');
    }
  } catch (e) {
    console.error('❌ Telegram 发送异常:', e.message);
  }
}

/**
 * 执行 Gemini CLI 命令并返回一个 Promise
 * @param {object} feature - 功能对象 (来自 featureMap)
 * @param {string} topic - 主题
 * @returns {Promise<void>}
 */
function executeGemini(feature, topic) {
  return new Promise((resolve, reject) => {
    const promptPath = path.join(__dirname, 'prompts', `${feature.key}.txt`);
    const outputPath = path.join(__dirname, 'outputs', `${feature.filePrefix}_${sanitizeFileName(topic)}.txt`);

    if (!fs.existsSync(promptPath)) {
      console.log(`❌ Prompt 文件不存在：${promptPath}`);
      return reject(new Error(`Prompt file not found: ${promptPath}`));
    }

    const promptTemplate = fs.readFileSync(promptPath, 'utf-8');
    const finalPrompt = promptTemplate.replace(/{{topic}}/g, topic);

    console.log(`\n✨ 正在为「${topic}」执行「${feature.name}」...\n`);

    const isWin = process.platform === 'win32';
    const npxCmd = isWin ? 'npx.cmd' : 'npx';
    const gemini = spawn(npxCmd, ['@google/gemini-cli'], { shell: true });

    let timedOut = false;
    const timeout = 60000;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      gemini.kill('SIGKILL');
      const errorMsg = `\n❌ 请求超时（超过 ${timeout / 1000} 秒）。请检查网络或更换主题。`;
      console.log(errorMsg);
      reject(new Error(errorMsg));
    }, timeout);

    gemini.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      if (err.code === 'ENOENT') {
        console.error(`❌ 命令未找到: ${npxCmd}`);
        console.error('请确保 Node.js 和 npm 已正确安装，并且其路径已添加到系统的 PATH 环境变量中。');
      } else {
        console.error(`❌ 启动子进程失败: ${err.message}`);
      }
      reject(err);
    });

    gemini.stdin.write(finalPrompt);
    gemini.stdin.end();

    let result = '';
    gemini.stdout.on('data', (data) => {
      if (timedOut) return;
      process.stdout.write(data.toString());
      result += data.toString();
    });

    gemini.stderr.on('data', (data) => {
      if (timedOut) return;
      const stderrStr = data.toString();
      if (stderrStr.includes('punycode') && stderrStr.includes('DeprecationWarning')) {
        return;
      }
      console.error(`⚠️ 警告信息：\n${stderrStr}`);
    });

    gemini.on('close', async (code) => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      if (code === 0) {
        fs.writeFileSync(outputPath, result, 'utf-8');
        console.log(`\n✅ 已保存至 ${outputPath}`);
        await sendToTelegram(result, path.basename(outputPath));
        resolve();
      } else {
        const errorMsg = `❌ Gemini CLI 执行失败，退出码：${code}`;
        console.log(errorMsg);
        reject(new Error(errorMsg));
      }
    });
  });
}

// 主执行函数
function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(menu, async (option) => {
    if (option === '0') {
      rl.close();
      return;
    }

    const featureMap = {
      '1': { key: 'title_generator', name: '标题生成', filePrefix: '标题生成' },
      '2': { key: 'post_generator', name: '图文生成', filePrefix: '图文生成' },
      '3': { key: 'tags_generator', name: '热门标签推荐', filePrefix: '标签推荐' },
      '4': { key: 'cover_generator', name: '封面文案生成', filePrefix: '封面文案' },
      '6': { key: 'cover_text_generator', name: '叠字标题生成器', filePrefix: '叠字标题' },
    };
    
    // 内容整合导出器
    if (option === '7') {
      rl.question('请输入要整合内容的主题（如 黄金店开业）：', (topic) => {
        topic = topic.trim();
        if (!topic) {
          console.log('❌ 主题不能为空。');
          rl.close();
          return;
        }

        const sanitizedTopic = sanitizeFileName(topic);
        const outputsDir = path.join(__dirname, 'outputs');
        console.log(`\n正在为主题「${topic}」整合内容...`);

        const sources = [
          { title: '✍️ 爆款标题', file: `标题生成_${sanitizedTopic}.txt` },
          { title: '🎨 封面文案', file: `封面文案_${sanitizedTopic}.txt` },
          { title: '📝 图文内容', file: `图文生成_${sanitizedTopic}.txt` },
          { title: '🏷️ 热门标签', file: `标签推荐_${sanitizedTopic}.txt` },
        ];

        let finalContent = `========================================\n`;
        finalContent += `    小红书笔记整合 - ${topic}\n`;
        finalContent += `========================================\n\n`;
        let filesFound = 0;

        for (const source of sources) {
          const filePath = path.join(outputsDir, source.file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            finalContent += `【${source.title}】\n\n${content.trim()}\n\n---\n\n`;
            filesFound++;
            console.log(`✅ 已读取: ${source.file}`);
          } catch (error) {
            if (error.code === 'ENOENT') {
              console.log(`🟡 未找到: ${source.file} (已跳过)`);
            } else {
              console.error(`❌ 读取文件时出错: ${source.file}`, error);
            }
          }
        }

        if (filesFound === 0) {
          console.log(`\n❌ 未找到任何与主题「${topic}」相关的文件，请先生成内容。`);
          rl.close();
          return;
        }

        const outputPath = path.join(outputsDir, `整合笔记_${sanitizedTopic}.md`);
        fs.writeFileSync(outputPath, finalContent, 'utf-8');

        console.log(`\n========================================`);
        console.log(`✅ 整合完毕！已将内容输出到：\n${outputPath}`);
        console.log(`========================================`);
        rl.close();
      });
      return;
    }

    // 批量任务处理
    if (option === '5') {
      rl.question('请输入多个主题（用逗号或换行分隔）：\n', async (topicsStr) => {
        const topics = topicsStr.split(/,|，|\n/).map(t => t.trim()).filter(Boolean);
        if (topics.length === 0) {
          console.log('未输入有效的主题。');
          rl.close();
          return;
        }

        console.log(`\n准备批量处理 ${topics.length} 个主题...`);
        const titleFeature = featureMap['1']; // 复用标题生成器的功能
        let count = 0;

        for (const topic of topics) {
          try {
            console.log(`\n--- [${++count}/${topics.length}] ---`);
            await executeGemini(titleFeature, topic);
          } catch (error) {
            console.error(`\n处理主题「${topic}」时发生错误，已跳过。`);
          }
        }
        
        console.log(`\n✅ 批量生成完成，共处理 ${topics.length} 个主题。`);
        rl.close();
      });
      return;
    }

    // 自动封面图提示生成器
    if (option === '8') {
      rl.question('请输入主题（如 酒店开业）：', (topic) => {
        topic = topic.trim();
        if (!topic) {
          console.log('❌ 主题不能为空。');
          rl.close();
          return;
        }
        const sanitizedTopic = sanitizeFileName(topic);
        const outputsDir = path.join(__dirname, 'outputs');
        const coverTextFile = path.join(outputsDir, `封面文案_${sanitizedTopic}.txt`);
        const suggestionFile = path.join(outputsDir, `封面图建议_${sanitizedTopic}.txt`);
        let coverText = '';
        try {
          coverText = fs.readFileSync(coverTextFile, 'utf-8').split('\n').filter(Boolean)[0] || '';
        } catch (e) {
          console.log('❌ 未找到封面叠字文案，请先运行功能编号 4 生成封面文案。');
          rl.close();
          return;
        }
        // 生成封面图建议
        const suggestion = `建议使用${topic}相关的实景照片（如门店外观、产品陈列、活动现场等），叠加封面文案「${coverText}」，整体风格要吸睛、有氛围感。`;
        fs.writeFileSync(suggestionFile, suggestion, 'utf-8');
        console.log(`\n✅ 封面图建议已生成，已保存至 ${suggestionFile}`);
        rl.close();
      });
      return;
    }

    // AB测试内容生成器
    if (option === '9') {
      rl.question('请输入主题（如：护肤品）：', async (topic) => {
        topic = topic.trim();
        if (!topic) {
          console.log('❌ 主题不能为空。');
          rl.close();
          return;
        }
        const sanitizedTopic = sanitizeFileName(topic);
        const outputsDir = path.join(__dirname, 'outputs');
        if (!fs.existsSync(outputsDir)) {
          fs.mkdirSync(outputsDir, { recursive: true });
        }
        const outFile = path.join(outputsDir, `AB测试_${sanitizedTopic}.txt`);
        // 构建 prompt
        const prompt = `你是一位小红书爆款内容专家。请围绕主题「${topic}」，分别用三种不同风格各生成一组完整的小红书内容（每组包含：标题、正文、标签），风格要求如下：\n\nA. 真实生活流：内容自然真实，像朋友间的真实分享。\nB. 猎奇冲突流：内容有反转、冲突感，能激发好奇心。\nC. 情绪感染流：内容有强烈代入感和情绪渲染。\n\n每组内容请严格按照如下格式输出：\n【风格A】\n标题：...\n正文：...\n标签：#... #... #...\n【风格B】\n标题：...\n正文：...\n标签：#... #... #...\n【风格C】\n标题：...\n正文：...\n标签：#... #... #...\n\n三组内容之间用"==="分隔，不要有任何多余解释。`;
        const isWin = process.platform === 'win32';
        const npxCmd = isWin ? 'npx.cmd' : 'npx';
        const gemini = spawn(npxCmd, ['@google/gemini-cli'], { shell: true });
        let timedOut = false;
        const timeout = 90000;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          gemini.kill('SIGKILL');
          console.log('❌ 请求超时，Gemini 响应过慢。');
          rl.close();
        }, timeout);
        gemini.on('error', (err) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          console.error('❌ Gemini CLI 执行失败：', err.message || err);
          rl.close();
        });
        gemini.stdin.write(prompt);
        gemini.stdin.end();
        let result = '';
        gemini.stdout.on('data', (data) => {
          if (timedOut) return;
          process.stdout.write(data.toString());
          result += data.toString();
        });
        gemini.stderr.on('data', (data) => {
          if (timedOut) return;
          const stderrStr = data.toString();
          if (stderrStr.includes('punycode') && stderrStr.includes('DeprecationWarning')) {
            return;
          }
          console.error(`⚠️ 警告信息：\n${stderrStr}`);
        });
        gemini.on('close', async (code) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          if (code === 0) {
            fs.writeFileSync(outFile, result, 'utf-8');
            console.log(`\n已为你生成 3 组爆款文案！\n结果已保存至：${outFile}`);
            await sendToTelegram(result, path.basename(outFile));
          } else {
            console.log(`❌ Gemini CLI 执行失败，退出码：${code}`);
          }
          rl.close();
        });
      });
      return;
    }

    // 评论引导语生成器
    if (option === '11') {
      rl.question('请输入主题：', async (topic) => {
        topic = topic.trim();
        if (!topic) {
          console.log('❌ 主题不能为空。');
          rl.close();
          return;
        }
        const sanitizedTopic = sanitizeFileName(topic);
        const outputsDir = path.join(__dirname, 'outputs');
        if (!fs.existsSync(outputsDir)) {
          fs.mkdirSync(outputsDir, { recursive: true });
        }
        const outFile = path.join(outputsDir, `评论引导语_${sanitizedTopic}.txt`);
        // 构建 prompt
        const prompt = `你是一位小红书高互动博主。请为主题「${topic}」生成3条自然真实、有互动引导性的评论语句，适合放在笔记结尾引导用户留言。直接输出3条评论，每条独立成行，不要有多余解释。`;
        const isWin = process.platform === 'win32';
        const npxCmd = isWin ? 'npx.cmd' : 'npx';
        const gemini = spawn(npxCmd, ['@google/gemini-cli'], { shell: true });
        let timedOut = false;
        const timeout = 30000;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          gemini.kill('SIGKILL');
          console.log('❌ 请求超时，Gemini 响应过慢。');
          rl.close();
        }, timeout);
        gemini.on('error', (err) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          console.error('❌ Gemini CLI 执行失败：', err.message || err);
          rl.close();
        });
        gemini.stdin.write(prompt);
        gemini.stdin.end();
        let result = '';
        gemini.stdout.on('data', (data) => {
          if (timedOut) return;
          process.stdout.write(data.toString());
          result += data.toString();
        });
        gemini.stderr.on('data', (data) => {
          if (timedOut) return;
          const stderrStr = data.toString();
          if (stderrStr.includes('punycode') && stderrStr.includes('DeprecationWarning')) {
            return;
          }
          console.error(`⚠️ 警告信息：\n${stderrStr}`);
        });
        gemini.on('close', async (code) => {
          if (timedOut) return;
          clearTimeout(timeoutId);
          if (code === 0) {
            fs.writeFileSync(outFile, result, 'utf-8');
            console.log(`\n已为你生成评论引导语！\n结果已保存至：${outFile}`);
            await sendToTelegram(result, path.basename(outFile));
          } else {
            console.log(`❌ Gemini CLI 执行失败，退出码：${code}`);
          }
          rl.close();
        });
      });
      return;
    }

    const feature = featureMap[option];
    if (!feature) {
      console.log('❌ 无效的编号，请重新运行程序。');
      rl.close();
      return;
    }

    rl.question('请输入主题（如 奶茶店开业）：', async (topic) => {
      try {
        await executeGemini(feature, topic.trim());
      } catch (error) {
        console.log('\n任务执行失败。');
      } finally {
        rl.close();
      }
    });
  });
}

main();
