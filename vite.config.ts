import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        // 开发时 /api/proxy?url=xxx 由本机转发到豆包/火山，不依赖 corsproxy.io
        {
          name: 'api-proxy',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (!req.url?.startsWith('/api/proxy')) return next();
              const i = req.url.indexOf('?url=');
              if (i === -1) return next();
              const encoded = req.url.slice(i + 5).split('&')[0];
              let target: string;
              try {
                target = decodeURIComponent(encoded);
              } catch {
                res.statusCode = 400;
                res.end('Invalid url');
                return;
              }
              const method = req.method || 'GET';
              const headers: Record<string, string> = {};
              if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string;
              if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;
              if (req.headers['x-api-resource-id']) headers['X-Api-Resource-Id'] = req.headers['x-api-resource-id'] as string;
              if (req.headers['x-api-app-id']) headers['X-Api-App-Id'] = req.headers['x-api-app-id'] as string;
              if (req.headers['x-api-access-key']) headers['X-Api-Access-Key'] = req.headers['x-api-access-key'] as string;
              if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'] as string;
              const onBody = (body: string | undefined) => {
                fetch(target, { method, headers, body })
                  .then((r) => {
                    res.statusCode = r.status;
                    r.headers.forEach((v, k) => res.setHeader(k, v));
                    return r.arrayBuffer();
                  })
                  .then((buf) => res.end(Buffer.from(buf)))
                  .catch((e) => {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end('Proxy error: ' + String(e?.message || e));
                  });
              };
              if (method !== 'POST' || !req.headers['content-type']?.includes('application/json')) {
                onBody(undefined);
                return;
              }
              const chunks: Buffer[] = [];
              req.on('data', (c: Buffer) => chunks.push(c));
              req.on('end', () => {
                const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
                onBody(body);
              });
              req.on('error', () => {
                if (!res.writableEnded) {
                  res.statusCode = 400;
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
