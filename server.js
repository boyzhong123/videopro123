/**
 * 自建服务器一键运行：提供静态站点（dist/）+ /api/proxy，豆包生图/TTS 无超时限制。
 * 使用：npm run build && npm start
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

// 代理：与 api/proxy 逻辑一致，超时 120 秒
app.all("/api/proxy", async (req, res) => {
  const url = req.query?.url;
  if (typeof url !== "string") {
    res.status(400).end("Missing url");
    return;
  }
  let target;
  try {
    target = decodeURIComponent(url);
  } catch {
    res.status(400).end("Invalid url");
    return;
  }
  const method = req.method === "POST" ? "POST" : "GET";
  const headers = {};
  if (req.headers.authorization) headers["Authorization"] = req.headers.authorization;
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  if (req.headers["x-api-resource-id"]) headers["X-Api-Resource-Id"] = req.headers["x-api-resource-id"];
  if (req.headers["x-api-app-id"]) headers["X-Api-App-Id"] = req.headers["x-api-app-id"];
  if (req.headers["x-api-access-key"]) headers["X-Api-Access-Key"] = req.headers["x-api-access-key"];
  if (req.headers["x-api-key"]) headers["X-Api-Key"] = req.headers["x-api-key"];
  const body = method === "POST" && req.body != null ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 120000);
    const r = await fetch(target, { method, headers, body, signal: controller.signal });
    clearTimeout(t);
    res.status(r.status);
    r.headers.forEach((v, k) => {
      const lower = String(k).toLowerCase();
      if (lower === "content-encoding" || lower === "transfer-encoding") return;
      res.setHeader(k, v);
    });
    const buf = await r.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (e) {
    res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8").end(String(e?.message || e));
  }
});

// 静态资源 + SPA 回退
const dist = path.join(__dirname, "dist");
app.use(express.static(dist));
app.get("*", (req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server: http://0.0.0.0:${PORT}`);
});
