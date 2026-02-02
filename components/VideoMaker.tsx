import React, { useState, useRef, useEffect } from 'react';
import { generateSpeech } from '../services/geminiService';
import { DOUBAO_SPEAKERS, DOUBAO_EMOTIONS } from '../services/doubaoTtsService';
import { GeneratedItem } from '../types';

interface VideoMakerProps {
  images: GeneratedItem[];
  originalText: string;
  aspectRatio: string;
  style: string;
}

const SPEEDS = Array.from({ length: 13 }, (_, i) => {
  const val = 0.7 + i * 0.05;
  return { value: parseFloat(val.toFixed(2)), label: `${val.toFixed(2)}x` };
});

/** BGM：优先本地 public/bgm/{id}.mp3，id 与文件名（不含 .mp3）一致 */
const BGM_TRACKS: { id: string; label: string; url: string }[] = [
  { id: 'none', label: '无音乐', url: '' },
  { id: 'mixkit-classical-vibes-4-684', label: '古典氛围·四', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-vibes-4-684.mp3' },
  { id: 'mixkit-classical-vibes-5-688', label: '古典氛围·五', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-vibes-5-688.mp3' },
  { id: 'mixkit-classical-vibes-2-682', label: '古典氛围·二', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-vibes-2-682.mp3' },
  { id: 'mixkit-upbeat-jazz-644', label: '轻快爵士', url: 'https://assets.mixkit.co/music/preview/mixkit-upbeat-jazz-644.mp3' },
  { id: 'mixkit-classical-7-714', label: '古典抒情', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-7-714.mp3' },
  { id: 'mixkit-classical-10-717', label: '古典钢琴叙事', url: 'https://assets.mixkit.co/music/preview/mixkit-classical-10-717.mp3' },
];

/** 优先同源 /api/proxy，不依赖第三方代理 */
function getProxyUrl(target: string): string {
  if (typeof window !== 'undefined' && window.location?.origin)
    return `${window.location.origin}/api/proxy?url=${encodeURIComponent(target)}`;
  const prefix = (import.meta as any).env?.VITE_CORS_PROXY || 'https://corsproxy.io/?';
  return prefix + encodeURIComponent(target);
}

/** 获取 BGM 候选 URL：仅本地 /bgm/{id}.mp3（远程已改为国内可访问源，见 README） */
const getBgmUrls = (track: { id: string; url: string }): string[] => {
  const urls: string[] = [];
  if (track.id !== 'none' && typeof window !== 'undefined') {
    urls.push(`${window.location.origin}/bgm/${track.id}.mp3`);
  }
  if (track.url) urls.push(track.url);
  return urls;
};

interface AnimationConfig {
  scaleStart: number;
  scaleEnd: number;
  panXStart: number;
  panXEnd: number;
  panYStart: number;
  panYEnd: number;
  /** 缩放/运镜的随机中心点，模拟摄像机焦点偏移 */
  originX: number;
  originY: number;
}

/** 带绝对时间（秒）的字幕，用于与音频严格对齐 */
interface TimedSubtitle {
  text: string;
  start: number;
  end: number;
}

const VideoMaker: React.FC<VideoMakerProps> = ({ images, originalText, aspectRatio, style }) => {
  const [status, setStatus] = useState<'idle' | 'generating_audio' | 'rendering' | 'finalizing' | 'done'>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMimeType, setVideoMimeType] = useState<string>('');
  const [progress, setProgress] = useState(0);
  
  const [selectedSpeaker, setSelectedSpeaker] = useState('zh_female_vv_uranus_bigtts'); // 默认 Vivi 2.0（女）
  const [selectedEmotion, setSelectedEmotion] = useState('authoritative'); // 默认 权威
  const [selectedSpeed, setSelectedSpeed] = useState(1.0);
  const [selectedMusic, setSelectedMusic] = useState('mixkit-classical-10-717'); // 默认 古典钢琴叙事
  const [bgmVolume, setBgmVolume] = useState(60); // 滑块 0–100，实际音量 = 滑块% × 40%（最大原音 40%），默认 60 即原音 24%

  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isVoicePreviewLoading, setIsVoicePreviewLoading] = useState(false);
  const [isMusicPreviewLoading, setIsMusicPreviewLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showResetToast = () => {
    if (status !== 'done') return;
    setToastMessage('请重置视频');
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2500);
  };
  const musicCache = useRef<Map<string, string>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const validImages = images.filter(img => img.imageUrl && !img.loading && !img.error);

  useEffect(() => {
    let suggestedMusic = 'none';
    const s = style.toLowerCase();
    if (s.includes('cyberpunk') || s.includes('3d') || s.includes('pixel') || s.includes('anime')) suggestedMusic = 'mixkit-upbeat-jazz-644';
    else if (s.includes('watercolor') || s.includes('minimalist') || s.includes('nature')) suggestedMusic = 'mixkit-classical-vibes-2-682';
    else if (s.includes('oil') || s.includes('photo')) suggestedMusic = 'mixkit-classical-vibes-4-684';
    else if (s.includes('chinese') || s.includes('ink')) suggestedMusic = 'mixkit-classical-10-717';
    else if (s.includes('modern')) suggestedMusic = 'mixkit-classical-vibes-5-688';
    else suggestedMusic = 'mixkit-classical-10-717';
    if (BGM_TRACKS.some(t => t.id === suggestedMusic)) setSelectedMusic(suggestedMusic);
    else setSelectedMusic(BGM_TRACKS[1]?.id ?? 'none');
  }, [style]);

  useEffect(() => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    }
  }, [selectedMusic]);

  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) audioPreviewRef.current.pause();
      musicCache.current.forEach(url => URL.revokeObjectURL(url));
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const toggleMusicPreview = async () => {
    if (selectedMusic === 'none') return;
    if (isMusicPreviewLoading) return;
    
    const track = BGM_TRACKS.find(t => t.id === selectedMusic);
    if (!track) return;

    if (!audioPreviewRef.current) {
      audioPreviewRef.current = new Audio();
      audioPreviewRef.current.onended = () => setIsPlayingPreview(false);
      audioPreviewRef.current.onerror = () => setIsPlayingPreview(false);
    }

    const audio = audioPreviewRef.current;

    if (isPlayingPreview) {
      audio.pause();
      setIsPlayingPreview(false);
    } else {
      let playUrl = musicCache.current.get(selectedMusic);

      if (!playUrl) {
        setIsMusicPreviewLoading(true);
        try {
          const localPath = `/bgm/${track.id}.mp3`;
          const tryLocal = (): Promise<string | null> =>
            new Promise((resolve) => {
              const a = new Audio();
              a.oncanplaythrough = () => resolve(localPath);
              a.onerror = () => resolve(null);
              a.src = localPath;
            });
          playUrl = await tryLocal();
          if (playUrl) {
            musicCache.current.set(selectedMusic, playUrl);
          }
          if (!playUrl && track.url) {
            const proxyUrl = getProxyUrl(track.url);
            const res = await fetch(proxyUrl);
            if (res.ok) {
              const blob = await res.blob();
              playUrl = URL.createObjectURL(blob);
              musicCache.current.set(selectedMusic, playUrl);
            }
          }
          if (!playUrl) throw new Error("BGM load failed");
        } catch (e) {
          console.error("BGM preview failed", e);
          alert(
            "背景音试听失败。\n\n请确认 public/bgm/ 下已有与选项同名的 MP3（如 mixkit-classical-10-717.mp3）。若仅用本地文件，无需联网。"
          );
          setIsMusicPreviewLoading(false);
          return;
        } finally {
          setIsMusicPreviewLoading(false);
        }
      }

      if (playUrl) {
        audio.src = playUrl;
        audio.play().then(() => setIsPlayingPreview(true)).catch(() => setIsPlayingPreview(false));
      }
    }
  };

  const handleVoicePreview = async () => {
    if (isVoicePreviewLoading) return;
    try {
        setIsVoicePreviewLoading(true);
        const options = selectedEmotion ? { emotion: selectedEmotion } : undefined;
        const buffer = await generateSpeech("This is a voice preview.", selectedSpeaker, options);
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const pcmDataInt16 = new Int16Array(buffer);
        const audioBuffer = ctx.createBuffer(1, pcmDataInt16.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < pcmDataInt16.length; i++) {
          channelData[i] = pcmDataInt16[i] / 32768.0;
        }
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
        setTimeout(() => setIsVoicePreviewLoading(false), audioBuffer.duration * 1000);
    } catch (e) {
        alert("Voice preview failed.");
        setIsVoicePreviewLoading(false);
    }
  };

  /** 支持中英文：有空格按词换行，无空格按字换行 */
  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    const hasSpaces = /\s/.test(text);
    if (hasSpaces) {
      const words = text.split(/\s+/);
      let line = '';
      const lines: string[] = [];
      for (let n = 0; n < words.length; n++) {
        const testLine = line ? line + ' ' + words[n] : words[n];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line) {
          lines.push(line);
          line = words[n];
        } else {
          line = testLine;
        }
      }
      if (line) lines.push(line);
      return lines;
    }
    // 中文/无空格：按字符累加直到超宽
    const lines: string[] = [];
    let line = '';
    for (const char of text) {
      const testLine = line + char;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const getCanvasDimensions = (ratio: string) => {
    switch (ratio) {
      case '16:9': return { width: 1920, height: 1080 };
      case '4:3': return { width: 1440, height: 1080 };
      case '3:4': return { width: 1080, height: 1440 };
      case '9:16': return { width: 1080, height: 1920 };
      case '1:1': default: return { width: 1024, height: 1024 };
    }
  };

  /** 绘制圆角矩形（兼容无 roundRect 的浏览器，如 Safari < 16） */
  const fillRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(x, y, w, h, r);
      ctx.fill();
      return;
    }
    const pi = Math.PI;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -pi / 2, 0);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0, pi / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, pi / 2, pi);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, pi, (pi * 3) / 2);
    ctx.closePath();
    ctx.fill();
  };

  const fetchAudioBuffer = async (ctx: AudioContext, urls: string[]): Promise<AudioBuffer | null> => {
    const tryOne = async (fetchUrl: string, useProxy: boolean): Promise<AudioBuffer | null> => {
      const urlToUse = useProxy && fetchUrl.startsWith('http') && !fetchUrl.startsWith(window.location.origin)
        ? getProxyUrl(fetchUrl)
        : fetchUrl;
      const res = await fetch(urlToUse, { mode: 'cors' });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) return null;
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    };
    for (const url of urls) {
      try {
        const isLocal = typeof window !== 'undefined' && url.startsWith(window.location.origin);
        let buf = await tryOne(url, !isLocal);
        if (buf) return buf;
        if (!isLocal) buf = await tryOne(url, false);
        if (buf) return buf;
      } catch (_) {}
    }
    console.warn("BGM load failed for all URLs");
    return null;
  };

  /** 每张图随机：推近/拉远 + 随机焦点偏移（运镜中心） */
  const generateAnimationConfig = (seed: number): AnimationConfig => {
    const zoomIn = seed % 2 === 0;
    const panDirectionX = (seed % 3) - 1;
    const panDirectionY = (seed % 2) * 2 - 1;
    const originX = 0.4 + (seed * 0.17) % 0.2;
    const originY = 0.4 + (seed * 0.13) % 0.2;
    return {
      scaleStart: zoomIn ? 1.0 : 1.15,
      scaleEnd: zoomIn ? 1.15 : 1.0,
      panXStart: originX - panDirectionX * 0.05,
      panXEnd: originX + panDirectionX * 0.05,
      panYStart: originY - panDirectionY * 0.05,
      panYEnd: originY + panDirectionY * 0.05,
      originX,
      originY,
    };
  };

  const handleCreateVideo = async () => {
    if (validImages.length === 0) return;
    
    if (isPlayingPreview && audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        setIsPlayingPreview(false);
    }

    setStatus('generating_audio');
    setVideoUrl(null);
    setVideoMimeType('');
    setProgress(0);

    let renderTimerId: ReturnType<typeof setTimeout> | undefined;
    let audioCtx: AudioContext | null = null;
    let mediaRecorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;

    try {
      // 分句：只按句号/问号/感叹号/换行分，一句话一段
      const getSentenceList = (text: string): string[] => {
        const raw = (text || ' ').trim();
        const sentenceRegex = /[^。！？.!?\n]+[。！？.!?\n]?|[^。！？.!?\n]+$/g;
        const segments = raw.match(sentenceRegex)?.map(s => s.trim()).filter(Boolean) || [];
        return segments.length > 0 ? segments : [raw];
      };
      const sentences = getSentenceList(originalText);
      const speechOptions = selectedEmotion ? { emotion: selectedEmotion } : undefined;
      const SAMPLE_RATE = 24000;
      const PAUSE_BETWEEN_SENTENCES = 0.35; // 句间静音 0.35 秒

      // 1. 按句合成音频，得到每句的 PCM 和实际时长
      const segmentBuffers: ArrayBuffer[] = [];
      const segmentDurations: number[] = [];
      for (let i = 0; i < sentences.length; i++) {
        const buf = await generateSpeech(sentences[i], selectedSpeaker, speechOptions);
        segmentBuffers.push(buf);
        const samples = buf.byteLength / 2;
        segmentDurations.push(samples / SAMPLE_RATE);
      }

      // 2. 拼接 PCM：句1 + 静音 + 句2 + 静音 + …（句间静音 0.35s）
      const silenceSamples = Math.round(PAUSE_BETWEEN_SENTENCES * SAMPLE_RATE);
      const totalSamples =
        segmentBuffers.reduce((sum, b) => sum + b.byteLength / 2, 0) +
        (sentences.length > 1 ? (sentences.length - 1) * silenceSamples : 0);
      const combined = new Int16Array(totalSamples);
      let offset = 0;
      for (let i = 0; i < segmentBuffers.length; i++) {
        const view = new Int16Array(segmentBuffers[i]);
        combined.set(view, offset);
        offset += view.length;
        if (i < segmentBuffers.length - 1) {
          offset += silenceSamples; // 静音已为 0，无需 fill
        }
      }
      const voiceBufferData = combined.buffer;

      setStatus('rendering');

      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioCtx.resume(); // CRITICAL: Ensure context is running

      // 3. Load Images：wsrv.nl 保证 CORS，decode 后再绘制避免切换卡死
      const loadedImages = await Promise.all(validImages.map(item => {
        return new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          let safeUrl = item.imageUrl || "";
          if (safeUrl && !safeUrl.includes("wsrv.nl")) {
            safeUrl = `https://wsrv.nl/?url=${encodeURIComponent(safeUrl)}&output=png`;
          }
          img.src = safeUrl;
          img.onload = () => {
            if (typeof img.decode === 'function') {
              img.decode().then(() => resolve(img)).catch(() => resolve(img));
            } else {
              resolve(img);
            }
          };
          img.onerror = () => {
            console.error("Failed to load image for video:", safeUrl);
            img.width = 0;
            resolve(img);
          };
        });
      }));

      // 过滤无效图，并排除会污染 canvas 的跨域图（避免第二、三张时 drawImage 抛错导致画面卡死）
      const canDrawImage = (img: HTMLImageElement): boolean => {
        if (!img.naturalWidth && !img.width) return false;
        try {
          const off = document.createElement('canvas');
          off.width = 1;
          off.height = 1;
          const offCtx = off.getContext('2d');
          if (!offCtx) return true;
          offCtx.drawImage(img, 0, 0, 1, 1);
          offCtx.getImageData(0, 0, 1, 1);
          return true;
        } catch {
          return false;
        }
      };
      const usefulImages = loadedImages.filter(canDrawImage);
      if (usefulImages.length === 0) {
        throw new Error("No valid images available. Canvas tainted or load failed.");
      }

      // 4. Prepare Voice Buffer（已按句拼接，含句间静音）
      const pcmDataInt16 = new Int16Array(voiceBufferData);
      const voiceAudioBuffer = audioCtx.createBuffer(1, pcmDataInt16.length, SAMPLE_RATE);
      const voiceChannelData = voiceAudioBuffer.getChannelData(0);
      for (let i = 0; i < pcmDataInt16.length; i++) {
        voiceChannelData[i] = pcmDataInt16[i] / 32768.0;
      }

      // 5. Load Background Music（先本地 /bgm/{id}.mp3，再远程）
      let musicAudioBuffer: AudioBuffer | null = null;
      if (selectedMusic !== 'none') {
        const track = BGM_TRACKS.find(t => t.id === selectedMusic);
        if (track) {
          const urls = getBgmUrls(track);
          if (urls.length) musicAudioBuffer = await fetchAudioBuffer(audioCtx, urls);
        }
        if (selectedMusic !== 'none' && !musicAudioBuffer) {
          console.warn("BGM 未加载，视频将仅含人声。请从 Pixabay 中文等下载 MP3 放入 public/bgm/。");
        }
      }

      // 6. 音频图谱：人声 + BGM 混音 -> dest（录制） + 静音 destination（保持时钟不卡顿）
      const dest = audioCtx.createMediaStreamDestination();
      const mixGain = audioCtx.createGain();
      mixGain.gain.value = 1.0;
      mixGain.connect(dest);

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      mixGain.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const speed = Math.max(0.7, Math.min(1.3, Number(selectedSpeed) || 1));
      const voiceSource = audioCtx.createBufferSource();
      voiceSource.buffer = voiceAudioBuffer;
      voiceSource.playbackRate.value = speed;
      const voiceGain = audioCtx.createGain();
      voiceGain.gain.value = 1.0;
      voiceSource.connect(voiceGain);
      voiceGain.connect(mixGain);

      let musicSource: AudioBufferSourceNode | null = null;
      if (musicAudioBuffer) {
        musicSource = audioCtx.createBufferSource();
        musicSource.buffer = musicAudioBuffer;
        musicSource.loop = true;
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = (bgmVolume / 100) * 0.4; // 滑块 0–100%，最大为原音 40%；60% 滑块 = 24% 原音
        musicSource.connect(musicGain);
        musicGain.connect(mixGain);
      }

      // 7. Timeline: 1.5s 纯音乐 -> 人声+音乐 -> 1.5s 纯音乐
      const INTRO_PADDING = 1.5;
      const OUTRO_PADDING = 1.5;
      const effectiveVoiceDuration = voiceAudioBuffer.duration / speed;
      const totalDuration = INTRO_PADDING + effectiveVoiceDuration + OUTRO_PADDING;
      const imageDisplayDuration = totalDuration / usefulImages.length;

      // 字幕：用每句实际合成时长 + 句间静音计算起止时间（与音频严格对齐）
      const voiceStart = INTRO_PADDING;
      const voiceEnd = INTRO_PADDING + effectiveVoiceDuration;
      let segStartAudio = 0;
      const timedSubtitles: TimedSubtitle[] = sentences.map((text, i) => {
        const dur = segmentDurations[i];
        const startWall = voiceStart + segStartAudio / speed;
        const endWall = voiceStart + (segStartAudio + dur) / speed;
        segStartAudio += dur + (i < sentences.length - 1 ? PAUSE_BETWEEN_SENTENCES : 0);
        return { text, start: startWall, end: endWall };
      });
      const SUBTITLE_LEAD = 0.12;

      // 8. Setup Canvas & Recorder（2D 不读像素时 willReadFrequently: false 可减轻卡顿）
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;
      const dims = getCanvasDimensions(aspectRatio);
      canvas.width = dims.width;
      canvas.height = dims.height;

      const animConfigs = usefulImages.map((_, i) => generateAnimationConfig(i));
      // 先压缩：原图可能很大（如 1536/2048），统一缩到长边不超过此值再参与预渲染，减轻卡顿
      const MAX_SOURCE_SIZE = usefulImages.length >= 8 ? 960 : 1280;
      const MAX_SCALE = 1.15;
      const MAX_PRE_SIZE = usefulImages.length >= 8 ? 1920 : 2560;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = MAX_SOURCE_SIZE;
      tempCanvas.height = MAX_SOURCE_SIZE;
      const tempCtx = tempCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
      const preRendered: { canvas: HTMLCanvasElement; w: number; h: number }[] = [];
      for (let i = 0; i < usefulImages.length; i++) {
        const img = usefulImages[i];
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        const imgRatio = w / h;
        const canvasRatio = dims.width / dims.height;
        let drawW: number, drawH: number;
        if (imgRatio > canvasRatio) {
          drawH = dims.height;
          drawW = drawH * imgRatio;
        } else {
          drawW = dims.width;
          drawH = drawW / imgRatio;
        }
        let preW = Math.ceil(drawW * MAX_SCALE);
        let preH = Math.ceil(drawH * MAX_SCALE);
        if (preW > MAX_PRE_SIZE || preH > MAX_PRE_SIZE) {
          const r = Math.min(MAX_PRE_SIZE / preW, MAX_PRE_SIZE / preH);
          preW = Math.ceil(preW * r);
          preH = Math.ceil(preH * r);
        }
        const off = document.createElement('canvas');
        off.width = preW;
        off.height = preH;
        const offCtx = off.getContext('2d', { alpha: false, willReadFrequently: false });
        if (offCtx && tempCtx) {
          const long = Math.max(w, h);
          const smallW = long <= MAX_SOURCE_SIZE ? w : (w >= h ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * w) / h));
          const smallH = long <= MAX_SOURCE_SIZE ? h : (h >= w ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * h) / w));
          tempCanvas.width = smallW;
          tempCanvas.height = smallH;
          tempCtx.drawImage(img, 0, 0, w, h, 0, 0, smallW, smallH);
          offCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, preW, preH);
          preRendered.push({ canvas: off, w: preW, h: preH });
        } else {
          preRendered.push({ canvas: off, w: preW, h: preH });
        }
      }

      // 预计算字幕换行，避免每帧 measureText 造成越往后越卡
      const subtitleFontSize = Math.floor(dims.height * 0.042);
      const subtitleMaxWidth = dims.width * 0.88;
      ctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const precomputedSubtitleLines: string[][] = timedSubtitles.map(s => wrapText(ctx, s.text.trim(), subtitleMaxWidth));

      const canvasStream = canvas.captureStream(30);
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const mimeType = 'video/webm; codecs=vp9,opus'; // Prefer WebM for browser recording stability
      
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
        videoBitsPerSecond: 4000000 // 4Mbps 减轻编码压力，减少掉帧
      });
      
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      const bgmRequestedButFailed = selectedMusic !== 'none' && !musicAudioBuffer;
      let lastProgressUpdate = 0;
      mediaRecorder.onstop = () => {
        if (voiceSource) { try { voiceSource.stop(); voiceSource.disconnect(); } catch(e){} }
        if (musicSource) { try { musicSource.stop(); musicSource.disconnect(); } catch(e){} }
        try { silentGain.disconnect(); } catch (_) {}
        audioCtx?.close();

        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setVideoMimeType(mimeType);
        setStatus('done');
        if (bgmRequestedButFailed) {
          setToastMessage('背景音未加载，视频仅含人声。请从 Pixabay 中文等下载 MP3 放入 public/bgm/。');
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => {
            setToastMessage(null);
            toastTimerRef.current = null;
          }, 4000);
        }
      };

      // 9. START RECORDING & PLAYBACK
      mediaRecorder.start();
      
      const startTime = audioCtx.currentTime + 0.1; // Add small buffer
      voiceSource.start(startTime + INTRO_PADDING);
      if (musicSource) musicSource.start(startTime);

      const RENDER_FPS = usefulImages.length >= 8 ? 24 : 30; // 图多时降帧减轻越往后越卡
      const renderLoop = () => {
        const currentTime = audioCtx!.currentTime;
        const elapsed = currentTime - startTime;

        if (elapsed >= totalDuration) {
          const lastIdx = usefulImages.length - 1;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const pre = preRendered[lastIdx];
          const config = animConfigs[lastIdx];
          if (pre && config) {
            const drawW = pre.w / MAX_SCALE;
            const drawH = pre.h / MAX_SCALE;
            const scaledW = drawW * config.scaleEnd;
            const scaledH = drawH * config.scaleEnd;
            const x = (canvas.width * config.panXEnd) - (scaledW / 2);
            const y = (canvas.height * config.panYEnd) - (scaledH / 2);
            try {
              ctx.drawImage(pre.canvas, 0, 0, pre.w, pre.h, x, y, scaledW, scaledH);
            } catch (_) {}
          }
          setStatus('finalizing');
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
          if (typeof renderTimerId !== 'undefined') clearTimeout(renderTimerId);
          return;
        }

        try {
          const rawSlideIndex = elapsed / imageDisplayDuration;
          const slideIndex = Math.min(usefulImages.length - 1, Math.max(0, Math.floor(rawSlideIndex)));
          const slideStartTime = slideIndex * imageDisplayDuration;
          const slideLocalTime = elapsed - slideStartTime;
          const p = Math.max(0, Math.min(1, slideLocalTime / imageDisplayDuration));

          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const pre = preRendered[slideIndex];
          const config = animConfigs[slideIndex];
          if (pre && config) {
            const drawW = pre.w / MAX_SCALE;
            const drawH = pre.h / MAX_SCALE;
            const scale = config.scaleStart + (config.scaleEnd - config.scaleStart) * p;
            const scaledW = drawW * scale;
            const scaledH = drawH * scale;
            const panX = config.panXStart + (config.panXEnd - config.panXStart) * p;
            const panY = config.panYStart + (config.panYEnd - config.panYStart) * p;
            const x = (canvas.width * panX) - (scaledW / 2);
            const y = (canvas.height * panY) - (scaledH / 2);
            try {
              ctx.drawImage(pre.canvas, 0, 0, pre.w, pre.h, x, y, scaledW, scaledH);
            } catch {
              ctx.fillStyle = '#1a1a1a';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
          }

          const inVoiceWindow = elapsed >= voiceStart && elapsed < voiceEnd;
          const activeSubtitles = inVoiceWindow
            ? timedSubtitles.filter(s => {
                if (!s.text.trim()) return false;
                const showFrom = Math.max(voiceStart, s.start - SUBTITLE_LEAD);
                return elapsed >= showFrom && elapsed < s.end;
              })
            : [];
          if (activeSubtitles.length > 0) {
            const lineHeight = subtitleFontSize * 1.35;
            const boxPadding = subtitleFontSize * 0.7;
            const allLines = activeSubtitles.flatMap(sub => {
              const i = timedSubtitles.indexOf(sub);
              return (i >= 0 && precomputedSubtitleLines[i]?.length) ? precomputedSubtitleLines[i] : [];
            });
            if (allLines.length > 0) {
              const totalTextHeight = allLines.length * lineHeight;
              const boxHeight = totalTextHeight + boxPadding * 2;
              const boxCenterY = canvas.height - canvas.height * 0.11;
              const by = boxCenterY - boxHeight / 2;
              const boxWidth = subtitleMaxWidth + boxPadding * 2;
              const bx = (canvas.width - boxWidth) / 2;
              const r = 12;
              const textBlockTop = by + boxPadding;

              ctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
              fillRoundRect(ctx, bx, by, boxWidth, boxHeight, r);

              const textOffsets: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1]];
              ctx.fillStyle = 'rgba(0,0,0,0.85)';
              allLines.forEach((line, i) => {
                const lineCenterY = textBlockTop + (i + 0.5) * lineHeight;
                textOffsets.forEach(([dx, dy]) => ctx.fillText(line, canvas.width / 2 + dx, lineCenterY + dy));
              });
              ctx.fillStyle = '#ffffff';
              allLines.forEach((line, i) => {
                const lineCenterY = textBlockTop + (i + 0.5) * lineHeight;
                ctx.fillText(line, canvas.width / 2, lineCenterY);
              });
            }
          }
        } catch (_) {}

        const totalProgress = Math.min(100, (elapsed / totalDuration) * 100);
        if (totalProgress - lastProgressUpdate >= 1 || totalProgress >= 100) {
          lastProgressUpdate = totalProgress;
          setProgress(totalProgress);
        }
        // 串行驱动下一帧，避免 setInterval 堆积导致多图时卡顿
        renderTimerId = setTimeout(renderLoop, 1000 / RENDER_FPS);
      };

      renderLoop(); // 立即画一帧

    } catch (error) {
      console.error("Video creation failed", error);
      setStatus('idle');
      const msg = error instanceof Error ? error.message : String(error);
      const isFailedFetch = /failed to fetch|network error|load failed/i.test(msg) || msg === "Failed to fetch";
      const hint = isFailedFetch
        ? "原因: " + msg + "\n\n建议：1) 确认本页与开发服务同一端口（如均为 localhost:3000）；2) 检查网络与防火墙；3) 若使用代理，请确认 /api/proxy 可用。"
        : "原因: " + msg;
      alert("视频合成遇到问题，请重试。\n\n" + hint);
      if (audioCtx) audioCtx.close();
      if (typeof renderTimerId !== 'undefined') clearTimeout(renderTimerId);
    }
  };

  if (validImages.length < 2) return null;

  return (
    <div className="mt-24 bg-[#0a0a0a] border border-[#222] rounded-sm p-8 text-white shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/5 rounded-full blur-3xl -z-0 pointer-events-none"></div>

      <div className="flex flex-col gap-8 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 border-b border-[#222] pb-6">
          <div>
            <h3 className="text-2xl font-serif italic text-white flex items-center gap-3">
               <span className="text-[#d4af37]">/</span> Video Production
            </h3>
            <p className="text-slate-500 text-xs mt-2 uppercase tracking-widest">
              Synthesize Gallery into Motion
            </p>
          </div>

          <div className="flex flex-col gap-4 items-end w-full md:w-auto">
            <div className="flex flex-wrap items-center gap-3 justify-end w-full relative">
                {status === 'done' && (
                  <div
                    className="absolute inset-0 z-10 cursor-pointer"
                    onClick={showResetToast}
                    title="点击提示"
                    aria-hidden
                  />
                )}
                {/* 语音 */}
                <div className="flex items-center gap-2 bg-[#151515] p-1 rounded-sm border border-[#222]">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest px-2">语音</span>
                    <select
                        value={selectedSpeaker}
                        onChange={(e) => setSelectedSpeaker(e.target.value)}
                        disabled={status !== 'idle'}
                        className="bg-[#111] text-slate-300 text-xs uppercase tracking-wider px-2 py-1.5 border-0 focus:outline-none min-w-[140px]"
                    >
                        {DOUBAO_SPEAKERS.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                    </select>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest px-1">情感</span>
                    <select
                        value={selectedEmotion}
                        onChange={(e) => setSelectedEmotion(e.target.value)}
                        disabled={status !== 'idle'}
                        className="bg-[#111] text-slate-300 text-xs uppercase tracking-wider px-2 py-1.5 border-0 focus:outline-none min-w-[90px]"
                    >
                        {DOUBAO_EMOTIONS.map((e) => (
                            <option key={e.id || 'default'} value={e.id}>{e.label}</option>
                        ))}
                    </select>
                    <button
                        onClick={handleVoicePreview}
                        disabled={isVoicePreviewLoading}
                        className="px-2 py-1 text-[#d4af37] hover:text-white disabled:opacity-50"
                        title="试听"
                    >
                        {isVoicePreviewLoading ? (
                            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 2.485.586 4.815 1.632 6.845.334 1.148 1.442 1.748 2.66 1.748h.092l4.5 4.5c.944.945 2.56.276 2.56-1.06V4.06z" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* 倍速：0.7x ~ 1.3x */}
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">倍速</span>
                    <select
                        value={String(selectedSpeed)}
                        onChange={(e) => setSelectedSpeed(parseFloat(e.target.value))}
                        disabled={status !== 'idle'}
                        className="bg-[#151515] text-slate-300 text-xs uppercase tracking-wider rounded-sm px-3 py-2 border border-[#333] focus:outline-none focus:border-[#d4af37]"
                    >
                        {SPEEDS.map((s) => (
                            <option key={s.value} value={String(s.value)}>{s.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-end w-full relative">
                {status === 'done' && (
                  <div
                    className="absolute inset-0 z-10 cursor-pointer"
                    onClick={showResetToast}
                    title="点击提示"
                    aria-hidden
                  />
                )}
                 {/* Music Selector with Preview */}
                 <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">BGM:</span>
                    <div className="flex items-center gap-1 bg-[#151515] rounded-sm border border-[#333] p-0.5">
                        <select
                            value={selectedMusic}
                            onChange={(e) => setSelectedMusic(e.target.value)}
                            disabled={status !== 'idle' || isMusicPreviewLoading}
                            className="bg-transparent text-slate-300 text-xs uppercase tracking-wider px-2 py-1.5 focus:outline-none min-w-[140px] max-w-[180px]"
                        >
                            {BGM_TRACKS.map((m) => (
                                <option key={m.id} value={m.id} className="bg-[#111]">{m.label}</option>
                            ))}
                        </select>
                        
                        {selectedMusic !== 'none' && (
                            <button
                                onClick={toggleMusicPreview}
                                disabled={status !== 'idle' || isMusicPreviewLoading}
                                className={`p-1.5 transition-all ${
                                    isPlayingPreview 
                                        ? 'text-red-400 hover:bg-[#222]' 
                                        : 'text-[#d4af37] hover:bg-[#222]'
                                }`}
                                title={isPlayingPreview ? "Stop Preview" : "Play Preview"}
                            >
                                {isMusicPreviewLoading ? (
                                    <span className="w-4 h-4 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin block"></span>
                                ) : isPlayingPreview ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                        <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                    {selectedMusic !== 'none' && (
                      <div className="flex items-center gap-2 min-w-[140px]">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest whitespace-nowrap">BGM 音量</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={bgmVolume}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                          disabled={status !== 'idle'}
                          className="w-24 h-1.5 bg-[#222] rounded-full appearance-none cursor-pointer accent-[#d4af37] disabled:opacity-50"
                        />
                        <span className="text-[10px] text-slate-400 tabular-nums w-10" title="滑块 100% = 原音 40%">{bgmVolume}%</span>
                      </div>
                    )}
                 </div>

                {status === 'idle' && (
                <button
                    onClick={handleCreateVideo}
                    className="bg-white hover:bg-[#d4af37] text-black hover:text-white px-6 py-2 rounded-sm font-serif italic text-lg transition-all shadow-[0_4px_14px_0_rgba(0,0,0,0.39)] flex items-center gap-2"
                >
                    Generate Video
                </button>
                )}
            </div>
          </div>
        </div>

        {/* Progress or Actions */}
        <div className="flex justify-center mt-4">
            {(status === 'generating_audio' || status === 'rendering' || status === 'finalizing') && (
              <div className="flex flex-col items-center w-full max-w-md">
                <div className="w-full bg-[#222] rounded-full h-1 mb-3 overflow-hidden">
                  <div 
                    className="bg-[#d4af37] h-full transition-all duration-100 ease-linear shadow-[0_0_10px_#d4af37]" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <span className="text-xs text-[#d4af37] animate-pulse font-mono tracking-widest uppercase">
                  {status === 'generating_audio' && 'Synthesizing Voice...'}
                  {status === 'rendering' && `Rendering Frames: ${Math.round(progress)}%`}
                  {status === 'finalizing' && 'Finalizing Output...'}
                </span>
              </div>
            )}

            {status === 'done' && videoUrl && (
              <div className="flex gap-4">
                <a
                  href={videoUrl}
                  download={`gemini_gallery_${aspectRatio.replace(':','-')}${videoMimeType.includes('mp4') ? '.mp4' : '.webm'}`}
                  className="bg-[#d4af37] hover:bg-[#c4a030] text-black px-8 py-3 rounded-sm font-serif italic text-lg transition-all flex items-center gap-2 shadow-lg"
                >
                  Download Film
                </a>
                <button 
                  onClick={() => setStatus('idle')}
                  className="text-slate-500 hover:text-white px-4 py-2 text-xs uppercase tracking-widest border border-transparent hover:border-white/20"
                >
                  Reset
                </button>
              </div>
            )}
        </div>
      </div>
      
      {/* Hidden Canvas for Rendering */}
      <div className="hidden">
        <canvas ref={canvasRef} />
      </div>
      
      {/* Preview Player */}
      {status === 'done' && videoUrl && (
        <div className="mt-8 space-y-2">
          <div className="overflow-hidden border border-[#333] bg-black w-full max-w-2xl mx-auto shadow-2xl">
            <video controls src={videoUrl} className="w-full h-auto block" />
          </div>
          <p className="text-slate-500 text-xs max-w-2xl mx-auto text-center">
            Chrome / Edge 仅支持导出 WebM。如需 MP4：用 Safari 可尝试直接录制，或下载 WebM 后用 ffmpeg 转换：<code className="bg-[#222] px-1 rounded">ffmpeg -i 文件.webm -c copy 文件.mp4</code>
          </p>
        </div>
      )}

      {/* Toast：生成后点击语音/倍速/BGM 时提示 */}
      {toastMessage && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg bg-[#222] border border-[#d4af37] text-[#d4af37] text-sm font-medium shadow-lg"
          role="alert"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default VideoMaker;