/**
 * 豆包（火山引擎）语音合成 TTS 服务 - 仅 1.0 音色
 * 音色：Anna / Dryw / Charlie / Xavier，走 v3 单向流式接口。
 * API 文档: https://www.volcengine.com/docs/6561/1257584
 */

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

const USE_CORS_PROXY =
  typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_USE_CORS_PROXY === "true";
const CORS_PROXY_PREFIX =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CORS_PROXY) || "https://corsproxy.io/?";

function getFallbackCorsProxy(): string | null {
  return USE_CORS_PROXY ? CORS_PROXY_PREFIX : null;
}

function getProxyUrl(target: string): string {
  const origin = typeof window !== "undefined" ? window.location?.origin : "";
  const base = origin && origin !== "null" ? origin : "";
  if (base) return `${base}/api/proxy?url=${encodeURIComponent(target)}`;
  const fallback = getFallbackCorsProxy();
  if (fallback && fallback !== "null" && fallback !== "undefined") return fallback + encodeURIComponent(target);
  return `/api/proxy?url=${encodeURIComponent(target)}`;
}

let lastTtsDebugSnippet = "";
export function getLastTtsDebugInfo(): string {
  return lastTtsDebugSnippet;
}

function isValidBase64(s: string): boolean {
  const t = s.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*=*$/.test(t)) return false;
  const padded = t.length % 4 === 0 ? t : t + "==".slice(0, (4 - (t.length % 4)) % 4);
  try {
    atob(padded);
    return true;
  } catch {
    return false;
  }
}

/** 从环境变量读取，Vite 仅暴露 VITE_ 前缀变量；未配置时请求会报 45000000 */
function getDoubaoKey(): { accessKey: string; appId: string; bigttsInstanceId: string } {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env : {};
  return {
    accessKey: (env.VITE_DOUBAO_TTS_ACCESS_KEY || "").trim(),
    appId: (env.VITE_DOUBAO_TTS_APP_ID || "").trim(),
    bigttsInstanceId: (env.VITE_DOUBAO_TTS_BIGTTS_INSTANCE || "").trim(),
  };
}

/** 1.0 资源（适用于 ICL 音色 Charlie / Xavier） */
const RESOURCE_ID_TTS_1 = "volc.service_type.10029";

/** 豆包 TTS 音色列表（仅 1.0：Shiny / Alvin） */
export const DOUBAO_SPEAKERS = [
  { id: "zh_female_cancan_mars_bigtts", label: "Shiny" },
  { id: "zh_male_wennuanahu_moon_bigtts", label: "Alvin" },
] as const;

export const DOUBAO_EMOTIONS = [
  { id: "neutral", label: "中性 (Neutral)" },
  { id: "happy", label: "愉悦 (Happy)" },
  { id: "sad", label: "悲伤 (Sad)" },
  { id: "", label: "默认" },
] as const;

export type DoubaoSpeakerId = (typeof DOUBAO_SPEAKERS)[number]["id"];

const DEFAULT_SPEAKER: DoubaoSpeakerId = "zh_female_cancan_mars_bigtts";

