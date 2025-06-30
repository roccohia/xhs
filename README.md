# Gemini 小红书助手 Telegram Bot

## 快速部署到 Railway

1. **Fork 本仓库**
2. **点击 Railway 一键部署按钮**（或在 Railway 新建项目，连接你的 GitHub/Fork）
3. **设置环境变量**
   - `TELEGRAM_BOT_TOKEN`：你的 Telegram Bot Token
4. **部署并启动**

## 本地开发

```bash
npm install
cp .env.example .env # 并填写你的 TELEGRAM_BOT_TOKEN
npm start
```

## 支持的指令
- /xhs-help  查看功能列表
- /title 主题    生成爆款标题
- /post 主题     生成图文内容
- /tags 主题     推荐小红书标签
- /cover 主题    封面文案生成
- /covertext 主题 叠字标题生成
- /batch 主题1,主题2,...  批量标题生成
- /abtest 主题   AB测试内容生成
- /reply 主题    评论回复助手
- /ptime 主题 年龄段  发布时间建议
- /hotspot 主题  话题爆点分析
- /comment 主题  评论引导语生成

## Railway 环境变量
- `TELEGRAM_BOT_TOKEN` 你的 Telegram Bot Token

---

如需自定义功能，请修改 `index.js`。 