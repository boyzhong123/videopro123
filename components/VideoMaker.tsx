import React, { useState, useRef, useEffect } from 'react';
import { generateSpeech, generateSpeechBatch } from '../services/geminiService';
import { DOUBAO_SPEAKERS, DOUBAO_EMOTIONS, getLastTtsDebugInfo } from '../services/doubaoTtsService';
import { GeneratedItem } from '../types';

interface VideoMakerProps {
  images: GeneratedItem[];
  originalText: string;
  aspectRatio: string;
  style: string;
  videoTitle?: string;
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

const USE_CORS_PROXY =
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_USE_CORS_PROXY === 'true';
const CORS_PROXY_PREFIX =
  (import.meta as any).env?.VITE_CORS_PROXY || 'https://corsproxy.io/?';

// CRITICAL FIX: Explicitly check for string "null" which causes "nullhttps://..."
function getFallbackCorsProxy(): string | null {
  const proxy = USE_CORS_PROXY ? CORS_PROXY_PREFIX : null;
  if (!proxy || proxy === "null" || proxy === "undefined" || proxy === "false") {
    return null;
  }
  return proxy;
}

/** 优先同源 /api/proxy；origin 为 null/"null" 时用相对路径，避免拼出 nullhttps://... */
function getProxyUrl(target: string): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin : '';
  const base = origin && origin !== 'null' ? origin : '';
  if (base) return `${base}/api/proxy?url=${encodeURIComponent(target)}`;
  return `/api/proxy?url=${encodeURIComponent(target)}`;
}

