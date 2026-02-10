import React, { useState, useRef, useCallback } from 'react';
import { generateCreativePrompts, generateImageFromPrompt, getLastGeneratedTitle } from '../services/geminiService';
import { generateSpeech, generateSpeechBatch } from '../services/geminiService';
import { DOUBAO_SPEAKERS, DOUBAO_EMOTIONS } from '../services/doubaoTtsService';
import type { ReasoningEffort } from './InputArea';

/* ────── 常量 ────── */
const STYLES = [
  { id: 'Photorealistic', label: '写实摄影' },
  { id: 'Cyberpunk', label: '赛博朋克' },
  { id: 'Anime', label: '日系动漫' },
  { id: 'Watercolor', label: '水彩画' },
  { id: 'Oil Painting', label: '经典油画' },
  { id: '3D Render', label: '3D 渲染' },
];
const RATIOS = [
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
];
const SPEEDS = Array.from({ length: 13 }, (_, i) => parseFloat((0.7 + i * 0.05).toFixed(2)));

const BGM_TRACKS = [
  { id: 'none', label: '无音乐', url: '' },
  { id: 'mixkit-classical-10-717', label: '古典钢琴叙事', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-10-717.mp3' },
  { id: 'mixkit-classical-vibes-4-684', label: '古典氛围·四', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-vibes-4-684.mp3' },
  { id: 'mixkit-upbeat-jazz-644', label: '轻快爵士', url: 'https://assets.mixkit.co/music/preview/mixkit-upbeat-jazz-644.mp3' },
];

const getCanvasDims = (ratio: string) => {
  switch (ratio) {
    case '16:9': return { width: 1920, height: 1080 };
    case '4:3': return { width: 1440, height: 1080 };
    case '3:4': return { width: 1080, height: 1440 };
    case '9:16': return { width: 1080, height: 1920 };
    case '1:1': default: return { width: 1024, height: 1024 };
  }
};

function fillRoundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof (ctx as any).roundRect === 'function') { ctx.beginPath(); (ctx as any).roundRect(x, y, w, h, r); ctx.fill(); return; }
  const pi = Math.PI;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -pi / 2, 0);
  ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, pi / 2);
  ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, pi / 2, pi);
  ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, pi, (pi * 3) / 2); ctx.closePath(); ctx.fill();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (/\s/.test(text)) {
    const words = text.split(/\s+/); let line = ''; const lines: string[] = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else { line = t; } }
    if (line) lines.push(line); return lines;
  }
  const lines: string[] = []; let line = '';
  for (const c of text) { const t = line + c; if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = c; } else { line = t; } }
  if (line) lines.push(line); return lines;
}

/* ────── 批量项状态 ────── */
export interface BatchItem {
  id: number;
  text: string;
  title: string;
  status: 'pending' | 'prompts' | 'images' | 'video' | 'done' | 'error';
  progress: number; // 0-100
  blob?: Blob;
  duration?: number; // 视频时长（秒）
  error?: string;
}

interface BatchPanelProps {
  onClose: () => void;
}

/* ────── Phase 1: 准备素材（网络 I/O 为主，可并行） ────── */
interface PreparedAssets {
  title: string;
  text: string;
  imageBlobs: Blob[];
  sentences: string[];
  segmentBuffers: ArrayBuffer[];
  segmentDurations: number[];
  combinedPcm: Int16Array;
}

type BatchOpts = {
  style: string; ratio: string; imageCount: number; viewDistance: string;
  speaker: string; emotion: string; speed: number; musicId: string;
  bgmVolume: number; fastAudio: boolean; lowSpec: boolean;
};

