/**
 * 自建服务器一键运行：提供静态站点（dist/）+ /api/proxy + /api/tts/fangzhou（方洲 1.0 TTS，服务端签名）。
 * 使用：npm run build && npm start
 * 方洲 1.0 需在环境变量配置：DOUBAO_TTS_ACCESS_KEY、DOUBAO_TTS_SECRET_KEY（Secret 仅服务端，勿暴露前端）。
 */
import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

const FANGZHOU_TTS_V1 = "https://openspeech.bytedance.com/api/v1/tts/online";

/** 方洲 1.0 TTS：服务端用 AccessKey + SecretKey 做 HMAC 签名后请求火山，返回 MP3 二进制 */
app.post("/api/tts/fangzhou", async (req, res) => {
  const accessKey = process.env.DOUBAO_TTS_ACCESS_KEY || req.body?.accessKey;
  const secretKey = process.env.DOUBAO_TTS_SECRET_KEY || req.body?.secretKey;
  if (!accessKey || !secretKey) {
    res.status(400).setHeader("Content-Type", "text/plain; charset=utf-8").end("Missing DOUBAO_TTS_ACCESS_KEY or DOUBAO_TTS_SECRET_KEY (set env or body)");
    return;
  }
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).setHeader("Content-Type", "text/plain; charset=utf-8").end("Missing or invalid body.text");
    return;
  }
  const voiceType = req.body?.voiceType || "BV001_streaming";
  const format = req.body?.format || "mp3";
  const speed = Number(req.body?.speed) || 1.0;
  const volume = Number(req.body?.volume) || 1.0;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const params = {
    AccessKey: accessKey,
    Action: "GetTts",
    Text: text.trim(),
    VoiceType: voiceType,
    Format: format,
    Speed: speed,
    Volume: volume,
    Timestamp: timestamp,
  };
  const sortedEntries = Object.entries(params).sort((a, b) => a[0].localeCompare(b[0]));
  const queryString = sortedEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const host = "openspeech.bytedance.com";
  const stringToSign = `GET\n${host}\n/api/v1/tts/online\n${queryString}&timestamp=${timestamp}`;
  const signature = crypto.createHmac("sha256", secretKey).update(stringToSign).digest("hex");
  const url = `${FANGZHOU_TTS_V1}?${queryString}&Signature=${encodeURIComponent(signature)}`;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60000);
    const r = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(t);
    if (!r.ok) {
      const errText = await r.text();
      res.status(r.status).setHeader("Content-Type", "text/plain; charset=utf-8").end(errText || `HTTP ${r.status}`);
      return;
    }
    const buf = await r.arrayBuffer();
    res.status(200).setHeader("Content-Type", "audio/mpeg").end(Buffer.from(buf));
  } catch (e) {
    res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8").end(String(e?.message || e));
  }
});

// 代理：与 api/proxy 逻辑一致，超时 120 秒
app.all("/api/proxy", async (req, res) => {
  const url = req.query?.url;
  if (typeof url !== "string") {
    // Health check: GET /api/proxy without url parameter
    if (req.method === "GET" && !url) {
      res.status(200).end("proxy ok");
      return;
    }
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
  if (req.headers.connection) headers["Connection"] = req.headers.connection;
  if (req.headers["x-api-resource-id"]) headers["X-Api-Resource-Id"] = req.headers["x-api-resource-id"];
  if (req.headers["x-api-app-id"]) headers["X-Api-App-Id"] = req.headers["x-api-app-id"];
  if (req.headers["x-api-access-key"]) headers["X-Api-Access-Key"] = req.headers["x-api-access-key"];
  if (req.headers["x-api-key"]) headers["X-Api-Key"] = req.headers["x-api-key"];
  // 拉取 Volces/TOS 签名图片时：仅带 Accept，不转发 Referer，避免 CDN 403
  const isVolcesImage = method === "GET" && /volces\.com|tos-cn-beijing/i.test(target);
  if (isVolcesImage) {
    headers["Accept"] = "image/*,*/*";
    headers["User-Agent"] = "Mozilla/5.0 (compatible; ImageProxy/1.0)";
  }
  const body = method === "POST" && req.body != null ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined;
  
  let lastError = null;
  let r = null;
  
  // Try up to 3 times with different configurations
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Proxy] Attempt ${attempt}/3: ${method} ${target.slice(0, 80)}...`);
      
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 120000);
      
      // Add more fetch options for better compatibility
      const fetchOptions = {
        method,
        headers,
        body,
        signal: controller.signal,
        // Disable HTTP/2 which might cause issues
        ...(global.fetch?.length > 1 ? {} : { duplex: 'half' })
      };
      
      r = await fetch(target, fetchOptions);
      clearTimeout(t);
      console.log(`[Proxy] Attempt ${attempt} succeeded: ${r.status}`);
      break; // Success!
      
    } catch (e) {
      lastError = e;
      console.error(`[Proxy] Attempt ${attempt} failed:`, e.message);
      
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  if (!r) {
    console.error(`[Proxy] All attempts failed. Last error:`, lastError?.message || lastError);
    res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8").end(`Proxy error: ${lastError?.message || 'fetch failed'}`);
    return;
  }
  
  try {
    
    // Set status and headers first
    res.status(r.status);
    r.headers.forEach((v, k) => {
      const lower = String(k).toLowerCase();
      // Skip headers that could cause mismatch with actual content
      if (lower === "content-encoding" || lower === "transfer-encoding" || lower === "content-length") return;
      res.setHeader(k, v);
    });
    
    // Use streaming to handle large responses more reliably
    if (!r.body) {
      console.log(`[Proxy] No response body`);
      res.end();
      return;
    }
    
    const reader = r.body.getReader();
    const chunks = [];
    let totalLength = 0;
    let chunkCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[Proxy] Stream complete after ${chunkCount} chunks`);
          break;
        }
        if (value) {
          chunks.push(value);
          totalLength += value.length;
          chunkCount++;
        }
      }
      
      // Combine all chunks
      const combined = new Uint8Array(totalLength);
      let position = 0;
      for (const chunk of chunks) {
        combined.set(chunk, position);
        position += chunk.length;
      }
      
      // Log response size for debugging
      const contentType = r.headers.get('content-type') || 'unknown';
      console.log(`[Proxy] ${method} ${target.slice(0, 60)}... -> ${r.status} (${totalLength} bytes, ${chunkCount} chunks, ${contentType})`);
      
      // For JSON responses, log first/last parts to verify completeness
      if (contentType.includes('json')) {
        const text = new TextDecoder().decode(combined);
        console.log(`[Proxy] JSON response: ${text.length} chars, starts: ${text.slice(0, 50)}, ends: ${text.slice(-50)}`);
      }
      
      res.end(Buffer.from(combined));
    } catch (readError) {
      console.error(`[Proxy] Stream read error:`, readError);
      if (!res.headersSent) {
        res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8").end(`Stream error: ${readError.message}`);
      }
    }
  } catch (e) {
    console.error(`[Proxy] Response processing failed:`, e?.message || e);
    if (!res.headersSent && !res.writableEnded) {
      res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8").end(String(e?.message || e));
    }
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
