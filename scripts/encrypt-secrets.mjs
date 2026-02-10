#!/usr/bin/env node
/**
 * 从 .env / .env.local 读取敏感配置，用 AES-256-GCM 加密后写入 build/secrets.enc
 * 桌面版打包前运行：npm run secrets:encrypt
 * 密钥由固定应用盐派生，仅用于混淆，分发后仍可能被逆向。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ELECTRON_DIR = join(root, 'electron');
const OUT_FILE = join(ELECTRON_DIR, 'secrets.enc');

const KEYS_TO_ENCRYPT = [
  'VITE_DOUBAO_API_KEY',
  'VITE_DOUBAO_TTS_ACCESS_KEY',
  'VITE_DOUBAO_TTS_APP_ID',
  'VITE_DOUBAO_TTS_BIGTTS_INSTANCE',
  'DOUBAO_TTS_ACCESS_KEY',
  'DOUBAO_TTS_SECRET_KEY',
  'VITE_DOUBAO_TTS_SECRET_KEY',
  'GEMINI_API_KEY',
];

function loadEnv() {
  const env = {};
  for (const name of ['.env', '.env.local']) {
    const p = join(root, name);
    try {
      const content = readFileSync(p, 'utf8');
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
  return createHash('sha256').update(salt).digest();
}

function encrypt(plainText, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]);
}

const env = loadEnv();
const payload = {};
let hasAny = false;
for (const key of KEYS_TO_ENCRYPT) {
  const v = (env[key] || '').trim();
  if (v) {
    payload[key] = v;
    hasAny = true;
  }
}

if (!hasAny) {
  console.warn('未找到任何要加密的 Key（.env / .env.local 中需包含上述变量之一）。跳过写入。');
  process.exit(0);
}

const salt = '听说在线-灵感画廊-app-salt-v1';
const key = deriveKey(salt);
const plain = JSON.stringify(payload);
const encrypted = encrypt(plain, key);

if (!existsSync(ELECTRON_DIR)) mkdirSync(ELECTRON_DIR, { recursive: true });
writeFileSync(OUT_FILE, encrypted);
console.log('已写入', OUT_FILE, '（共', Object.keys(payload).length, '个 Key）');