async function prepareAssets(
  text: string,
  opts: BatchOpts,
  onStatus: (s: BatchItem['status'], progress: number) => void,
): Promise<PreparedAssets> {
  const SAMPLE_RATE = 24000;
  const PAUSE_BETWEEN_SENTENCES = 0.35;

  // 1. 生成 prompts + 标题
  onStatus('prompts', 5);
  const results = await generateCreativePrompts(text, opts.style, opts.imageCount, opts.viewDistance, 'minimal');
  const title = getLastGeneratedTitle() || text.slice(0, 6).replace(/[。！？.!?\s]/g, '');
  if (results.length === 0) throw new Error('Prompt 生成失败');
  onStatus('prompts', 15);

  // 2. 并行：生成图片 + 合成音频
  const fetchImageBlob = async (url: string): Promise<Blob | null> => {
    try { const d = await fetch(url, { mode: 'cors' }); if (d.ok) { const b = await d.blob(); if (b.type.startsWith('image/')) return b; } } catch (_) {}
    try { const o = typeof window !== 'undefined' ? window.location?.origin : ''; const base = o && o !== 'null' ? o : ''; const pu = base ? `${base}/api/proxy?url=${encodeURIComponent(url)}` : `/api/proxy?url=${encodeURIComponent(url)}`; const r = await fetch(pu); if (r.ok) return await r.blob(); } catch (_) {}
    return null;
  };

  const getSentenceList = (t: string): string[] => {
    const raw = (t || ' ').trim();
    const rx = /[^。！？.!?\n]+[。！？.!?\n]?|[^。！？.!?\n]+$/g;
    return raw.match(rx)?.map(s => s.trim()).filter(Boolean) || [raw];
  };
  const sentences = getSentenceList(text);
  const speechOptions = opts.emotion ? { emotion: opts.emotion } : undefined;

  // 图片和音频并行
  onStatus('images', 20);
  const [imgSettled, segmentBuffers] = await Promise.all([
    // 图片
    Promise.allSettled(results.map(async (r, i) => {
      const url = await generateImageFromPrompt(r.prompt, opts.ratio, i);
      return fetchImageBlob(url);
    })),
    // 音频
    opts.fastAudio
      ? generateSpeechBatch(sentences, opts.speaker, speechOptions)
      : (async () => { const bufs: ArrayBuffer[] = []; for (const s of sentences) bufs.push(await generateSpeech(s, opts.speaker, speechOptions)); return bufs; })(),
  ]);

  const imageBlobs: Blob[] = [];
  for (const s of imgSettled) { if (s.status === 'fulfilled' && s.value) imageBlobs.push(s.value); }
  if (imageBlobs.length === 0) throw new Error('所有图片生成失败');

  // 拼接 PCM
  const segmentDurations = segmentBuffers.map(b => (b.byteLength / 2) / SAMPLE_RATE);
  const silenceSamples = Math.round(PAUSE_BETWEEN_SENTENCES * SAMPLE_RATE);
  const totalSamples = segmentBuffers.reduce((sum, b) => sum + b.byteLength / 2, 0) + (sentences.length > 1 ? (sentences.length - 1) * silenceSamples : 0);
  const combined = new Int16Array(totalSamples);
  let offset = 0;
  for (let i = 0; i < segmentBuffers.length; i++) {
    const view = new Int16Array(segmentBuffers[i]);
    combined.set(view, offset);
    offset += view.length;
    if (i < segmentBuffers.length - 1) offset += silenceSamples;
  }
  onStatus('images', 50);

  return { title, text, imageBlobs, sentences, segmentBuffers, segmentDurations, combinedPcm: combined };
}

