const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { spawn } = require('child_process');

let mainWindow = null;
let splashWindow = null;
let localServer = null;
/** 上次导出 MP4 时用户选择的目录，下次默认打开该目录 */
let lastSaveDirectory = null;

const FANGZHOU_TTS_V1 = 'https://openspeech.bytedance.com/api/v1/tts/online';
const SECRETS_SALT = '听说在线-灵感画廊-app-salt-v1';

function loadEnv(projectRoot) {
  const env = {};
  for (const name of ['.env', '.env.local']) {
    const p = path.join(projectRoot, name);
    try {
      const content = fs.readFileSync(p, 'utf8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
              val = val.slice(1, -1);
            env[key] = val;
          }
        }
      });
    } catch (_) {}
  }
  return env;
}

function deriveKey(salt) {
  return crypto.createHash('sha256').update(salt).digest();
}

function loadDecryptedSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.enc');
  try {
    const buf = fs.readFileSync(secretsPath);
    if (buf.length < 16 + 16) return {}; // iv(16) + authTag(16)
    const key = deriveKey(SECRETS_SALT);
    const iv = buf.slice(0, 16);
    const authTag = buf.slice(16, 32);
    const enc = buf.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
  } catch (_) {
    return {};
  }
}

function getFfmpegPath() {
  // 打包后优先使用 extraResources 中的 ffmpeg
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const p = path.join(process.resourcesPath, 'ffmpeg-bin', 'ffmpeg' + ext);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  // 开发环境使用 ffmpeg-static
  try {
    return require('ffmpeg-static');
  } catch (e) {
    return null;
  }
}