async function fetchDoubaoTtsMp3(
  text: string,
  speaker: string = DEFAULT_SPEAKER,
  options?: { emotion?: string; emotionScale?: number }
): Promise<ArrayBuffer> {
  lastTtsDebugSnippet = "";
  const audioParams: Record<string, unknown> = {
    format: "mp3",
    sample_rate: 24000,
  };
  if (options?.emotion) {
    audioParams.emotion = options.emotion;
    audioParams.emotion_scale = Math.max(1, Math.min(5, options.emotionScale ?? 4));
  }
  const body = {
    user: { uid: "gallery" },
    req_params: {
      text,
      speaker,
      additions: JSON.stringify({
        disable_markdown_filter: true,
        enable_language_detector: true,
        enable_latex_tn: true,
        disable_default_bit_rate: true,
        max_length_to_filter_parenthesis: 0,
        cache_config: { text_type: 1, use_cache: true },
      }),
      audio_params: audioParams,
    },
  };

  const { accessKey, appId } = getDoubaoKey();
  if (!accessKey) {
    throw new Error(
      "未配置豆包 TTS Key。请在项目根目录 .env 中设置 VITE_DOUBAO_TTS_ACCESS_KEY（火山方舟/豆包控制台获取），保存后重启 dev 服务。"
    );
  }

  // 仅用 1.0 资源，避免 Key 未开通 BigTTS 时 403。Charlie/Xavier 可用；Anna/Dryw 需控制台开通 BigTTS 后再配 VITE_DOUBAO_TTS_BIGTTS_INSTANCE
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Resource-Id": RESOURCE_ID_TTS_1,
    Connection: "keep-alive",
    "X-Api-Key": accessKey,
  };
  if (appId) {
    headers["X-Api-App-Id"] = appId;
  }

  const corsProxy = getFallbackCorsProxy();
  const endpointsToTry = [
    ...(corsProxy ? [corsProxy + encodeURIComponent(TTS_ENDPOINT)] : []),
    getProxyUrl(TTS_ENDPOINT),
  ];

  // 收集所有 Base64 片段，稍后分别解码
  const base64Chunks: string[] = [];
  let lastError: Error | null = null;

  // 安全解码单个 Base64 片段
  const decodeBase64Chunk = (b64: string): Uint8Array => {
    const clean = b64.replace(/\s/g, "");
    const padded = clean.length % 4 === 0 ? clean : clean + "=".repeat((4 - (clean.length % 4)) % 4);
    const bin = atob(padded);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  };

  for (const endpoint of endpointsToTry) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const rawText = await response.text();

      if (!response.ok) {
        lastTtsDebugSnippet = `[TTS ${response.status}]\n${rawText.slice(0, 800)}`;
        lastError = new Error(`豆包 TTS 请求失败: ${response.status} - ${rawText.slice(0, 300)}`);
        continue;
      }

      const trimmed = rawText.trim();
      if (trimmed.startsWith("<") || /<\s*!?DOCTYPE|<\s*html/i.test(trimmed)) {
        lastError = new Error("代理返回了 HTML 页面，请确认与开发服务同端口、/api/proxy 可用。");
        continue;
      }

      const isLikelyBase64 = (s: string) => {
        const t = s.replace(/\s/g, "");
        return t.length > 0 && /^[A-Za-z0-9+/]*=*$/.test(t);
      };

      const lines = trimmed.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.code === 20000000) continue;
          if (obj.code === 55000000 && typeof obj.message === "string") {
            throw new Error(`音色与资源不匹配 (55000000): ${obj.message}，请确认控制台已开通对应 1.0 音色。`);
          }
          if (obj.data && typeof obj.data === "string" && isLikelyBase64(obj.data)) {
            base64Chunks.push(obj.data);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("音色与资源不匹配")) throw e;
        }
      }

      if (base64Chunks.length === 0 && trimmed) {
        try {
          const single = JSON.parse(rawText);
          if (single?.code === 55000000 && single?.message) {
            throw new Error(`音色与资源不匹配 (55000000): ${single.message}`);
          }
          const d = single?.data ?? single?.result?.data ?? single?.audio;
          if (d && typeof d === "string" && isLikelyBase64(d)) base64Chunks.push(d);
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("音色与资源不匹配")) throw e;
        }
      }

      if (base64Chunks.length > 0) break;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  if (base64Chunks.length === 0) {
    const debug = lastTtsDebugSnippet ? "\n\n最近响应片段：\n" + lastTtsDebugSnippet : "";
    throw new Error(
      "豆包 TTS 未返回音频。" +
        (lastError ? " " + lastError.message : "") +
        debug +
        "\n\n请确认：1) 环境变量 VITE_DOUBAO_TTS_ACCESS_KEY（及可选 VITE_DOUBAO_TTS_APP_ID）已配置；2) 控制台已开通「语音合成」及 1.0 音色；3) 与开发服务同源并启用 /api/proxy。"
    );
  }

  // 分别解码每个 Base64 片段，然后拼接二进制数据
  const binaryChunks: Uint8Array[] = [];
  for (let i = 0; i < base64Chunks.length; i++) {
    try {
      binaryChunks.push(decodeBase64Chunk(base64Chunks[i]));
    } catch (e) {
      console.error(`[TTS] Failed to decode chunk ${i}:`, {
        length: base64Chunks[i].length,
        first30: base64Chunks[i].slice(0, 30),
        last30: base64Chunks[i].slice(-30),
        error: e,
      });
      throw new Error(`TTS 音频片段 ${i + 1}/${base64Chunks.length} 解码失败，请重试。`);
    }
  }

  // 合并所有二进制数据
  const totalLength = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of binaryChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined.buffer;
}

async function decodeMp3ToPcm24k(mp3Buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (!mp3Buffer.byteLength) throw new Error("TTS 返回的音频为空");
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(mp3Buffer.slice(0));
  } catch (e) {
    audioCtx.close();
    throw new Error("TTS 音频解码失败，请确认 API 返回为 MP3。");
  }
  audioCtx.close();

  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const targetRate = 24000;
  let float32: Float32Array = channel;
  if (sampleRate !== targetRate) {
    const ratio = sampleRate / targetRate;
    const newLength = Math.round(channel.length / ratio);
    float32 = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const j = Math.floor(srcIndex);
      const f = srcIndex - j;
      float32[i] = channel[j] * (1 - f) + (channel[j + 1] ?? channel[j]) * f;
    }
  }
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16.buffer;
}

export type DoubaoEmotionOptions = { emotion?: string; emotionScale?: number };

const ttsCache = new Map<string, ArrayBuffer>();
const TTS_CACHE_MAX = 200;

function getTtsCacheKey(text: string, speaker: string, options?: DoubaoEmotionOptions): string {
  const e = options?.emotion ?? "";
  const s = options?.emotionScale ?? 0;
  return `${speaker}|${e}|${s}|${text}`;
}

export const generateSpeechDoubao = async (
  text: string,
  speaker: string = DEFAULT_SPEAKER,
  options?: DoubaoEmotionOptions
): Promise<ArrayBuffer> => {
  const key = getTtsCacheKey(text, speaker, options);
  const cached = ttsCache.get(key);
  if (cached) return cached.slice(0);

  const mp3Buffer = await fetchDoubaoTtsMp3(text, speaker, options);
  const pcm = await decodeMp3ToPcm24k(mp3Buffer);

  if (ttsCache.size >= TTS_CACHE_MAX) {
    const firstKey = ttsCache.keys().next().value;
    if (firstKey !== undefined) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, pcm.slice(0));
  return pcm;
};