/* ────── Phase 2: 录制视频（CPU 密集，必须串行） ────── */
async function recordVideo(
  assets: PreparedAssets,
  opts: BatchOpts,
  onStatus: (s: BatchItem['status'], progress: number) => void,
): Promise<{ blob: Blob; title: string; duration: number }> {
  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop;
  const INTRO_PADDING = 1.5;
  const OUTRO_PADDING = 1.5;
  const SAMPLE_RATE = 24000;
  const PAUSE_BETWEEN_SENTENCES = 0.35;

  onStatus('video', 55);

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  await audioCtx.resume();

  const voiceAudioBuf = audioCtx.createBuffer(1, assets.combinedPcm.length, SAMPLE_RATE);
  const ch = voiceAudioBuf.getChannelData(0);
  for (let i = 0; i < assets.combinedPcm.length; i++) ch[i] = assets.combinedPcm[i] / 32768;

  // BGM
  let musicAudioBuffer: AudioBuffer | null = null;
  const track = BGM_TRACKS.find(t => t.id === opts.musicId);
  if (track && track.id !== 'none') {
    const o = typeof window !== 'undefined' ? window.location?.origin : '';
    const base = o && o !== 'null' ? o : '';
    const localUrl = base ? `${base}/bgm/${track.id}.mp3` : `/bgm/${track.id}.mp3`;
    for (const u of [localUrl, track.url].filter(Boolean)) {
      try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { musicAudioBuffer = await audioCtx.decodeAudioData(await r.arrayBuffer()); break; } } catch (_) {}
    }
  }

  const dest = audioCtx.createMediaStreamDestination();
  const voiceSource = audioCtx.createBufferSource();
  voiceSource.buffer = voiceAudioBuf;
  voiceSource.playbackRate.value = opts.speed;
  voiceSource.connect(dest);
  const voiceDuration = voiceAudioBuf.duration / opts.speed;
  const totalDuration = INTRO_PADDING + voiceDuration + OUTRO_PADDING;

  let musicSource: AudioBufferSourceNode | undefined;
  if (musicAudioBuffer) {
    musicSource = audioCtx.createBufferSource();
    musicSource.buffer = musicAudioBuffer;
    musicSource.loop = true;
    const gain = audioCtx.createGain();
    gain.gain.value = (opts.bgmVolume / 100) * 0.4;
    musicSource.connect(gain);
    gain.connect(dest);
  }
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  const osc = audioCtx.createOscillator();
  osc.connect(silentGain);
  silentGain.connect(dest);
  osc.start();

  const voiceStart = INTRO_PADDING;
  const voiceEnd = voiceStart + voiceDuration;
  let cumTime = voiceStart;
  const timedSubtitles = assets.segmentDurations.map((dur, i) => {
    const d = dur / opts.speed;
    const s = { text: assets.sentences[i] || '', start: cumTime, end: cumTime + d };
    cumTime += d + PAUSE_BETWEEN_SENTENCES / opts.speed;
    return s;
  });

  const canvas = document.createElement('canvas');
  const dims = getCanvasDims(opts.ratio);
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;

  const imgCount = assets.imageBlobs.length;
  const autoLowSpec = opts.lowSpec || imgCount >= (isDesktop ? 8 : 6);
  const MAX_SOURCE_SIZE = autoLowSpec ? 800 : 1280;
  const MAX_SCALE = 1.15;
  const MAX_PRE_SIZE = autoLowSpec ? 1600 : 2560;

  const preRendered: { bitmap: ImageBitmap; w: number; h: number }[] = [];
  for (const blob of assets.imageBlobs) {
    try {
      const bitmap = await createImageBitmap(blob);
      const w = bitmap.width, h = bitmap.height;
      const imgRatio = w / h, canvasRatio = dims.width / dims.height;
      let drawW: number, drawH: number;
      if (imgRatio > canvasRatio) { drawH = dims.height; drawW = drawH * imgRatio; } else { drawW = dims.width; drawH = drawW / imgRatio; }
      let preW = Math.ceil(drawW * MAX_SCALE), preH = Math.ceil(drawH * MAX_SCALE);
      if (preW > MAX_PRE_SIZE || preH > MAX_PRE_SIZE) { const r = Math.min(MAX_PRE_SIZE / preW, MAX_PRE_SIZE / preH); preW = Math.ceil(preW * r); preH = Math.ceil(preH * r); }
      if (typeof OffscreenCanvas !== 'undefined') {
        const long = Math.max(w, h);
        const smallW = long <= MAX_SOURCE_SIZE ? w : (w >= h ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * w) / h));
        const smallH = long <= MAX_SOURCE_SIZE ? h : (h >= w ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * h) / w));
        const tc = new OffscreenCanvas(smallW, smallH);
        const tctx = tc.getContext('2d', { alpha: false });
        if (tctx) { tctx.drawImage(bitmap, 0, 0, w, h, 0, 0, smallW, smallH); const oc = new OffscreenCanvas(preW, preH); const octx = oc.getContext('2d', { alpha: false }); if (octx) { octx.drawImage(tc, 0, 0, smallW, smallH, 0, 0, preW, preH); const rb = await createImageBitmap(oc); preRendered.push({ bitmap: rb, w: preW, h: preH }); bitmap.close?.(); } else { preRendered.push({ bitmap, w, h }); } } else { preRendered.push({ bitmap, w, h }); }
      } else { preRendered.push({ bitmap, w, h }); }
    } catch (_) {}
  }
  if (preRendered.length === 0) { audioCtx.close(); throw new Error('图片预渲染全部失败'); }

  const imageDisplayDuration = totalDuration / preRendered.length;
  const animConfigs = preRendered.map((_, i) => {
    const seed = i; const zoomIn = seed % 2 === 0;
    const pdx = (seed % 3) - 1, pdy = (seed % 2) * 2 - 1;
    const ox = 0.4 + (seed * 0.17) % 0.2, oy = 0.4 + (seed * 0.13) % 0.2;
    return { scaleStart: zoomIn ? 1.0 : 1.15, scaleEnd: zoomIn ? 1.15 : 1.0, panXStart: ox - pdx * 0.05, panXEnd: ox + pdx * 0.05, panYStart: oy - pdy * 0.05, panYEnd: oy + pdy * 0.05, originX: ox, originY: oy };
  });

  const subtitleFontSize = Math.floor(dims.height * 0.042);
  const subtitleMaxWidth = dims.width * 0.88;
  ctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const precomputedSubtitleLines = timedSubtitles.map(s => wrapText(ctx, s.text.trim(), subtitleMaxWidth));
  const lineHeight = subtitleFontSize * 1.35;
  const boxPadding = subtitleFontSize * 0.7;
  const SUBTITLE_LEAD = 0.12;
  let subtitleCache: HTMLCanvasElement | null = null;
  let lastSubtitleKey = '';
  let lastSubtitleBox = { bx: 0, by: 0, boxWidth: 0, boxHeight: 0 };

  const captureFps = autoLowSpec && !isDesktop ? 24 : 30;
  const canvasStream = canvas.captureStream(captureFps);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const preferVp8 = 'video/webm; codecs=vp8,opus';
  const mimeType = MediaRecorder.isTypeSupported(preferVp8) ? preferVp8 : 'video/webm; codecs=vp9,opus';
  const bitsPerSecond = autoLowSpec ? (isDesktop ? 4000000 : 2500000) : (isDesktop ? 6000000 : 4000000);
  const mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm', videoBitsPerSecond: bitsPerSecond });
  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<{ blob: Blob; title: string; duration: number }>((resolve, reject) => {
    mediaRecorder.onstop = () => {
      try { voiceSource.stop(); voiceSource.disconnect(); } catch (_) {}
      if (musicSource) try { musicSource.stop(); musicSource.disconnect(); } catch (_) {}
      try { silentGain.disconnect(); osc.stop(); } catch (_) {}
      audioCtx.close();
      preRendered.forEach(p => p.bitmap.close?.());
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mimeType });
      onStatus('done', 100);
      resolve({ blob, title: assets.title, duration: totalDuration });
    };
    mediaRecorder.onerror = () => { audioCtx.close(); reject(new Error('MediaRecorder error')); };
    mediaRecorder.start();
    const startTime = audioCtx.currentTime + 0.1;
    voiceSource.start(startTime + INTRO_PADDING);
    if (musicSource) musicSource.start(startTime);

    const RENDER_INTERVAL = 1000 / captureFps;
    let lastFrameTime = 0;
    const textOffsets: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let rafId: number;
    const renderLoop = (timestamp?: number) => {
      if (timestamp && lastFrameTime && (timestamp - lastFrameTime) < RENDER_INTERVAL * 0.9) { rafId = requestAnimationFrame(renderLoop); return; }
      lastFrameTime = timestamp || performance.now();
      const elapsed = audioCtx.currentTime - startTime;
      if (elapsed >= totalDuration) { onStatus('video', 98); if (mediaRecorder.state === 'recording') mediaRecorder.stop(); cancelAnimationFrame(rafId); return; }
      try {
        const slideIndex = Math.min(preRendered.length - 1, Math.max(0, Math.floor(elapsed / imageDisplayDuration)));
        const slideLocalTime = elapsed - slideIndex * imageDisplayDuration;
        const p = Math.max(0, Math.min(1, slideLocalTime / imageDisplayDuration));
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pre = preRendered[slideIndex], config = animConfigs[slideIndex];
        if (pre && config) {
          const dw = pre.w / MAX_SCALE, dh = pre.h / MAX_SCALE;
          const scale = config.scaleStart + (config.scaleEnd - config.scaleStart) * p;
          const sw = dw * scale, sh = dh * scale;
          const px = config.panXStart + (config.panXEnd - config.panXStart) * p;
          const py = config.panYStart + (config.panYEnd - config.panYStart) * p;
          try { ctx.drawImage(pre.bitmap, 0, 0, pre.w, pre.h, canvas.width * px - sw / 2, canvas.height * py - sh / 2, sw, sh); } catch (_) {}
        }
        const inVoiceWindow = elapsed >= voiceStart && elapsed < voiceEnd;
        const activeSubs = inVoiceWindow ? timedSubtitles.filter(s => { if (!s.text.trim()) return false; const sf = Math.max(voiceStart, s.start - SUBTITLE_LEAD); return elapsed >= sf && elapsed < s.end; }) : [];
        if (activeSubs.length > 0) {
          const allLines = activeSubs.flatMap(sub => { const i = timedSubtitles.indexOf(sub); return (i >= 0 && precomputedSubtitleLines[i]?.length) ? precomputedSubtitleLines[i] : []; });
          if (allLines.length > 0) {
            const totalTextH = allLines.length * lineHeight; const boxH = totalTextH + boxPadding * 2; const boxW = subtitleMaxWidth + boxPadding * 2;
            const bx = (canvas.width - boxW) / 2; const by = (canvas.height - canvas.height * 0.11) - boxH / 2;
            const subKey = activeSubs.map(s => timedSubtitles.indexOf(s)).join(',');
            if (subKey !== lastSubtitleKey) {
              if (!subtitleCache || subtitleCache.width !== boxW || subtitleCache.height !== boxH) { subtitleCache = document.createElement('canvas'); subtitleCache.width = boxW; subtitleCache.height = boxH; }
              const sctx = subtitleCache.getContext('2d', { alpha: true, willReadFrequently: false })!;
              sctx.clearRect(0, 0, boxW, boxH); sctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
              sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
              sctx.fillStyle = 'rgba(0,0,0,0.6)'; fillRoundRect(sctx, 0, 0, boxW, boxH, 12);
              sctx.fillStyle = 'rgba(0,0,0,0.85)';
              allLines.forEach((line, i) => { const cy = boxPadding + (i + 0.5) * lineHeight; textOffsets.forEach(([dx, dy]) => sctx.fillText(line, boxW / 2 + dx, cy + dy)); });
              sctx.fillStyle = '#fff';
              allLines.forEach((line, i) => { sctx.fillText(line, boxW / 2, boxPadding + (i + 0.5) * lineHeight); });
              lastSubtitleKey = subKey; lastSubtitleBox = { bx, by, boxWidth: boxW, boxHeight: boxH };
            }
            ctx.drawImage(subtitleCache!, 0, 0, lastSubtitleBox.boxWidth, lastSubtitleBox.boxHeight, lastSubtitleBox.bx, lastSubtitleBox.by, lastSubtitleBox.boxWidth, lastSubtitleBox.boxHeight);
          }
        } else { lastSubtitleKey = ''; }
      } catch (_) {}
      const pct = Math.min(98, 55 + (elapsed / totalDuration) * 43);
      onStatus('video', pct);
      rafId = requestAnimationFrame(renderLoop);
    };
    renderLoop(performance.now());
  });
}

