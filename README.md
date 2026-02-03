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

## 故障排查

### 快速诊断工具

运行诊断脚本检测系统配置和网络连接：

```bash
npm run diagnose
```

此工具将自动检测：
- ✅ 代理服务器是否正常运行
- ✅ API Key 是否已配置
- ✅ 火山引擎 API 连接是否正常
- ✅ 响应流是否会被截断

### 常见问题

#### 1. 图片生成失败 - "接口返回被截断的 JSON"

**症状**: 错误提示显示收到不完整的 JSON 响应（如 561 字符）

**可能原因**:
- 网络不稳定导致传输中断
- 使用不稳定的第三方代理（如 corsproxy.io）
- 防火墙或广告拦截器干扰

**解决方案**:
1. **使用自建代理服务器**（推荐）:
   ```bash
   npm run build
   npm start
   ```
   访问 `http://localhost:3000`，自建代理比 Vite dev 服务器更稳定

2. **检查网络连接**:
   - 确保网络稳定
   - 尝试切换网络环境
   - 暂时关闭 VPN 或代理测试

3. **清除浏览器缓存**:
   - 打开浏览器控制台 (F12)
   - Network 标签页中查看请求详情
   - 清除缓存后重试

4. **重启开发服务器**:
   ```bash
   # 停止当前服务器 (Ctrl+C)
   npm run dev  # 或 npm start
   ```

#### 2. API Key 认证失败

**症状**: 401/403 错误，提示未授权

**解决方案**:
1. 检查 `.env` 文件中的 `VITE_DOUBAO_API_KEY` 是否正确
2. 登录[火山引擎控制台](https://console.volcengine.com/)确认：
   - Key 是否已开通 **Seedream 图像生成**权限
   - Key 是否已过期
   - 账户余额是否充足
3. 保存配置后**必须重启开发服务器**

#### 3. API 配额不足或限流

**症状**: 429 错误，或提示 "quota exceeded" / "rate limit"

**解决方案**:
1. 检查火山引擎控制台账户余额
2. 查看 API 调用配额限制（每日/每分钟）
3. 等待一段时间后重试
4. 考虑升级账户套餐

#### 4. 代理服务器无法访问

**症状**: 前端显示代理服务器健康检查失败

**解决方案**:
1. 确保开发服务器正在运行
2. 检查端口是否正确（默认 3000）
3. 检查防火墙设置是否阻止了本地连接
4. 尝试访问 `http://localhost:3000/api/proxy?url=https://httpbin.org/json` 测试

#### 5. 跨域（CORS）错误

**症状**: 浏览器控制台显示 CORS 相关错误

**解决方案**:
1. 确保前端页面和 `/api/proxy` **同源**（都在 localhost:3000）
2. 不要使用 `file://` 协议打开页面
3. 检查浏览器是否安装了可能干扰的扩展程序

### 调试技巧

1. **查看浏览器控制台** (F12):
   - Console 标签查看错误日志
   - Network 标签查看网络请求详情
   - 查看失败请求的响应内容

2. **查看服务器日志**:
   - 运行 `npm start` 时会在终端输出详细日志
   - 查看代理请求的状态码和响应大小

3. **使用诊断脚本**:
   ```bash
   npm run diagnose
   ```
   获取完整的系统诊断报告

### 获取帮助

如果上述方法都无法解决问题：

1. 收集以下信息：
   - 浏览器控制台的完整错误信息
   - 服务器终端的日志输出
   - 诊断脚本 (`npm run diagnose`) 的完整输出
   - 你的操作系统和 Node.js 版本

2. 查看 `.env.example` 文件中的详细配置说明

3. 检查 `DEPLOY.md` 了解部署相关问题的解决方案