function startLocalServer(projectRoot) {
  const express = require('express');
  const appExpress = express();
  const distPath = path.join(projectRoot, 'dist');
  const env = { ...loadEnv(projectRoot), ...loadDecryptedSecrets() };
  const accessKey = env.DOUBAO_TTS_ACCESS_KEY || env.VITE_DOUBAO_TTS_ACCESS_KEY || '';
  const secretKey = env.DOUBAO_TTS_SECRET_KEY || env.VITE_DOUBAO_TTS_SECRET_KEY || '';

  const builtinEnvForFrontend = {
    VITE_DOUBAO_API_KEY: (env.VITE_DOUBAO_API_KEY || '').trim(),
    VITE_DOUBAO_TTS_ACCESS_KEY: (env.VITE_DOUBAO_TTS_ACCESS_KEY || env.DOUBAO_TTS_ACCESS_KEY || '').trim(),
    VITE_DOUBAO_TTS_APP_ID: (env.VITE_DOUBAO_TTS_APP_ID || '').trim(),
    VITE_DOUBAO_TTS_BIGTTS_INSTANCE: (env.VITE_DOUBAO_TTS_BIGTTS_INSTANCE || '').trim(),
  };

  appExpress.use(express.json({ limit: '50mb' }));
  appExpress.use(express.raw({ type: '*/*', limit: '50mb' }));

  appExpress.get('/api/proxy', (req, res) => {
    const target = req.query?.url;
    if (!target) {
      res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').end('proxy ok');
      return;
    }
    if (!target.startsWith('http')) {
      res.status(400).end('Invalid url');
      return;
    }
    const headers = {};
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['x-api-resource-id']) headers['X-Api-Resource-Id'] = req.headers['x-api-resource-id'];
    if (req.headers['x-api-app-id']) headers['X-Api-App-Id'] = req.headers['x-api-app-id'];
    if (req.headers['x-api-access-key']) headers['X-Api-Access-Key'] = req.headers['x-api-access-key'];
    if (req.headers['x-api-key']) headers['X-Api-Key'] = req.headers['x-api-key'];
    if (/volces\.com|tos-cn-beijing/i.test(target)) {
      headers['Accept'] = 'image/*,*/*';
      headers['User-Agent'] = 'Mozilla/5.0 (compatible; ImageProxy/1.0)';
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    fetch(target, { method: 'GET', headers, signal: controller.signal })
      .then(async (r) => {
        clearTimeout(timeoutId);
        res.status(r.status);
        r.headers.forEach((v, k) => {
          const lower = k.toLowerCase();
          if (lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'content-length') return;
          res.setHeader(k, v);
        });
        const buf = await r.arrayBuffer();
        res.end(Buffer.from(buf));
      })
      .catch((e) => {
        clearTimeout(timeoutId);
        if (!res.writableEnded) {
          res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Proxy error: ' + (e?.message || e));
        }
      });
  });

  appExpress.post('/api/proxy', (req, res) => {
    const target = req.query?.url;
    if (!target || !target.startsWith('http')) {
      res.status(400).end('Invalid url');
      return;
    }
    const headers = {};
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['x-api-resource-id']) headers['X-Api-Resource-Id'] = req.headers['x-api-resource-id'];
    if (req.headers['x-api-app-id']) headers['X-Api-App-Id'] = req.headers['x-api-app-id'];
    if (req.headers['x-api-access-key']) headers['X-Api-Access-Key'] = req.headers['x-api-access-key'];
    if (req.headers['x-api-key']) headers['X-Api-Key'] = req.headers['x-api-key'];
    let body;
    if (typeof req.body === 'string') body = req.body;
    else if (Buffer.isBuffer(req.body)) body = req.body.toString('utf8');
    else if (req.body != null && typeof req.body === 'object') body = JSON.stringify(req.body);
    else body = undefined;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    fetch(target, { method: 'POST', headers, body, signal: controller.signal })
      .then(async (r) => {
        clearTimeout(timeoutId);
        res.status(r.status);
        r.headers.forEach((v, k) => {
          const lower = k.toLowerCase();
          if (lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'content-length') return;
          res.setHeader(k, v);
        });
        const buf = await r.arrayBuffer();
        res.end(Buffer.from(buf));
      })
      .catch((e) => {
        clearTimeout(timeoutId);
        if (!res.writableEnded) {
          res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Proxy error: ' + (e?.message || e));
        }
      });
  });

  appExpress.get('/api/env', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(builtinEnvForFrontend));
  });

  appExpress.post('/api/tts/fangzhou', (req, res) => {
    if (!accessKey || !secretKey) {
      res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8').end('Missing DOUBAO_TTS_ACCESS_KEY or DOUBAO_TTS_SECRET_KEY in .env');
      return;
    }
    const body = req.body || {};
    const text = (body.text || '').trim();
    if (!text) {
      res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8').end('Missing or empty body.text');
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
          const t = await r.text();
          res.status(r.status).setHeader('Content-Type', 'text/plain; charset=utf-8').end(t || 'TTS request failed');
          return;
        }
        const buf = await r.arrayBuffer();
        res.status(200).setHeader('Content-Type', 'audio/mpeg').end(Buffer.from(buf));
      })
      .catch((e) => {
        if (!res.writableEnded) {
          res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8').end(String(e?.message ?? e));
        }
      });
  });

  appExpress.use(express.static(distPath));
  appExpress.get('*', (_req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    try {
      let html = fs.readFileSync(indexPath, 'utf8');
      const script = `<script>window.__BUILTIN_ENV__=JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(builtinEnvForFrontend))}"));</script>`;
      if (!html.includes('__BUILTIN_ENV__')) {
        html = html.replace(/<head>/i, '<head>' + script);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (e) {
      res.sendFile(indexPath);
    }
  });

  return new Promise((resolve) => {
    const server = appExpress.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      localServer = server;
      resolve(port);
    });
  });
}

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 1280,
    height: 900,
    transparent: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#050505',
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.center();
  splash.setMenuBarVisibility(false);
  return splash;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    title: '听说在线-灵感画廊',
    ...(process.platform === 'win32' ? { autoHideMenuBar: true } : {}),
  });

  if (process.platform === 'win32') {
    mainWindow.setMenu(null);
  }

  const SPLASH_MIN_MS = 2000;
  const splashStart = Date.now();
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, SPLASH_MIN_MS - elapsed);
    const showMain = () => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
    };
    if (delay > 0) setTimeout(showMain, delay);
    else showMain();
  });

  const isDev = process.env.VITE_DEV === '1' && !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadURL('http://127.0.0.1:' + port);
    });
  } else {
    mainWindow.loadURL('http://127.0.0.1:' + port);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (localServer) {
      try { localServer.close(); } catch (_) {}
      localServer = null;
    }
  });
}