/* ────── 组件 ────── */
const BatchPanel: React.FC<BatchPanelProps> = ({ onClose }) => {
  const [rawText, setRawText] = useState('');
  const [style, setStyle] = useState('Photorealistic');
  const [ratio, setRatio] = useState('4:3');
  const [imageCount, setImageCount] = useState(4);
  const [speaker, setSpeaker] = useState(DOUBAO_SPEAKERS[0].id);
  const [emotion, setEmotion] = useState('authoritative');
  const [speed, setSpeed] = useState(0.85);
  const [musicId, setMusicId] = useState('mixkit-classical-10-717');
  const [bgmVolume, setBgmVolume] = useState(60);
  const [fastAudio, setFastAudio] = useState(true);
  const [lowSpec, setLowSpec] = useState(false);

  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [allDone, setAllDone] = useState(false);
  const [exportFormat, setExportFormat] = useState<'mp4' | 'webm'>('mp4');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(''); // 导出进度文案
  const abortRef = useRef(false);

  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop;

  /** 解析文本：用 --- 或连续空行分隔 */
  const parseTexts = useCallback((raw: string): string[] => {
    return raw
      .split(/\n\s*---\s*\n|\n{2,}/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }, []);

  const parsedTexts = parseTexts(rawText);

  /** 开始批量生成 — 流水线模式：录制视频 N 的同时预加载视频 N+1 的素材 */
  const handleStart = async () => {
    if (parsedTexts.length === 0) return;
    abortRef.current = false;
    setRunning(true);
    setAllDone(false);

    const initialItems: BatchItem[] = parsedTexts.map((text, i) => ({
      id: i, text, title: '', status: 'pending' as const, progress: 0,
    }));
    setItems(initialItems);

    const opts: BatchOpts = { style, ratio, imageCount, viewDistance: 'Default', speaker, emotion, speed, musicId, bgmVolume, fastAudio, lowSpec };

    // 更新某项状态的辅助函数
    const updateItem = (idx: number, patch: Partial<BatchItem>) => {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
    };

    // 流水线：预加载缓存，key = index
    const assetCache = new Map<number, Promise<PreparedAssets>>();
    const PREFETCH_AHEAD = 2; // 同时预加载接下来 2 个

    /** 启动某项的素材准备（如果未启动过） */
    const ensurePrefetch = (idx: number) => {
      if (idx >= initialItems.length || assetCache.has(idx) || abortRef.current) return;
      updateItem(idx, { status: 'prompts', progress: 2 });
      assetCache.set(idx, prepareAssets(
        initialItems[idx].text,
        opts,
        (status, progress) => updateItem(idx, { status, progress }),
      ));
    };

    // 预加载前几个
    for (let k = 0; k < Math.min(PREFETCH_AHEAD, initialItems.length); k++) {
      ensurePrefetch(k);
    }

    // 逐个录制视频（串行），同时预加载后续素材
    for (let i = 0; i < initialItems.length; i++) {
      if (abortRef.current) break;
      setCurrentIdx(i);

      // 确保当前项的素材已启动
      ensurePrefetch(i);

      try {
        // 等待当前项素材就绪
        const assets = await assetCache.get(i)!;
        updateItem(i, { title: assets.title });

        // 素材就绪后，立即启动后续预加载
        for (let k = i + 1; k <= i + PREFETCH_AHEAD && k < initialItems.length; k++) {
          ensurePrefetch(k);
        }

        // 录制视频（CPU 密集，串行）
        const result = await recordVideo(assets, opts, (status, progress) => updateItem(i, { status, progress }));
        updateItem(i, { status: 'done', progress: 100, blob: result.blob, title: result.title, duration: result.duration });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateItem(i, { status: 'error', error: msg, progress: 0 });
      }

      // 继续预加载
      ensurePrefetch(i + PREFETCH_AHEAD);
    }

    setRunning(false);
    setAllDone(true);
    setCurrentIdx(-1);
    if (typeof window !== 'undefined' && (window as any).electronAPI?.showNotification) {
      (window as any).electronAPI.showNotification('灵感画廊', '批量视频生成完成');
    }
  };

  /** 中止 */
  const handleAbort = () => { abortRef.current = true; };

  /** 监听批量 MP4 转换进度 */
  React.useEffect(() => {
    if (!isDesktop || !(window as any).electronAPI?.onBatchMp4Progress) return;
    const unsub = (window as any).electronAPI.onBatchMp4Progress((data: { index: number; total: number; percent: number }) => {
      setExportProgress(`正在转换 MP4（${data.index + 1}/${data.total}）${data.percent}%`);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [isDesktop]);

  /** 导出全部到文件夹 */
  const handleExportAll = async () => {
    const doneItems = items.filter(it => it.status === 'done' && it.blob);
    if (doneItems.length === 0) return;

    setExporting(true);
    setExportProgress('');

    try {
      if (exportFormat === 'mp4' && isDesktop && (window as any).electronAPI?.batchExportMp4) {
        // MP4：需要 ffmpeg 转换
        setExportProgress('准备导出 MP4...');
        const videos = doneItems.map((it, i) => ({
          arrayBuffer: it.blob!.arrayBuffer(),
          filename: `${it.title || `视频${i + 1}`}.webm`,
          duration: it.duration || 0,
        }));
        const resolved = await Promise.all(videos.map(async v => ({
          arrayBuffer: await v.arrayBuffer,
          filename: v.filename,
          duration: v.duration,
        })));
        const result = await (window as any).electronAPI.batchExportMp4(resolved);
        if (result && !result.canceled && !result.error) {
          setExportProgress(`已保存 ${result.count} 个 MP4 到: ${result.folder}`);
        } else if (result?.error) {
          setExportProgress(`导出失败: ${result.error}`);
        }
      } else if (isDesktop && (window as any).electronAPI?.batchSaveVideos) {
        // WebM 桌面版
        const videos = doneItems.map((it, i) => ({
          arrayBuffer: it.blob!.arrayBuffer(),
          filename: `${it.title || `视频${i + 1}`}.webm`,
        }));
        const resolved = await Promise.all(videos.map(async v => ({ arrayBuffer: await v.arrayBuffer, filename: v.filename })));
        const result = await (window as any).electronAPI.batchSaveVideos(resolved);
        if (result && !result.canceled) {
          setExportProgress(`已保存 ${result.count} 个 WebM 到: ${result.folder}`);
        }
      } else {
        // Web: 逐个下载 WebM
        const ext = exportFormat === 'mp4' ? 'webm' : 'webm'; // Web 环境只能下载 webm
        for (const it of doneItems) {
          const url = URL.createObjectURL(it.blob!);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${it.title || '视频'}.${ext}`;
          a.click();
          URL.revokeObjectURL(url);
          await new Promise(r => setTimeout(r, 500));
        }
        setExportProgress(`已下载 ${doneItems.length} 个视频`);
      }
    } finally {
      setExporting(false);
    }
  };

  const doneCount = items.filter(it => it.status === 'done').length;
  const errorCount = items.filter(it => it.status === 'error').length;

  const statusLabel = (s: BatchItem['status']) => {
    switch (s) {
      case 'pending': return '等待中';
      case 'prompts': return '生成提示词';
      case 'images': return '生成图片';
      case 'video': return '录制视频';
      case 'done': return '完成';
      case 'error': return '失败';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 md:p-8">
      <div className="bg-[#0a0a0a] border border-[#222] rounded-xl w-full max-w-4xl shadow-2xl my-4">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#222]">
          <h2 className="text-xl font-serif italic text-[#d4af37] flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path fillRule="evenodd" d="M2.625 6.75a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zm4.875 0A.75.75 0 018.25 6h12a.75.75 0 010 1.5h-12a.75.75 0 01-.75-.75zM2.625 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM7.5 12a.75.75 0 01.75-.75h12a.75.75 0 010 1.5h-12A.75.75 0 017.5 12zm-4.875 5.25a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zm4.875 0a.75.75 0 01.75-.75h12a.75.75 0 010 1.5h-12a.75.75 0 01-.75-.75z" clipRule="evenodd" />
            </svg>
            批量生成
          </h2>
          <button onClick={onClose} disabled={running} className="text-slate-500 hover:text-white p-2 disabled:opacity-30">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 文本输入 */}
          {!running && !allDone && (
            <>
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  输入多段文本（用 <code className="bg-[#1a1a1a] px-1.5 py-0.5 rounded text-[#d4af37] text-xs">---</code> 或空行分隔，每段生成一个视频）
                </label>
                <textarea
                  id="batch-textarea"
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  className="w-full h-48 p-4 bg-[#111] border border-[#333] rounded-lg text-slate-300 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/50 focus:outline-none resize-none text-sm leading-relaxed placeholder-slate-600"
                  placeholder={"第一段文本内容...\n\n---\n\n第二段文本内容...\n\n---\n\n第三段文本内容..."}
                />
                <div className="flex items-center justify-between mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const ta = document.querySelector<HTMLTextAreaElement>('#batch-textarea');
                      if (!ta) { setRawText(prev => prev + (prev.endsWith('\n') ? '' : '\n') + '\n---\n\n'); return; }
                      const start = ta.selectionStart;
                      const before = rawText.slice(0, start);
                      const after = rawText.slice(ta.selectionEnd);
                      const sep = (before.endsWith('\n') ? '' : '\n') + '\n---\n\n';
                      const newText = before + sep + after;
                      setRawText(newText);
                      requestAnimationFrame(() => { const pos = start + sep.length; ta.setSelectionRange(pos, pos); ta.focus(); });
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#d4af37]/70 hover:text-[#d4af37] border border-[#d4af37]/20 hover:border-[#d4af37]/50 px-2.5 py-1 rounded transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    插入分隔符
                  </button>
                  <div className="text-xs text-slate-500">
                    识别到 <span className="text-[#d4af37]">{parsedTexts.length}</span> 段文本
                  </div>
                </div>
              </div>

              {/* 统一设置 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* 风格 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">风格</label>
                  <select value={style} onChange={e => setStyle(e.target.value)} className="w-full bg-[#111] border border-[#333] text-slate-300 rounded px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none">
                    {STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                {/* 画幅 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">画幅</label>
                  <select value={ratio} onChange={e => setRatio(e.target.value)} className="w-full bg-[#111] border border-[#333] text-slate-300 rounded px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none">
                    {RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
                {/* 场景数 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">场景数</label>
                  <select value={imageCount} onChange={e => setImageCount(+e.target.value)} className="w-full bg-[#111] border border-[#333] text-slate-300 rounded px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none">
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} 张</option>)}
                  </select>
                </div>
                {/* 音色 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">音色</label>
                  <select value={speaker} onChange={e => setSpeaker(e.target.value)} className="w-full bg-[#111] border border-[#333] text-slate-300 rounded px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none">
                    {DOUBAO_SPEAKERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                {/* 语速 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">语速 {speed}x</label>
                  <input type="range" min={0.7} max={1.3} step={0.05} value={speed} onChange={e => setSpeed(+e.target.value)} className="w-full accent-[#d4af37]" />
                </div>
                {/* BGM */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">背景音乐</label>
                  <select value={musicId} onChange={e => setMusicId(e.target.value)} className="w-full bg-[#111] border border-[#333] text-slate-300 rounded px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none">
                    {BGM_TRACKS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                {/* BGM 音量 */}
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">BGM 音量 {bgmVolume}%</label>
                  <input type="range" min={0} max={100} step={5} value={bgmVolume} onChange={e => setBgmVolume(+e.target.value)} className="w-full accent-[#d4af37]" />
                </div>
                {/* 极速模式 */}
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input type="checkbox" checked={fastAudio} onChange={e => setFastAudio(e.target.checked)} className="rounded border-[#333] bg-[#111] text-[#d4af37]" />
                    极速模式
                  </label>
                </div>
              </div>

              {/* 开始按钮 */}
              <button
                onClick={handleStart}
                disabled={parsedTexts.length === 0}
                className="w-full py-3 bg-gradient-to-r from-[#d4af37] to-[#c9a227] hover:from-[#e5c04a] hover:to-[#d4af37] disabled:opacity-40 text-black font-medium text-base rounded-lg transition-all shadow-[0_4px_20px_0_rgba(212,175,55,0.3)]"
              >
                开始批量生成（{parsedTexts.length} 个视频）
              </button>
            </>
          )}

          {/* 进度面板 */}
          {(running || allDone) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-400">
                  {running ? (
                    <span>正在生成 <span className="text-[#d4af37]">{currentIdx + 1}</span> / {items.length}</span>
                  ) : (
                    <span>已完成 <span className="text-emerald-400">{doneCount}</span> 个{errorCount > 0 && <span>，<span className="text-red-400">{errorCount}</span> 个失败</span>}</span>
                  )}
                </div>
                {running && (
                  <button onClick={handleAbort} className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 px-3 py-1 rounded transition-colors">
                    中止
                  </button>
                )}
              </div>

              {/* 总进度条 */}
              <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#d4af37] transition-all duration-300 rounded-full"
                  style={{ width: `${items.length > 0 ? (items.reduce((s, it) => s + it.progress, 0) / items.length) : 0}%` }}
                />
              </div>

              {/* 列表 */}
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {items.map((it, i) => (
                  <div key={it.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    it.status === 'done' ? 'bg-emerald-950/20 border-emerald-800/30' :
                    it.status === 'error' ? 'bg-red-950/20 border-red-800/30' :
                    i === currentIdx ? 'bg-[#1a1700] border-[#d4af37]/30' :
                    'bg-[#111] border-[#222]'
                  }`}>
                    {/* 状态图标 */}
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      {it.status === 'done' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-emerald-500">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                        </svg>
                      ) : it.status === 'error' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-500">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                        </svg>
                      ) : it.status === 'pending' ? (
                        <span className="text-xs text-slate-600 font-mono">{i + 1}</span>
                      ) : (
                        <span className="w-4 h-4 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-300 truncate">
                        {it.title ? <span className="text-[#d4af37] mr-1.5">{it.title}</span> : null}
                        {it.text.slice(0, 40)}{it.text.length > 40 ? '...' : ''}
                      </div>
                      {(it.status !== 'pending' && it.status !== 'done' && it.status !== 'error') && (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                            <div className="h-full bg-[#d4af37] transition-all duration-300 rounded-full" style={{ width: `${it.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500 tabular-nums">{statusLabel(it.status)}</span>
                        </div>
                      )}
                      {it.status === 'error' && it.error && (
                        <div className="text-[10px] text-red-400 mt-0.5 truncate">{it.error}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* 操作按钮 */}
              {allDone && doneCount > 0 && (
                <div className="space-y-2 pt-2">
                  {/* 格式选择 */}
                  {isDesktop && (
                    <div className="flex items-center gap-3 px-1">
                      <span className="text-xs text-slate-400">导出格式：</span>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="batchFmt" value="mp4"
                          checked={exportFormat === 'mp4'}
                          onChange={() => setExportFormat('mp4')}
                          className="accent-[#d4af37]"
                        />
                        <span className={`text-sm ${exportFormat === 'mp4' ? 'text-[#d4af37] font-medium' : 'text-slate-400'}`}>MP4</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="batchFmt" value="webm"
                          checked={exportFormat === 'webm'}
                          onChange={() => setExportFormat('webm')}
                          className="accent-[#d4af37]"
                        />
                        <span className={`text-sm ${exportFormat === 'webm' ? 'text-[#d4af37] font-medium' : 'text-slate-400'}`}>WebM</span>
                      </label>
                    </div>
                  )}
                  {/* 导出进度提示 */}
                  {exportProgress && (
                    <div className="text-xs text-slate-400 px-1 py-1">{exportProgress}</div>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={handleExportAll}
                      disabled={exporting}
                      className={`flex-1 py-3 ${exporting ? 'bg-slate-700 cursor-wait' : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600'} text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2`}
                    >
                      {exporting ? (
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                      )}
                      {exporting
                        ? '正在导出...'
                        : isDesktop
                          ? `导出全部${exportFormat === 'mp4' ? ' MP4' : ' WebM'} 到文件夹（${doneCount} 个）`
                          : `下载全部（${doneCount} 个）`}
                    </button>
                    <button
                      onClick={() => { setItems([]); setAllDone(false); setCurrentIdx(-1); setExportProgress(''); }}
                      className="px-4 py-3 text-slate-500 hover:text-slate-200 border border-slate-600/30 hover:border-slate-400/50 rounded-lg transition-all text-sm"
                    >
                      重新开始
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchPanel;
