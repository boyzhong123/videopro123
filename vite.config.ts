import path from 'path';
import crypto from 'crypto';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const FANGZHOU_TTS_V1 = 'https://openspeech.bytedance.com/api/v1/tts/online';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        // 开发时方洲 1.0 TTS：POST /api/tts/fangzhou，服务端签名后请求火山
        {
          name: 'api-tts-fangzhou',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.method !== 'POST' || !req.url?.startsWith('/api/tts/fangzhou')) return next();
              const accessKey = env.DOUBAO_TTS_ACCESS_KEY;
              const secretKey = env.DOUBAO_TTS_SECRET_KEY;
              if (!accessKey || !secretKey) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end('Missing DOUBAO_TTS_ACCESS_KEY or DOUBAO_TTS_SECRET_KEY in .env');
                return;
              }
              const chunks: Buffer[] = [];
              req.on('data', (c: Buffer) => chunks.push(c));
              req.on('end', () => {
                let body: { text?: string; voiceType?: string; format?: string; speed?: number; volume?: number };
                try {
                  body = JSON.parse(Buffer.concat(chunks).toString('utf8')) || {};
                } catch {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end('Invalid JSON body');
                  return;
                }
                const text = body.text?.trim();
                if (!text) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end('Missing or empty body.text');
                  return;
                }
                const voiceType = body.voiceType || 'BV001_streaming';
                const format = body.format || 'mp3';
                const speed = Number(body.speed) || 1.0;
                const volume = Number(body.volume) || 1.0;
                const timestamp = String(Math.floor(Date.now() / 1000));
                const params = {
                  AccessKey: accessKey,
                  Action: 'GetTts',
                  Text: text,
                  VoiceType: voiceType,
                  Format: format,
                  Speed: speed,
                  Volume: volume,
                  Timestamp: timestamp,
                };
                const sortedEntries = Object.entries(params).sort((a, b) => a[0].localeCompare(b[0]));
                const queryString = sortedEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
                const host = 'openspeech.bytedance.com';
                const stringToSign = `GET\n${host}\n/api/v1/tts/online\n${queryString}&timestamp=${timestamp}`;
                const signature = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');
                const url = `${FANGZHOU_TTS_V1}?${queryString}&Signature=${encodeURIComponent(signature)}`;
                fetch(url, { method: 'GET' })
                  .then(async (r) => {
                    if (!r.ok) {
                      const text = await r.text();
                      return { status: r.status, text, buf: null as ArrayBuffer | null };
                    }
                    const buf = await r.arrayBuffer();
                    return { status: 200, text: '', buf };
                  })
                  .then((out) => {
                    if (out.status !== 200 || !out.buf) {
                      res.statusCode = out.status;
                      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                      res.end(out.text || 'TTS request failed');
                      return;
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'audio/mpeg');
                    res.end(Buffer.from(out.buf));
                  })
                  .catch((e) => {
                    if (!res.writableEnded) {
                      res.statusCode = 502;
                      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                      res.end(String(e?.message ?? e));
                    }
                  });
              });
              req.on('error', () => {
                if (!res.writableEnded) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end('Request error');
                }
              });
            });
          },
        },
        // 开发时 /api/proxy?url=xxx 由本机转发到豆包/火山，不依赖 corsproxy.io
        {
          name: 'api-proxy',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (!req.url?.startsWith('/api/proxy')) return next();
              console.log('[api-proxy] 收到请求:', req.method, req.url?.slice(0, 80) + (req.url && req.url.length > 80 ? '...' : ''));
              const urlObj = new URL(req.url, 'http://localhost');
              const target = urlObj.searchParams.get('url');
              if (!target || !target.startsWith('http')) {
                if (!target) {
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end('proxy ok');
                  return;
                }
                res.statusCode = 400;
                res.end('Invalid url');
                return;
              }
              const method = (req.method || 'GET').toUpperCase();
              const headers: Record<string, string> = {};
              if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string;
              if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;
              if (req.headers['connection']) headers['Connection'] = req.headers['connection'] as string;
              if (req.headers['x-api-resource-id']) headers['X-Api-Resource-Id'] = req.headers['x-api-resource-id'] as string;
              if (req.headers['x-api-app-id']) headers['X-Api-App-Id'] = req.headers['x-api-app-id'] as string;
              if (req.headers['x-api-access-key']) headers['X-Api-Access-Key'] = req.headers['x-api-access-key'] as string;
              if (req.headers['x-api-key']) headers['X-Api-Key'] = req.headers['x-api-key'] as string;
              // 拉取 Volces/TOS 签名图片时：仅带 Accept，避免 CDN 403
              if (method === 'GET' && /volces\.com|tos-cn-beijing/i.test(target)) {
                headers['Accept'] = 'image/*,*/*';
                headers['User-Agent'] = 'Mozilla/5.0 (compatible; ImageProxy/1.0)';
              }

              const doFetch = async (body: string | undefined) => {
                try {
                  const u = new URL(target);
                  console.log(`[api-proxy] ${method} ${u.host} body=${method === 'POST' ? (body ? `${body.length}B` : 'none') : '-'}`);
                } catch (_) {}

                // 图片生成 API 可能耗时较长，设置 180 秒超时
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                  console.error('[api-proxy] Request timeout after 180s');
                  controller.abort();
                }, 180000);

                try {
                  const r = await fetch(target, { method, headers, body, signal: controller.signal });
                  clearTimeout(timeoutId);

                  res.statusCode = r.status;
                  res.setHeader('X-Proxied-By', 'vite-api-proxy');
                  const contentLength = r.headers.get('content-length');
                  console.log(`[api-proxy] Response ${r.status}, Content-Length: ${contentLength || 'unknown'}`);

                  r.headers.forEach((v, k) => {
                    const lower = k.toLowerCase();
                    // Skip content-length: Volcano API returns incorrect value, let Express auto-calculate
                    if (lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'content-length') return;
                    res.setHeader(k, v);
                  });

                  // 使用流式读取确保完整接收响应
                  const reader = r.body?.getReader();
                  if (!reader) {
                    const buf = await r.arrayBuffer();
                    console.log(`[api-proxy] Received ${buf.byteLength} bytes (arrayBuffer)`);
                    res.end(Buffer.from(buf));
                    return;
                  }

                  const chunks: Uint8Array[] = [];
                  let totalBytes = 0;
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                      chunks.push(value);
                      totalBytes += value.length;
                    }
                  }

                  const combined = new Uint8Array(totalBytes);
                  let offset = 0;
                  for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                  }

                  console.log(`[api-proxy] Received ${totalBytes} bytes (stream)`);
                  res.end(Buffer.from(combined));

                } catch (e: any) {
                  clearTimeout(timeoutId);
                  console.error('[api-proxy] Error:', e?.message || e);
                  if (!res.writableEnded) {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    const msg = e?.name === 'AbortError' ? 'Request timeout (180s)' : String(e?.message ?? e);
                    res.end('Proxy error: ' + msg);
                  }
                }
              };

              if (method !== 'POST') {
                doFetch(undefined);
                return;
              }
              const chunks: Buffer[] = [];
              const bodyTimeout = setTimeout(() => {
                if (res.writableEnded) return;
                res.statusCode = 408;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end('Proxy: request body timeout');
              }, 15000);
              req.on('data', (c: Buffer) => chunks.push(c));
              req.on('end', () => {
                clearTimeout(bodyTimeout);
                const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
                doFetch(body);
              });
              req.on('error', () => {
                clearTimeout(bodyTimeout);
                if (!res.writableEnded) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                  res.end('Request body error');
                }
              });
            });
          },
        },
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
