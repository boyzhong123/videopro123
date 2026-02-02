<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ygQms5_D4WY0DzxMviPP5h7_tum9tcgj

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

豆包/火山接口从浏览器直连会因 CORS 被拦，因此需要「代理」转发请求。本项目**不依赖第三方代理**：

- **本地开发**：Vite 已内置 `/api/proxy` 中间件，请求会由本机转发到豆包/火山，无需 corsproxy.io。
- **生产部署**：若部署到 Vercel，将项目根目录的 `api/` 一起部署即可提供 `/api/proxy`，同样无需第三方代理。若部署到其他平台，可自建一个转发到豆包/火山的接口，并在环境变量中设置 `VITE_CORS_PROXY` 指向该接口（如 `https://你的域名/api/proxy?url=`）。
