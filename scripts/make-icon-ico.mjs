#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const buildDir = join(root, 'build');
const pngPath = join(buildDir, 'icon.png');
const icoPath = join(buildDir, 'icon.ico');

async function main() {
  try {
    const toIco = (await import('to-ico')).default;
    const smallPath = join(buildDir, 'icon_256.png');
    execSync(`sips -z 256 256 "${pngPath}" --out "${smallPath}"`, { stdio: 'pipe' });
    const png = readFileSync(smallPath);
    try { require('fs').unlinkSync(smallPath); } catch (_) {}
    const ico = await toIco(png, { sizes: [256, 128, 64, 48, 32, 16] });
    writeFileSync(icoPath, ico);
    console.log('Written', icoPath);
  } catch (e) {
    console.warn('to-ico failed:', e.message);
    process.exit(1);
  }
}
main();