app.whenReady().then(async () => {
  splashWindow = createSplashWindow();
  const projectRoot = path.join(__dirname, '..');
  const port = await startLocalServer(projectRoot);
  createWindow(port);
});

app.on('window-all-closed', () => {
  if (localServer) {
    try { localServer.close(); } catch (_) {}
    localServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    startLocalServer(path.join(__dirname, '..')).then((port) => {
      createWindow(port);
    });
  }
});

ipcMain.handle('show-notification', (_event, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || '听说在线-灵感画廊', body: body || '' }).show();
  }
});

ipcMain.handle('save-video-file', async (_event, buffer, defaultName) => {
  const defaultDir = lastSaveDirectory || app.getPath('documents');
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: '保存视频',
    defaultPath: path.join(defaultDir, defaultName || `灵感画廊_${Date.now()}.webm`),
    filters: [
      { name: '视频文件', extensions: ['webm', 'mp4'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    lastSaveDirectory = path.dirname(filePath);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    fs.writeFileSync(filePath, buf);
    return { path: filePath };
  } catch (e) {
    return { error: '保存失败: ' + (e.message || e) };
  }
});

// 批量保存视频到用户选择的文件夹
ipcMain.handle('batch-save-videos', async (_event, videos) => {
  // videos: Array<{buffer: Buffer, filename: string}>
  const defaultDir = lastSaveDirectory || app.getPath('documents');
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: '选择保存文件夹',
    defaultPath: defaultDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true };
  const folder = filePaths[0];
  lastSaveDirectory = folder;
  const saved = [];
  for (const v of videos) {
    try {
      const buf = Buffer.isBuffer(v.buffer) ? v.buffer : Buffer.from(v.buffer);
      const fp = path.join(folder, v.filename);
      fs.writeFileSync(fp, buf);
      saved.push(fp);
    } catch (e) {
      console.error('Failed to save', v.filename, e);
    }
  }
  return { folder, saved, count: saved.length };
});

/**
 * 批量导出 MP4：选择文件夹，逐个将 webm 转 mp4
 * videos: Array<{buffer: Buffer, filename: string, duration: number}>
 */
ipcMain.handle('batch-export-mp4', async (_event, videos) => {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) return { error: '未找到 ffmpeg。请安装 ffmpeg-static 或系统 ffmpeg。' };

  const defaultDir = lastSaveDirectory || app.getPath('documents');
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: '选择保存文件夹（MP4）',
    defaultPath: defaultDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true };
  const folder = filePaths[0];
  lastSaveDirectory = folder;

  const tmpDir = require('os').tmpdir();
  const saved = [];
  const total = videos.length;

  for (let idx = 0; idx < total; idx++) {
    const v = videos[idx];
    const buf = Buffer.isBuffer(v.buffer) ? v.buffer : Buffer.from(v.buffer);
    const webmPath = path.join(tmpDir, `batch_${Date.now()}_${idx}.webm`);
    const mp4Name = v.filename.replace(/\.webm$/i, '.mp4');
    const mp4Path = path.join(folder, mp4Name);
    const totalSec = typeof v.duration === 'number' && v.duration > 0 ? v.duration : null;

    try {
      fs.writeFileSync(webmPath, buf);
    } catch (e) {
      console.error('batch-export-mp4: write tmp failed', e);
      continue;
    }

    // 发送 item 级进度：{index, total, percent}
    const sendItemProgress = (percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch-mp4-progress', { index: idx, total, percent });
      }
    };

    try {
      await new Promise((resolve, reject) => {
        const args = ['-i', webmPath, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-y', mp4Path];
        const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const timeRe = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;
        proc.stderr.on('data', (chunk) => {
          if (!totalSec) return;
          const m = chunk.toString().match(timeRe);
          if (m) {
            const sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
            sendItemProgress(Math.min(99, Math.round((sec / totalSec) * 100)));
          }
        });
        proc.on('close', (code) => {
          try { fs.unlinkSync(webmPath); } catch (_) {}
          if (code === 0) { sendItemProgress(100); saved.push(mp4Path); resolve(); }
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
        proc.on('error', (e) => { try { fs.unlinkSync(webmPath); } catch (_) {} reject(e); });
      });
    } catch (e) {
      console.error('batch-export-mp4: convert failed', v.filename, e);
    }
  }

  return { folder, saved, count: saved.length };
});

ipcMain.handle('export-video-as-mp4', async (event, webmBuffer, durationSeconds, suggestedName) => {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    return { error: '未找到 ffmpeg。请安装 ffmpeg-static 或系统 ffmpeg。' };
  }

  if (!Buffer.isBuffer(webmBuffer) && !(webmBuffer instanceof Uint8Array)) {
    return { error: '无效的视频数据' };
  }

  const buf = Buffer.isBuffer(webmBuffer) ? webmBuffer : Buffer.from(webmBuffer);
  const tmpDir = require('os').tmpdir();
  const webmPath = path.join(tmpDir, `gallery_${Date.now()}.webm`);
  const mp4Path = path.join(tmpDir, `gallery_${Date.now()}.mp4`);
  const totalSec = typeof durationSeconds === 'number' && durationSeconds > 0 ? durationSeconds : null;
  const sendProgress = (percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('export-mp4-progress', percent);
  };

  try {
    fs.writeFileSync(webmPath, buf);
  } catch (e) {
    return { error: '写入临时文件失败: ' + (e.message || e) };
  }

  const defaultDir = lastSaveDirectory || app.getPath('documents');
  const defaultName = (suggestedName && typeof suggestedName === 'string') ? suggestedName : `灵感画廊_${Date.now()}.mp4`;
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: '导出 MP4',
    defaultPath: path.join(defaultDir, defaultName),
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
  });

  if (canceled || !filePath) {
    try { fs.unlinkSync(webmPath); } catch (_) {}
    return { canceled: true };
  }
  try {
    lastSaveDirectory = path.dirname(filePath);
  } catch (_) {}

  return new Promise((resolve) => {
    const args = [
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-y',
      filePath,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    const timeRe = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (totalSec && mainWindow && !mainWindow.isDestroyed()) {
        const m = s.match(timeRe);
        if (m) {
          const h = parseInt(m[1], 10), min = parseInt(m[2], 10), sec = parseInt(m[3], 10), cent = parseInt(m[4], 10);
          const current = h * 3600 + min * 60 + sec + cent / 100;
          const pct = Math.min(99, Math.round((current / totalSec) * 100));
          sendProgress(pct);
        }
      }
    });
    proc.on('error', (err) => {
      try { fs.unlinkSync(webmPath); } catch (_) {}
      sendProgress(0);
      resolve({ error: 'ffmpeg 执行失败: ' + (err.message || err) });
    });
    proc.on('close', (code) => {
      try { fs.unlinkSync(webmPath); } catch (_) {}
      try { if (fs.existsSync(mp4Path) && mp4Path !== filePath) fs.unlinkSync(mp4Path); } catch (_) {}
      sendProgress(100);
      if (code === 0) {
        resolve({ path: filePath });
      } else {
        resolve({ error: '转换失败 (code ' + code + '): ' + (stderr.slice(-500) || '未知错误') });
      }
    });
  });
});