/** 获取 BGM 候选 URL：仅本地 /bgm/{id}.mp3（远程已改为国内可访问源，见 README） */
const getBgmUrls = (track: { id: string; url: string }): string[] => {
  const urls: string[] = [];
  if (track.id !== 'none' && typeof window !== 'undefined') {
    const o = window.location?.origin;
    const base = o && o !== 'null' ? o : '';
    urls.push(base ? `${base}/bgm/${track.id}.mp3` : `/bgm/${track.id}.mp3`);
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

const VideoMaker: React.FC<VideoMakerProps> = ({ images, originalText, aspectRatio, style, videoTitle }) => {
  const [status, setStatus] = useState<'idle' | 'generating_audio' | 'rendering' | 'finalizing' | 'done'>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMimeType, setVideoMimeType] = useState<string>('');
  const [progress, setProgress] = useState(0);

  const [selectedSpeaker, setSelectedSpeaker] = useState(DOUBAO_SPEAKERS[0].id); // 默认取列表第一项，与 doubaoTtsService 同步，避免硬编码旧 id 导致 403
  const [selectedEmotion, setSelectedEmotion] = useState('authoritative'); // 默认 权威
  const [selectedSpeed, setSelectedSpeed] = useState(0.85);
  const [selectedMusic, setSelectedMusic] = useState('mixkit-classical-10-717'); // 默认 古典钢琴叙事
  const [bgmVolume, setBgmVolume] = useState(60); // 滑块 0–100，实际音量 = 滑块% × 40%（最大原音 40%），默认 60%
  const [lowSpecMode, setLowSpecMode] = useState(false); // 流畅模式：降低预渲染与码率减轻卡顿
  const [fastAudioMode, setFastAudioMode] = useState(true); // 极速模式：音频并行合成加速

  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isVoicePreviewLoading, setIsVoicePreviewLoading] = useState(false);
  const [isMusicPreviewLoading, setIsMusicPreviewLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastErrorDetail, setLastErrorDetail] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

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
  /** 桌面端导出 MP4 时使用：保存最后一次生成的 WebM Blob */
  const lastVideoBlobRef = useRef<Blob | null>(null);
  /** 视频生成时已知的总时长（秒），WebM blob 的 video.duration 常为 Infinity，需要这个作后备 */
  const knownDurationRef = useRef<number>(0);
  const [exportMp4Loading, setExportMp4Loading] = useState(false);
  const [exportMp4Progress, setExportMp4Progress] = useState<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewProgress, setPreviewProgress] = useState({ current: 0, duration: 0 });
  /** 缓存上一次的播放进度，避免下载/导出等重渲染后进度条显示为 0 或消失 */
  const lastPreviewProgressRef = useRef({ current: 0, duration: 0 });
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [downloadWebmProgress, setDownloadWebmProgress] = useState<number | null>(null);

  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop;

  const validImages = images.filter(img => img.imageUrl && !img.loading && !img.error);

  // 预览视频进度条与播放状态
  useEffect(() => {
    if (!videoUrl) return;
    const known = knownDurationRef.current;
    const reset = { current: 0, duration: known > 0 ? known : 0 };
    setPreviewProgress(reset);
    lastPreviewProgressRef.current = reset;
    setIsPreviewPlaying(false);
    const video = previewVideoRef.current;
    if (!video) return;

    // Chromium WebM blob duration fix：seek 到极大值强制浏览器计算真实 duration
    let fixingDuration = false;
    const fixDuration = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        fixingDuration = true;
        video.currentTime = 1e10;
      }
    };
    const onSeeked = () => {
      if (fixingDuration && video.currentTime > 1e9) {
        video.currentTime = 0;
      } else if (fixingDuration && video.currentTime <= 1) {
        fixingDuration = false;
        update();
      } else if (!fixingDuration) {
        // 用户手动 seek 后立即刷新进度条
        update();
      }
    };
    video.addEventListener('loadedmetadata', fixDuration);
    video.addEventListener('seeked', onSeeked);
    const update = () => {
      if (fixingDuration) return; // 正在修 duration，跳过更新防止进度条跑满
      const rawD = video.duration;
      const c = video.currentTime;
      // 优先使用生成时精确计算的时长（WebM blob 的 video.duration 在 Chromium 中不可靠）
      const knownD = knownDurationRef.current;
      const d = knownD > 0 ? knownD : ((Number.isFinite(rawD) && rawD > 0) ? rawD : 0);
      const next = { current: Number.isFinite(c) ? c : 0, duration: d };
      lastPreviewProgressRef.current = next;
      setPreviewProgress(next);
    };
    const onPlay = () => setIsPreviewPlaying(true);
    const onPause = () => setIsPreviewPlaying(false);
    const onEnded = () => setIsPreviewPlaying(false);
    video.addEventListener('timeupdate', update);
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('durationchange', update);
    video.addEventListener('loadeddata', update);
    video.addEventListener('canplay', update);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    update();
    return () => {
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('loadedmetadata', fixDuration);
      video.removeEventListener('durationchange', update);
      video.removeEventListener('loadeddata', update);
      video.removeEventListener('canplay', update);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoUrl]);

  // 不再根据 style 自动覆盖 BGM，保持默认「古典钢琴叙事」生效

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
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Voice preview error:", e);
      alert("语音试听失败:\n" + msg);
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
      } catch (_) { }
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
    lastVideoBlobRef.current = null;
    setVideoMimeType('');
    setProgress(0);
    setLastErrorDetail(null);

    let renderTimerId: number | undefined; // requestAnimationFrame id，用于 cancelAnimationFrame
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
      let segmentBuffers: ArrayBuffer[];
      if (fastAudioMode) {
        // 极速模式：HTTP 请求并发 + 共享 AudioContext 顺序解码，比 Promise.all(generateSpeech) 快得多
        segmentBuffers = await generateSpeechBatch(sentences, selectedSpeaker, speechOptions);
      } else {
        // 顺序模式：逐句合成
        segmentBuffers = [];
        for (let i = 0; i < sentences.length; i++) {
          const buf = await generateSpeech(sentences[i], selectedSpeaker, speechOptions);
          segmentBuffers.push(buf);
        }
      }
      const segmentDurations: number[] = segmentBuffers.map((buf) => (buf.byteLength / 2) / SAMPLE_RATE);

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
        if (i < segmentBuffers.length - 1) offset += silenceSamples;
      }
      const voiceBufferData = combined.buffer;

      setStatus('rendering');

      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioCtx.resume(); // CRITICAL: Ensure context is running

      // 3. Load Images：并行 fetch 所有图片的 blob
      const fetchImageBlob = async (url: string): Promise<Blob | null> => {
        try {
          // 1) 优先直连
          const direct = await fetch(url, { mode: 'cors' });
          if (direct.ok) {
            const blob = await direct.blob();
            if (blob.type.startsWith('image/')) return blob;
          }
        } catch (_) {}
        try {
          // 2) 直连失败走代理
          const proxyUrl = getProxyUrl(url);
          const res = await fetch(proxyUrl);
          if (res.ok) return await res.blob();
        } catch (_) {}
        return null;
      };

      // 并行 fetch 所有图片
      const blobResults = await Promise.all(
        validImages.map(async (item, idx) => {
          const blob = item.imageUrl ? await fetchImageBlob(item.imageUrl) : null;
          return { blob, index: idx };
        })
      );
      const validBlobs = blobResults.filter((r): r is { blob: Blob; index: number } => r.blob !== null);
      if (validBlobs.length === 0) {
        throw new Error("No valid images available. All image loads failed.");
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

      // 流畅优先（低配勾选/多图自动降级）：桌面版资源更宽裕，放宽阈值
      const imgCount = validBlobs.length;
      const lowSpecThreshold = isDesktop ? 8 : 6;
      const autoLowSpec = lowSpecMode || imgCount >= lowSpecThreshold;
      const MAX_SOURCE_SIZE = autoLowSpec ? 800 : 1280;
      const MAX_SCALE = 1.15;
      const MAX_PRE_SIZE = autoLowSpec ? 1600 : 2560;

      // 使用 createImageBitmap 进行图片解码和预渲染（比 Image 对象更快）
      const preRendered: { bitmap: ImageBitmap; w: number; h: number }[] = [];

      for (const { blob, index } of validBlobs) {
        try {
          // createImageBitmap 比 new Image() 更快，异步解码不阻塞
          const bitmap = await createImageBitmap(blob);
          const w = bitmap.width;
          const h = bitmap.height;
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

          // 用 OffscreenCanvas 进行两步缩放预渲染
          if (typeof OffscreenCanvas !== 'undefined') {
            const long = Math.max(w, h);
            const smallW = long <= MAX_SOURCE_SIZE ? w : (w >= h ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * w) / h));
            const smallH = long <= MAX_SOURCE_SIZE ? h : (h >= w ? MAX_SOURCE_SIZE : Math.round((MAX_SOURCE_SIZE * h) / w));
            const tempCanvas = new OffscreenCanvas(smallW, smallH);
            const tempCtx = tempCanvas.getContext('2d', { alpha: false });
            if (tempCtx) {
              tempCtx.drawImage(bitmap, 0, 0, w, h, 0, 0, smallW, smallH);
              const offCanvas = new OffscreenCanvas(preW, preH);
              const offCtx = offCanvas.getContext('2d', { alpha: false });
              if (offCtx) {
                offCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, preW, preH);
                const resultBitmap = await createImageBitmap(offCanvas);
                preRendered.push({ bitmap: resultBitmap, w: preW, h: preH });
                bitmap.close?.();
              } else {
                // OffscreenCanvas context 失败，直接用原始 bitmap
                preRendered.push({ bitmap, w, h });
              }
            } else {
              preRendered.push({ bitmap, w, h });
            }
          } else {
            // 不支持 OffscreenCanvas，直接用原始 bitmap
            preRendered.push({ bitmap, w, h });
          }
          // 让出主线程，避免长时间阻塞
          await new Promise<void>(r => requestAnimationFrame(() => r()));
        } catch (e) {
          console.warn('Image prerender failed for index', index, e);
        }
      }

      if (preRendered.length === 0) {
        throw new Error("No valid images available after preprocessing.");
      }

      // 动画配置：基于预渲染成功的图片数量
      const animConfigs = preRendered.map((_, i) => generateAnimationConfig(i));

      // 每张图片的显示时长（基于预渲染成功的图片数量）
      const imageDisplayDuration = totalDuration / preRendered.length;

      // 预计算字幕换行，避免每帧 measureText 造成越往后越卡
      const subtitleFontSize = Math.floor(dims.height * 0.042);
      const subtitleMaxWidth = dims.width * 0.88;
      ctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const precomputedSubtitleLines: string[][] = timedSubtitles.map(s => wrapText(ctx, s.text.trim(), subtitleMaxWidth));

      // 预热字幕缓存：在渲染循环前就创建好 Canvas 并绘制第一帧字幕，避免字幕首次出现时掉帧
      const lineHeight = subtitleFontSize * 1.35;
      const boxPadding = subtitleFontSize * 0.7;
      const firstLines = precomputedSubtitleLines.find(l => l.length > 0);
      let subtitleCache: HTMLCanvasElement | null = null;
      let lastSubtitleKey = '';
      let lastSubtitleBox = { bx: 0, by: 0, boxWidth: 0, boxHeight: 0 };
      if (firstLines && firstLines.length > 0) {
        const warmTotalH = firstLines.length * lineHeight;
        const warmBoxH = warmTotalH + boxPadding * 2;
        const warmBoxW = subtitleMaxWidth + boxPadding * 2;
        subtitleCache = document.createElement('canvas');
        subtitleCache.width = warmBoxW;
        subtitleCache.height = warmBoxH;
        const sctx = subtitleCache.getContext('2d', { alpha: true, willReadFrequently: false })!;
        sctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
        sctx.textAlign = 'center';
        sctx.textBaseline = 'middle';
        sctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        fillRoundRect(sctx, 0, 0, warmBoxW, warmBoxH, 12);
        const textOffsets: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        sctx.fillStyle = 'rgba(0,0,0,0.85)';
        firstLines.forEach((line, i) => {
          const cy = boxPadding + (i + 0.5) * lineHeight;
          textOffsets.forEach(([dx, dy]) => sctx.fillText(line, warmBoxW / 2 + dx, cy + dy));
        });
        sctx.fillStyle = '#ffffff';
        firstLines.forEach((line, i) => {
          const cy = boxPadding + (i + 0.5) * lineHeight;
          sctx.fillText(line, warmBoxW / 2, cy);
        });
        lastSubtitleKey = '0'; // 标记第一帧已渲染
        lastSubtitleBox = {
          bx: (canvas.width - warmBoxW) / 2,
          by: (canvas.height - canvas.height * 0.11) - warmBoxH / 2,
          boxWidth: warmBoxW,
          boxHeight: warmBoxH,
        };
      }

      const captureFps = autoLowSpec && !isDesktop ? 24 : 30;
      const canvasStream = canvas.captureStream(captureFps);
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      // VP8 比 VP9 编码轻量得多，实时录制不易掉帧；桌面端码率适当提高补偿画质
      const preferVp8 = 'video/webm; codecs=vp8,opus';
      const preferVp9 = 'video/webm; codecs=vp9,opus';
      const mimeType = MediaRecorder.isTypeSupported(preferVp8) ? preferVp8 : preferVp9;

      const bitsPerSecond = autoLowSpec ? (isDesktop ? 4000000 : 2500000) : (isDesktop ? 6000000 : 4000000);
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
        videoBitsPerSecond: bitsPerSecond
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const bgmRequestedButFailed = selectedMusic !== 'none' && !musicAudioBuffer;
      let lastProgressUpdate = 0;
      mediaRecorder.onstop = () => {
        if (voiceSource) { try { voiceSource.stop(); voiceSource.disconnect(); } catch (e) { } }
        if (musicSource) { try { musicSource.stop(); musicSource.disconnect(); } catch (e) { } }
        try { silentGain.disconnect(); } catch (_) { }
        audioCtx?.close();

        const blob = new Blob(chunks, { type: mimeType });
        lastVideoBlobRef.current = blob;
        knownDurationRef.current = totalDuration;
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setVideoMimeType(mimeType);
        setStatus('done');
        if (typeof window !== 'undefined' && (window as any).electronAPI?.showNotification) {
          (window as any).electronAPI.showNotification('灵感画廊', '视频已生成完成');
        }
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

      // 帧率限制：只按 captureStream 的帧率渲染，避免 60fps 屏幕上做 30 帧无用 canvas 重绘
      const RENDER_INTERVAL = 1000 / captureFps;
      let lastFrameTime = 0;
      const textOffsets: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // 预创建，避免每帧分配
      const renderLoop = (timestamp?: number) => {
        // 帧率限流：距上一帧不足 RENDER_INTERVAL 就跳过
        if (timestamp && lastFrameTime && (timestamp - lastFrameTime) < RENDER_INTERVAL * 0.9) {
          renderTimerId = requestAnimationFrame(renderLoop);
          return;
        }
        lastFrameTime = timestamp || performance.now();

        const currentTime = audioCtx!.currentTime;
        const elapsed = currentTime - startTime;

        if (elapsed >= totalDuration) {
          const lastIdx = preRendered.length - 1;
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
              ctx.drawImage(pre.bitmap, 0, 0, pre.w, pre.h, x, y, scaledW, scaledH);
            } catch (_) { }
          }
          // 释放 ImageBitmap 资源
          preRendered.forEach(p => p.bitmap.close?.());
          setStatus('finalizing');
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
          if (typeof renderTimerId !== 'undefined') cancelAnimationFrame(renderTimerId);
          return;
        }

        try {
          const rawSlideIndex = elapsed / imageDisplayDuration;
          const slideIndex = Math.min(preRendered.length - 1, Math.max(0, Math.floor(rawSlideIndex)));
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
              ctx.drawImage(pre.bitmap, 0, 0, pre.w, pre.h, x, y, scaledW, scaledH);
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
              const subtitleKey = activeSubtitles.map(s => timedSubtitles.indexOf(s)).join(',');

              if (subtitleKey !== lastSubtitleKey) {
                if (!subtitleCache || subtitleCache.width !== boxWidth || subtitleCache.height !== boxHeight) {
                  subtitleCache = document.createElement('canvas');
                  subtitleCache.width = boxWidth;
                  subtitleCache.height = boxHeight;
                }
                const sctx = subtitleCache.getContext('2d', { alpha: true, willReadFrequently: false })!;
                sctx.clearRect(0, 0, boxWidth, boxHeight);
                sctx.font = `bold ${subtitleFontSize}px "Noto Sans SC", sans-serif`;
                sctx.textAlign = 'center';
                sctx.textBaseline = 'middle';
                sctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                fillRoundRect(sctx, 0, 0, boxWidth, boxHeight, r);
                sctx.fillStyle = 'rgba(0,0,0,0.85)';
                allLines.forEach((line, i) => {
                  const lineCenterY = boxPadding + (i + 0.5) * lineHeight;
                  textOffsets.forEach(([dx, dy]) => sctx.fillText(line, boxWidth / 2 + dx, lineCenterY + dy));
                });
                sctx.fillStyle = '#ffffff';
                allLines.forEach((line, i) => {
                  const lineCenterY = boxPadding + (i + 0.5) * lineHeight;
                  sctx.fillText(line, boxWidth / 2, lineCenterY);
                });
                lastSubtitleKey = subtitleKey;
                lastSubtitleBox = { bx, by, boxWidth, boxHeight };
              }
              ctx.drawImage(subtitleCache!, 0, 0, lastSubtitleBox.boxWidth, lastSubtitleBox.boxHeight, lastSubtitleBox.bx, lastSubtitleBox.by, lastSubtitleBox.boxWidth, lastSubtitleBox.boxHeight);
            }
          } else {
            lastSubtitleKey = '';
          }
        } catch (_) { }

        const totalProgress = Math.min(100, (elapsed / totalDuration) * 100);
        if (totalProgress - lastProgressUpdate >= 1 || totalProgress >= 100) {
          lastProgressUpdate = totalProgress;
          setProgress(totalProgress);
        }
        // 用 requestAnimationFrame 与刷新率同步，避免 setTimeout 堆积导致多图时卡顿
        renderTimerId = requestAnimationFrame(renderLoop);
      };

      renderLoop(performance.now()); // 立即画一帧，传入初始时间戳

    } catch (error) {
      console.error("Video creation failed", error);
      setStatus('idle');
      const msg = error instanceof Error ? error.message : String(error);
      const ttsSnippet = getLastTtsDebugInfo();
      const detail = ttsSnippet ? msg + "\n\n" + ttsSnippet : msg;
      setLastErrorDetail(detail);
      const isFailedFetch = /failed to fetch|network error|load failed/i.test(msg) || msg === "Failed to fetch";
      const isConcurrency = /quota exceeded.*concurrency|concurrency.*quota/i.test(msg);
      let hint: string;
      if (isFailedFetch) {
        hint = "原因: " + msg + "\n\n建议：1) 确认本页与开发服务同一端口（如均为 localhost:3000）；2) 检查网络与防火墙；3) 若使用代理，请确认 /api/proxy 可用。";
      } else if (isConcurrency) {
        hint = "原因: " + msg + "\n\n建议：1) 在火山引擎控制台确认「豆包语音合成」服务开通为「开通」（非暂停）；2) 确认该实例「并发限额」实际≥1（「10 增购并发」可能表示可购买数）；3) 关闭其他使用同一 Key 的页面或应用后重试。";
      } else {
        hint = "原因: " + msg;
      }
      alert("视频合成遇到问题，请重试。\n\n" + hint);
      if (audioCtx) audioCtx.close();
      if (typeof renderTimerId !== 'undefined') cancelAnimationFrame(renderTimerId);
    }
  };

  /** 下载视频文件：桌面版走原生保存对话框（记忆目录），网页版走浏览器下载 */
  const handleDownloadWebm = async () => {
    if (!videoUrl || downloadWebmProgress !== null) return;
    const blob = lastVideoBlobRef.current;
    const ext = videoMimeType.includes('mp4') ? '.mp4' : '.webm';
    const titlePart = videoTitle || `灵感画廊_${Date.now()}`;
    const defaultName = `${titlePart}${ext}`;
    const api = (window as any).electronAPI;

    if (api?.saveVideoFile && blob) {
      // 桌面版：原生保存对话框，记忆目录
      setDownloadWebmProgress(0);
      try {
        const arrayBuffer = await blob.arrayBuffer();
        setDownloadWebmProgress(30);
        const result = await api.saveVideoFile(arrayBuffer, defaultName);
        setDownloadWebmProgress(100);
        if ((result as any).canceled) {
          setToastMessage('已取消');
        } else if ((result as any).error) {
          setToastMessage('保存失败: ' + (result as any).error);
        } else {
          setToastMessage('已保存: ' + (result as any).path);
        }
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 3000);
      } catch (e) {
        setToastMessage('保存失败: ' + (e instanceof Error ? e.message : String(e)));
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 3000);
      } finally {
        setTimeout(() => setDownloadWebmProgress(null), 400);
      }
    } else {
      // 网页版：浏览器下载
      setDownloadWebmProgress(0);
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = defaultName;
      link.click();
      const start = Date.now();
      const animDur = 600;
      const tick = () => {
        const elapsed = Date.now() - start;
        const pct = Math.min(100, (elapsed / animDur) * 100);
        setDownloadWebmProgress(pct);
        if (pct < 100) requestAnimationFrame(tick);
        else setTimeout(() => setDownloadWebmProgress(null), 300);
      };
      requestAnimationFrame(tick);
    }
  };

  const handleExportMp4 = async () => {
    const blob = lastVideoBlobRef.current;
    const api = (window as any).electronAPI;
    if (!blob || !api?.exportVideoAsMp4) return;
    setExportMp4Loading(true);
    setExportMp4Progress(0);
    const duration = previewProgress.duration > 0 ? previewProgress.duration : (knownDurationRef.current > 0 ? knownDurationRef.current : undefined);
    const unsub = api.onExportMp4Progress?.( (p: number) => setExportMp4Progress(p) );
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const mp4Name = `${videoTitle || `灵感画廊_${Date.now()}`}.mp4`;
      const result = await api.exportVideoAsMp4(arrayBuffer, duration, mp4Name);
      if ((result as any).canceled) {
        setToastMessage('已取消');
      } else if ((result as any).error) {
        setToastMessage('MP4 导出失败: ' + (result as any).error);
      } else {
        setToastMessage('已保存 MP4: ' + (result as any).path);
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 3000);
    } catch (e) {
      setToastMessage('导出失败: ' + (e instanceof Error ? e.message : String(e)));
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 3000);
    } finally {
      setExportMp4Loading(false);
      setExportMp4Progress(null);
      if (typeof unsub === 'function') unsub();
    }
  };

  if (validImages.length < 1) return null;

  return (
    <div className="mt-12 md:mt-24 bg-gradient-to-br from-[#0a0a0a] via-[#0d0d0d] to-[#0a0a0a] border border-[#1a1a1a] md:border-[#222] rounded-lg md:rounded-xl p-4 md:p-10 text-slate-300 shadow-2xl relative overflow-hidden">
      {/* 装饰性背景元素 */}
      <div className="absolute top-0 right-0 w-64 md:w-96 h-64 md:h-96 bg-[#d4af37]/[0.02] rounded-full blur-3xl -z-0 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-48 md:w-64 h-48 md:h-64 bg-slate-500/[0.02] rounded-full blur-3xl -z-0 pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-px bg-gradient-to-r from-transparent via-[#222] to-transparent -z-0 pointer-events-none opacity-50"></div>

      <div className="flex flex-col gap-6 md:gap-8 relative z-10">
        {lastErrorDetail && (
          <div className="rounded-sm border border-amber-900/50 bg-amber-950/20 p-3">
            <button
              type="button"
              onClick={() => setShowDiagnostic((v) => !v)}
              className="flex items-center gap-2 text-amber-200 hover:text-amber-100 text-sm font-medium"
            >
              <span>{showDiagnostic ? '▼' : '▶'}</span>
              <span>查看诊断信息（便于复制给开发者）</span>
            </button>
            {showDiagnostic && (
              <div className="mt-3 flex flex-col gap-2">
                <pre className="text-xs text-slate-300 bg-black/40 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {lastErrorDetail}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(lastErrorDetail).then(() => setToastMessage('已复制到剪贴板')).catch(() => setToastMessage('复制失败'));
                    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 2000);
                  }}
                  className="self-end px-3 py-1.5 text-xs bg-[#222] hover:bg-[#333] text-amber-200 rounded"
                >
                  复制
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-10 border-b border-[#1a1a1a] md:border-[#222] pb-4 md:pb-8">
          <div className="w-full md:w-auto">
            <h3 className="text-xl md:text-3xl font-serif italic text-slate-200 flex items-center gap-3 md:gap-4">
              <span className="text-[#d4af37] text-2xl md:text-4xl font-light">/</span> 
              <span className="bg-gradient-to-r from-slate-200 to-slate-400 bg-clip-text text-transparent">Video Production</span>
            </h3>
            <p className="text-slate-500 text-[10px] md:text-xs mt-1 md:mt-3 uppercase tracking-[0.2em] md:tracking-[0.3em]">
              Synthesize Gallery into Motion
            </p>
          </div>

          <div className="flex flex-col gap-3 md:gap-6 items-stretch md:items-end w-full md:w-auto">
            {/* 控制面板 - 网格布局 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-3 md:gap-4 lg:gap-5 w-full md:w-[520px] lg:w-[640px] relative">
              {status === 'done' && (
                <div
                  className="absolute inset-0 z-10 cursor-pointer"
                  onClick={showResetToast}
                  title="点击提示"
                  aria-hidden
                />
              )}
              
              {/* 语音选择器 */}
              <div className="flex items-center gap-3 bg-[#111]/80 md:bg-[#131313] p-2.5 md:p-3 rounded-lg border border-[#222] md:border-[#252525] backdrop-blur-sm transition-all hover:border-[#333] md:hover:border-[#2a2a2a]">
                <span className="text-[10px] text-[#d4af37]/70 uppercase font-semibold tracking-widest shrink-0">语音</span>
                <select
                  value={selectedSpeaker}
                  onChange={(e) => setSelectedSpeaker(e.target.value)}
                  disabled={status !== 'idle'}
                  className="bg-[#0a0a0a] md:bg-[#0d0d0d] text-slate-300 text-xs uppercase tracking-wider px-3 py-2 border-0 rounded-md focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 flex-1 min-w-0 sm:min-w-[100px] md:min-w-[130px] transition-all"
                >
                  {DOUBAO_SPEAKERS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              
              {/* 倍速选择器 */}
              <div className="flex items-center gap-3 bg-[#111]/80 md:bg-[#131313] p-2.5 md:p-3 rounded-lg border border-[#222] md:border-[#252525] backdrop-blur-sm transition-all hover:border-[#333] md:hover:border-[#2a2a2a]">
                <span className="text-[10px] text-[#d4af37]/70 uppercase font-semibold tracking-widest shrink-0">倍速</span>
                <select
                  value={String(selectedSpeed)}
                  onChange={(e) => setSelectedSpeed(parseFloat(e.target.value))}
                  disabled={status !== 'idle'}
                  className="bg-[#0a0a0a] md:bg-[#0d0d0d] text-slate-300 text-xs uppercase tracking-wider rounded-md px-3 py-2 border-0 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 flex-1 min-w-0 sm:min-w-[70px] transition-all"
                >
                  {SPEEDS.map((s) => (
                    <option key={s.value} value={String(s.value)}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* 情感选择器 + 试听 */}
              <div className="flex items-center gap-3 bg-[#111]/80 md:bg-[#131313] p-2.5 md:p-3 rounded-lg border border-[#222] md:border-[#252525] backdrop-blur-sm transition-all hover:border-[#333] md:hover:border-[#2a2a2a]">
                <span className="text-[10px] text-[#d4af37]/70 uppercase font-semibold tracking-widest shrink-0">情感</span>
                <select
                  value={selectedEmotion}
                  onChange={(e) => setSelectedEmotion(e.target.value)}
                  disabled={status !== 'idle'}
                  className="bg-[#0a0a0a] md:bg-[#0d0d0d] text-slate-300 text-xs uppercase tracking-wider px-3 py-2 border-0 rounded-md focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 flex-1 min-w-0 sm:min-w-[90px] md:min-w-[110px] transition-all"
                >
                  {DOUBAO_EMOTIONS.map((e) => (
                    <option key={e.id || 'default'} value={e.id}>{e.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleVoicePreview}
                  disabled={isVoicePreviewLoading}
                  className="p-2 text-[#d4af37] hover:text-[#e5c04a] hover:bg-[#d4af37]/10 disabled:opacity-50 shrink-0 rounded-md transition-all"
                  title="试听语音"
                >
                  {isVoicePreviewLoading ? (
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5">
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 2.485.586 4.815 1.632 6.845.334 1.148 1.442 1.748 2.66 1.748h.092l4.5 4.5c.944.945 2.56.276 2.56-1.06V4.06z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* BGM选择器 + 试听 + 音量 */}
              <div className="flex flex-wrap items-center gap-2.5 bg-[#111]/80 md:bg-[#131313] rounded-lg border border-[#222] md:border-[#252525] p-2.5 md:p-3 backdrop-blur-sm transition-all hover:border-[#333] md:hover:border-[#2a2a2a] sm:col-span-2 md:col-span-1">
                <span className="text-[10px] text-[#d4af37]/70 uppercase font-semibold tracking-widest shrink-0">BGM</span>
                <select
                  value={selectedMusic}
                  onChange={(e) => setSelectedMusic(e.target.value)}
                  disabled={status !== 'idle' || isMusicPreviewLoading}
                  className="bg-[#0a0a0a] md:bg-[#0d0d0d] text-slate-300 text-xs uppercase tracking-wider px-3 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-[#d4af37]/30 flex-1 min-w-0 sm:min-w-[100px] md:min-w-[120px] transition-all"
                >
                  {BGM_TRACKS.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#111]">{m.label}</option>
                  ))}
                </select>
                {selectedMusic !== 'none' && (
                  <button
                    onClick={toggleMusicPreview}
                    disabled={status !== 'idle' || isMusicPreviewLoading}
                    className={`p-2 transition-all shrink-0 rounded-md ${isPlayingPreview
                      ? 'text-red-400 hover:bg-red-400/10'
                      : 'text-[#d4af37] hover:text-[#e5c04a] hover:bg-[#d4af37]/10'
                      }`}
                    title={isPlayingPreview ? "停止" : "试听"}
                  >
                    {isMusicPreviewLoading ? (
                      <span className="w-4 h-4 border-2 border-[#d4af37] border-t-transparent rounded-full animate-spin block"></span>
                    ) : isPlayingPreview ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5">
                        <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5">
                        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                )}
                {/* BGM 音量控制 */}
                {selectedMusic !== 'none' && (
                  <div className="flex items-center gap-2 w-full md:w-auto md:ml-auto">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest whitespace-nowrap shrink-0 hidden md:inline">音量</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={bgmVolume}
                      onChange={(e) => setBgmVolume(Number(e.target.value))}
                      disabled={status !== 'idle'}
                      className="w-24 md:w-20 h-1.5 bg-[#222] rounded-full appearance-none cursor-pointer accent-[#d4af37] disabled:opacity-50"
                    />
                    <span className="text-[10px] text-[#d4af37]/60 tabular-nums w-8 shrink-0 font-medium">{bgmVolume}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* 高级设置 */}
            <div className="flex flex-col gap-2 bg-[#0f0f0f]/60 md:bg-transparent rounded-lg md:rounded-none border border-[#1f1f1f] md:border-0 p-2.5 md:p-0">
              <div className="text-[10px] text-slate-500 uppercase tracking-[0.3em]">高级设置</div>
              <div className="flex flex-wrap items-center gap-3 md:gap-4">
                <label className="flex items-center gap-2 text-slate-500 md:text-slate-400 text-xs cursor-pointer select-none bg-[#111]/80 md:bg-transparent p-2.5 md:p-0 rounded-lg md:rounded-none border border-[#222] md:border-0 hover:text-slate-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={lowSpecMode}
                    onChange={(e) => setLowSpecMode(e.target.checked)}
                    disabled={status !== 'idle'}
                    className="rounded border-[#333] bg-[#111] text-[#d4af37] focus:ring-[#d4af37] focus:ring-offset-0"
                  />
                  <span className="whitespace-nowrap">解决视频卡顿</span>
                </label>
                <label className="flex items-center gap-2 text-slate-500 md:text-slate-400 text-xs cursor-pointer select-none bg-[#111]/80 md:bg-transparent p-2.5 md:p-0 rounded-lg md:rounded-none border border-[#222] md:border-0 hover:text-slate-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={fastAudioMode}
                    onChange={(e) => setFastAudioMode(e.target.checked)}
                    disabled={status !== 'idle'}
                    className="rounded border-[#333] bg-[#111] text-[#d4af37] focus:ring-[#d4af37] focus:ring-offset-0"
                  />
                  <span className="whitespace-nowrap">极速模式（音频并行合成）</span>
                </label>
              </div>
            </div>

            {/* 生成按钮区域 */}
            {status === 'idle' && (
              <div className="flex flex-col xs:flex-row items-stretch xs:items-center gap-3 md:gap-4 w-full md:w-auto md:justify-end pt-2 md:pt-0">
                <button
                  onClick={handleCreateVideo}
                  className="group relative bg-gradient-to-r from-[#d4af37] to-[#c9a227] hover:from-[#e5c04a] hover:to-[#d4af37] text-black px-6 md:px-8 py-3 rounded-lg font-serif italic text-base md:text-lg transition-all shadow-[0_4px_20px_0_rgba(212,175,55,0.3)] hover:shadow-[0_6px_30px_0_rgba(212,175,55,0.4)] flex items-center justify-center gap-2 w-full sm:w-auto overflow-hidden"
                >
                  <span className="relative z-10">Generate Video</span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5 relative z-10 group-hover:translate-x-0.5 transition-transform">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Progress or Actions */}
        <div className="flex justify-center mt-4 md:mt-8">
          {(status === 'generating_audio' || status === 'rendering' || status === 'finalizing') && (
            <div className="flex flex-col items-center w-full max-w-lg px-4 md:px-0">
              <div className="w-full bg-[#1a1a1a] md:bg-[#151515] rounded-full h-2 md:h-2.5 mb-4 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-[#d4af37] to-[#e5c04a] h-full transition-all duration-150 ease-out rounded-full"
                  style={{ 
                    width: `${progress}%`,
                    boxShadow: '0 0 20px rgba(212, 175, 55, 0.5), 0 0 40px rgba(212, 175, 55, 0.2)'
                  }}
                ></div>
              </div>
              <span className="text-[10px] md:text-sm text-[#d4af37] font-mono tracking-widest uppercase text-center flex items-center gap-2">
                <span className="w-2 h-2 bg-[#d4af37] rounded-full animate-pulse"></span>
                {status === 'generating_audio' && 'Synthesizing Voice...'}
                {status === 'rendering' && `Rendering Frames: ${Math.round(progress)}%`}
                {status === 'finalizing' && 'Finalizing Output...'}
              </span>
            </div>
          )}

          {status === 'done' && videoUrl && (
            <div className="flex flex-col xs:flex-row items-center gap-3 md:gap-5 w-full xs:w-auto flex-wrap">
              <div className="flex flex-col gap-2 w-full xs:w-auto">
                <button
                  type="button"
                  onClick={handleDownloadWebm}
                  disabled={downloadWebmProgress !== null}
                  className="group bg-gradient-to-r from-[#d4af37] to-[#c9a227] hover:from-[#e5c04a] hover:to-[#d4af37] disabled:opacity-80 text-black px-6 md:px-10 py-3 md:py-3.5 rounded-lg font-serif italic text-base md:text-xl transition-all flex items-center justify-center gap-2 md:gap-3 shadow-[0_4px_20px_0_rgba(212,175,55,0.3)] hover:shadow-[0_6px_30px_0_rgba(212,175,55,0.4)] w-full xs:w-auto"
                >
                  {downloadWebmProgress !== null ? (
                    <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-6 md:h-6 group-hover:translate-y-0.5 transition-transform">
                        <path fillRule="evenodd" d="M19.5 21a3 3 0 003-3V9a3 3 0 00-3-3h-1.246a.75.75 0 01-.573-.268l-1.394-1.63A2.25 2.25 0 0014.574 3H9.426a2.25 2.25 0 00-1.713.802L6.319 5.432a.75.75 0 01-.573.268H4.5a3 3 0 00-3 3v9a3 3 0 003 3h15zM12 10.5a3.75 3.75 0 100 7.5 3.75 3.75 0 000-7.5zm-1.5 3.75a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" clipRule="evenodd" />
                      </svg>
                      下载视频
                    </>
                  )}
                </button>
                {downloadWebmProgress !== null && (
                  <div className="w-full min-w-[160px] rounded-lg bg-[#111] border border-[#2a2a2a] px-3 py-2">
                    <div className="text-[10px] text-[#d4af37]/90 uppercase tracking-wider mb-1.5">下载 WebM</div>
                    <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#d4af37] transition-all duration-200 rounded-full"
                        style={{ width: `${downloadWebmProgress}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 tabular-nums">{Math.round(downloadWebmProgress)}%</div>
                  </div>
                )}
              </div>
              {isDesktop && (
                <div className="flex flex-col gap-2 w-full xs:w-auto">
                  <button
                    type="button"
                    onClick={handleExportMp4}
                    disabled={exportMp4Loading}
                    className="group bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-60 text-white px-6 md:px-10 py-3 md:py-3.5 rounded-lg font-serif italic text-base md:text-xl transition-all flex items-center justify-center gap-2 md:gap-3 shadow-[0_4px_20px_0_rgba(16,185,129,0.3)] w-full xs:w-auto"
                  >
                    {exportMp4Loading ? (
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-6 md:h-6">
                          <path fillRule="evenodd" d="M4.5 3.75a3 3 0 00-3 3v10.5a3 3 0 003 3h15a3 3 0 003-3V6.75a3 3 0 00-3-3h-15zm9 4.5a.75.75 0 00-1.28-.53l-3 3a.75.75 0 000 1.06l3 3a.75.75 0 001.28-.53v-1.5h2.25a.75.75 0 000-1.5H13.5v-1.5z" clipRule="evenodd" />
                        </svg>
                        导出 MP4
                      </>
                    )}
                  </button>
                  {exportMp4Loading && (
                    <div className="w-full min-w-[160px] rounded-lg bg-[#0d1f0d] border border-emerald-900/50 px-3 py-2">
                      <div className="text-[10px] text-emerald-400/90 uppercase tracking-wider mb-1.5">导出 MP4 中</div>
                      <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                          style={{ width: `${exportMp4Progress ?? 0}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 tabular-nums">{exportMp4Progress ?? 0}%</div>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setStatus('idle')}
                className="text-slate-500 hover:text-slate-200 px-5 md:px-6 py-2.5 md:py-3 text-xs md:text-sm uppercase tracking-widest border border-slate-600/30 hover:border-slate-400/50 rounded-lg w-full xs:w-auto transition-all hover:bg-slate-800/30"
              >
                重新生成
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden Canvas for Rendering */}
      <div className="hidden">
        <canvas ref={canvasRef} />
      </div>

      {/* Preview Player：仅保留一条自定义进度条，用缓存避免下载/导出后重渲染导致进度条消失 */}
      {status === 'done' && videoUrl && (() => {
        const cached = lastPreviewProgressRef.current;
        const displayProgress = previewProgress.duration > 0 ? previewProgress : (cached.duration > 0 ? cached : { current: 0, duration: 0 });
        return (
        <div className="mt-8 md:mt-12 space-y-3 md:space-y-4" key="preview-player">
          <div className="overflow-hidden border border-[#252525] md:border-[#2a2a2a] bg-black w-full max-w-3xl mx-auto shadow-2xl rounded-lg md:rounded-xl ring-1 ring-white/5">
            <div
              className="relative group cursor-pointer"
              onClick={() => {
                const v = previewVideoRef.current;
                if (!v) return;
                v.paused ? v.play() : v.pause();
              }}
            >
              <video
                ref={previewVideoRef}
                src={videoUrl}
                className="w-full h-auto block"
                playsInline
                style={{ imageRendering: 'auto', transform: 'translateZ(0)' }}
              />
              {/* 半透明播放/暂停按钮叠加层 */}
              <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${isPreviewPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/10">
                  {isPreviewPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-8 h-8 md:w-10 md:h-10 opacity-90">
                      <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-8 h-8 md:w-10 md:h-10 opacity-90 ml-1">
                      <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-2 py-2 bg-[#0d0d0d] border-t border-[#252525]">
              <button
                type="button"
                onClick={() => {
                  const v = previewVideoRef.current;
                  if (!v) return;
                  v.paused ? v.play() : v.pause();
                }}
                className="p-1.5 text-[#d4af37] hover:bg-[#d4af37]/10 rounded transition-colors"
                aria-label="播放/暂停"
              >
                {isPreviewPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <div
                className="flex-1 min-w-0 h-2 bg-[#1a1a1a] cursor-pointer group rounded-full overflow-hidden flex items-center"
                role="progressbar"
                aria-valuenow={displayProgress.duration ? (displayProgress.current / displayProgress.duration) * 100 : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                onClick={(e) => {
                  const el = e.currentTarget;
                  const video = previewVideoRef.current;
                  if (!video || !displayProgress.duration) return;
                  const x = e.clientX - el.getBoundingClientRect().left;
                  const pct = Math.max(0, Math.min(1, x / el.offsetWidth));
                  const wasPlaying = !video.paused;
                  video.currentTime = pct * displayProgress.duration;
                  // WebM blob seek 后 Chromium 可能卡住，强制恢复播放
                  if (wasPlaying) {
                    video.play().catch(() => {});
                  }
                }}
              >
                <div
                  className="h-full min-w-[2px] bg-[#d4af37] transition-all duration-150 ease-out rounded-full group-hover:bg-[#e5c04a]"
                  style={{ width: displayProgress.duration ? `${(displayProgress.current / displayProgress.duration) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-[10px] text-slate-500 tabular-nums w-20 shrink-0 text-right">
                {displayProgress.duration > 0
                  ? `${Math.floor(displayProgress.current / 60)}:${String(Math.floor(displayProgress.current % 60)).padStart(2, '0')} / ${Math.floor(displayProgress.duration / 60)}:${String(Math.floor(displayProgress.duration % 60)).padStart(2, '0')}`
                  : '--:-- / --:--'}
              </span>
            </div>
          </div>
          <p className="text-slate-500 md:text-slate-400 text-[10px] md:text-xs max-w-2xl mx-auto text-center px-4 md:px-0 leading-relaxed">
            {isDesktop
              ? '桌面版支持直接「导出 MP4」；也可下载 WebM。'
              : 'Chrome / Edge 仅支持导出 WebM。如需 MP4：用 Safari 可尝试直接录制，或下载后用 ffmpeg 转换：'}
            {!isDesktop && (
              <code className="bg-[#1a1a1a] md:bg-[#181818] px-1.5 py-0.5 rounded text-[10px] md:text-xs text-slate-400 md:text-[#d4af37]/60 ml-1">ffmpeg -i 文件.webm -c copy 文件.mp4</code>
            )}
          </p>
        </div>
        );
      })()}

      {/* Toast：生成后点击语音/倍速/BGM 时提示 */}
      {toastMessage && (
        <div
          className="fixed bottom-4 md:bottom-10 left-1/2 -translate-x-1/2 z-50 px-5 md:px-8 py-2.5 md:py-4 rounded-xl bg-[#151515]/95 md:bg-[#131313]/95 border border-[#d4af37]/50 md:border-[#d4af37]/40 text-[#d4af37] text-xs md:text-sm font-medium shadow-2xl backdrop-blur-md max-w-[90vw] text-center"
          role="alert"
          style={{ boxShadow: '0 0 40px rgba(212, 175, 55, 0.15)' }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default VideoMaker;