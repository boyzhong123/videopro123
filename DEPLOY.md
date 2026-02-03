# 自建服务器部署说明

## 国内可访问部署（推荐）

要让**国内用户不翻墙**就能用生图、TTS，需要把应用部署在**境内服务器**上（阿里云 / 腾讯云 / 华为云 / 其他国内主机均可）。

### 快速步骤

1. **准备一台境内服务器**  
   - 购买云服务器（如阿里云 ECS、腾讯云 CVM），地域选国内（如华北、华东）。  
   - 系统建议：Ubuntu 22.04 或 CentOS 7+。  
   - 安装 Node.js 18+：`curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs`（Ubuntu）或从 [Node 官网](https://nodejs.org/) 安装。

2. **上传项目并构建**  
   ```bash
   cd /path/to/项目目录   # 例如 git clone 或 scp 上传后的目录
   npm install
   npm run build
   ```

3. **启动服务**  
   ```bash
   npm start
   ```  
   默认监听 3000 端口。如需 80 端口：`PORT=80 npm start`（需 root 或 cap_net_bind_service）。

4. **长期运行（推荐）**  
   ```bash
   npm install -g pm2
   pm2 start server.js --name gallery
   pm2 save && pm2 startup
   ```

5. **（可选）绑域名与 HTTPS**  
   - 在云控制台把域名解析到服务器公网 IP。  
   - 若用 Nginx 做反向代理和 HTTPS，见下方「方式二」。

部署完成后，用 **http://你的服务器IP:3000** 或 **https://你的域名** 访问即可，国内直连、无需翻墙。

---

## 关于「关翻墙后合成图片失败」

**现象**：关掉翻墙工具后图片合成失败（Creation Failed），打开翻墙就正常。

**原因**：前端会请求**当前页面的同源** `/api/proxy`，由服务器再去请求豆包/火山引擎（`ark.cn-beijing.volces.com`）。  
- 若站点部署在**境外**（如 Vercel、Netlify、GitHub Pages），在境内直连时浏览器可能无法稳定访问该域名，导致 `/api/proxy` 请求超时或失败，从而生图失败。  
- 开翻墙后，浏览器能访问境外站点，请求到 `/api/proxy` 再转火山引擎，就正常。

**解决办法**：  
- **推荐**：把应用部署到**境内服务器**（按上方「国内可访问部署」或下方「方式一」「方式二」），境内用户直接访问你的域名，无需翻墙即可生图、TTS。  
- 若暂时只能用境外托管，境内用户需要开启网络代理（翻墙）才能正常使用生图等功能。

---

## 纯静态部署（Git 仓库 / Nginx 出现 500 时必看）

若把 **dist 内容** 部署到 Git 仓库根目录（如 code.91tszx.com/carl/white），Nginx 的 **root 必须指向该仓库根目录**（即包含 `index.html`、`assets/`、`bgm/` 的目录），不能指向子目录 `dist/`（已不存在）。

**正确 Nginx 配置示例：**

```nginx
server {
    listen 80;
    server_name 你的域名;

    # 重要：root 指向仓库根目录（index.html 所在目录）
    root /path/to/white;   # 或实际拉取仓库的路径，例如 /var/www/white
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存（可选）
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000";
    }
}
```

**500 常见原因：**

1. **root 指向错误**：仍指向 `.../white/dist` 或旧路径，而当前部署已把文件放在仓库根，应改为仓库根路径。
2. **权限**：Nginx 运行用户（如 `www-data`）需有读权限：`chmod -R o+r /path/to/white` 或调整目录归属。
3. **index 未找到**：确认 `index.html` 在 root 目录下，执行 `ls /path/to/white/index.html` 应存在。

修改配置后执行 `nginx -t` 检查，再 `systemctl reload nginx`（或 `nginx -s reload`）。

---

## 方式一：Node 一键运行（推荐）

前端和代理由同一个 Node 进程提供，无需 Nginx 也可用。

### 1. 服务器要求

- Node.js 18+
- 已安装 `npm`

### 2. 部署步骤

```bash
# 1. 上传项目到服务器（git clone 或 scp/rsync）
cd /path/to/听说在线-灵感画廊

# 2. 安装依赖并构建
npm install
npm run build

# 3. 启动服务（默认 3000 端口）
npm start
```

如需指定端口：`PORT=80 npm start`，或用进程管理（见下）。

### 3. 环境变量（可选）

- 构建前在服务器上建 `.env.local`，或导出：
  - `GEMINI_API_KEY`：Gemini 接口（提示词生成等）
- 豆包相关 Key 当前写在代码里，若需改为环境变量可再改。
 - `VITE_USE_CORS_PROXY`：是否启用第三方 CORS 代理（默认不启用）。公司自有服务器请保持不设置/为 `false`，统一走同源 `/api/proxy`。

### 4. 长期运行（可选）

用 **pm2** 保活、开机自启：

```bash
npm install -g pm2
pm2 start server.js --name gallery
pm2 save
pm2 startup   # 按提示执行一次，开机自启
```

---

## 方式二：Nginx + Node 代理

适合已有 Nginx、希望由 Nginx 做 HTTPS/域名、Node 只跑代理的场景。

### 1. 构建前端

在本地或 CI 执行：

```bash
npm install
npm run build
```

将生成的 `dist/` 上传到服务器，例如 `/var/www/gallery/dist/`。

### 2. 只跑代理（Node）

在服务器上只运行代理逻辑（不提供静态）：

- 可从本项目抽离 `server.js` 里 `/api/proxy` 部分，单独起一个服务（例如监听 3001）。
- 或使用项目根目录的 `server.js`，但只让 Nginx 把 `/api` 转发到该 Node 端口；静态由 Nginx 直接提供（见下）。

### 3. Nginx 配置示例

```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    # 静态前端
    root /var/www/gallery/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 代理接口转发到 Node（假设 Node 跑在 3000）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

若用方式一（Node 同时提供静态和 `/api/proxy`），可简化为 Nginx 反代整个应用：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120s;
}
```

### 4. HTTPS（可选）

用 certbot 申请证书后，在 Nginx 里增加 `listen 443 ssl` 和 `ssl_certificate` / `ssl_certificate_key` 即可。

---

## 小结

| 方式       | 适用场景           | 命令/要点                    |
|------------|--------------------|------------------------------|
| Node 一键  | 国内可访问、快速自建 | `npm run build && npm start`，服务器选国内 |
| Nginx+Node | 国内可访问 + HTTPS | 国内服务器 + Nginx 反代到 Node |

**国内可访问要点**：服务器必须在境内（阿里云/腾讯云/华为云等国内地域），用户用国内网络直连你的域名或 IP 即可，无需翻墙。自建服务器上代理超时可设 120 秒，豆包生图、TTS 不会像 Vercel 免费版 10 秒那样被截断。
