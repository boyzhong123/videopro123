/**
 * 豆包（火山引擎）语音合成 TTS 服务
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

/** 同源代理 URL（开发/生产用）；可选启用 CORS 代理 */
function getProxyUrl(target: string): string {
  if (typeof window !== "undefined" && window.location?.origin)
    return `${window.location.origin}/api/proxy?url=${encodeURIComponent(target)}`;
  const fallback = getFallbackCorsProxy();
  return fallback ? fallback + encodeURIComponent(target) : target;
}

function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|network error|load failed|networkrequestfailed/i.test(msg) || msg === "Failed to fetch";
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

/** 火山引擎控制台获取：Access Token / Access Key（必填）。可用 VITE_DOUBAO_TTS_ACCESS_KEY 覆盖 */
const DOUBAO_TTS_ACCESS_KEY =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_DOUBAO_TTS_ACCESS_KEY) ||
  "bMF6HSM9By3VFGyDfw1xgKME4sgR2Eff";
/** 火山引擎控制台获取：App ID。v3 接口要求必填，未填可能报 resource ID is mismatched。可用 VITE_DOUBAO_TTS_APP_ID 覆盖 */
const DOUBAO_TTS_APP_ID =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_DOUBAO_TTS_APP_ID) ||
  "1481136284";

/** TTS 1.0 资源 ID（仅适用于 1.0 音色） */
const RESOURCE_ID_TTS_1 = "volc.service_type.10029";
const RESOURCE_ID_TTS_1_ALT = "seed-tts-1.0";
const RESOURCE_ID_TTS_1_CONCURR = "volc.service_type.10048";
/** TTS 2.0 资源 ID（仅适用于 2.0 音色），见 https://www.volcengine.com/docs/6561/1598757 */
const RESOURCE_ID_TTS_2 = "seed-tts-2.0";
/** 控制台「实例ID/名称」：仅当 seed-tts-2.0 返回 resource ID is mismatched 时再试此 ID，串行、不增加并发 */
const TTS_2_INSTANCE_ID = "TTS-SeedTTS2.02000000601512017026";

/** 是否仅使用 TTS 2.0。true=先试 seed-tts-2.0，若 mismatch 再试实例 ID */
const USE_TTS_2_ONLY = true;

/** 每句 TTS 最多请求次数 */
const MAX_TTS_ATTEMPTS = 5;

/**
 * 2.0 音色（通用场景），参考：https://www.volcengine.com/docs/6561/1257544
 * 支持能力：情感变化、指令遵循、ASMR。朗读情感可通过 emotion / emotion_scale 调节。
 */
export const DOUBAO_SPEAKERS = [
  { id: "zh_female_xiaohe_uranus_bigtts", label: "小何 2.0（女）" },
  { id: "zh_female_santongyongns_saturn_bigtts", label: "流畅女声" },
  { id: "zh_male_m191_uranus_bigtts", label: "云舟 2.0（男）" },
  { id: "zh_male_taocheng_uranus_bigtts", label: "小天 2.0（男）" },
] as const;

/** 2.0 通用场景音色支持的朗读情感（部分音色/情感组合以控制台为准） */
export const DOUBAO_EMOTIONS = [
  { id: "neutral", label: "中性 (Neutral)" },
  { id: "authoritative", label: "权威 (Authoritative)" },
  { id: "happy", label: "愉悦 (Happy)" },
  { id: "excited", label: "兴奋 (Excited)" },
  { id: "warm", label: "温暖 (Warm)" },
  { id: "affectionate", label: "深情 (Affectionate)" },
  { id: "chat", label: "对话/闲聊 (Chat)" },
  { id: "asmr", label: "低语 (ASMR)" },
  { id: "angry", label: "愤怒 (Angry)" },
  { id: "sad", label: "悲伤 (Sad)" },
  { id: "", label: "默认" },
  { id: "fear", label: "恐惧" },
  { id: "disgusted", label: "厌恶" },
  { id: "surprised", label: "惊讶" },
] as const;

export type DoubaoSpeakerId = (typeof DOUBAO_SPEAKERS)[number]["id"];

const DEFAULT_SPEAKER: DoubaoSpeakerId = "zh_female_santongyongns_saturn_bigtts"; // 流畅女声

/**
 * 调用豆包 TTS 接口（v3 单向流式），返回 MP3 的 ArrayBuffer。
 * 若返回 55000000 resource ID 与音色不匹配，会自动用另一资源 ID 重试一次。
 */
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
  const buildBody = (speakerId: string) => ({
    user: { uid: "gallery" },
    req_params: {
      text,
      speaker: speakerId,
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
  });

  const body = buildBody(speaker);

  const tryWithResourceId = async (resourceId: string, endpoint: string, requestBody = body): Promise<string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": resourceId,
      Connection: "keep-alive",
    };
    if (DOUBAO_TTS_APP_ID) {
      headers["X-Api-App-Id"] = DOUBAO_TTS_APP_ID;
      headers["X-Api-Access-Key"] = DOUBAO_TTS_ACCESS_KEY;
    } else {
      headers["x-api-key"] = DOUBAO_TTS_ACCESS_KEY;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`豆包 TTS 请求失败: ${response.status} - ${rawText.slice(0, 500)}`);
    }
    const trimmed = rawText.trim();
    if (trimmed.startsWith("<") || /<\s*!?DOCTYPE|<\s*html/i.test(trimmed)) {
      throw new Error("代理或网络返回了 HTML 页面（非 TTS 数据），请确认本页与开发服务同端口、/api/proxy 可用，或稍后重试。");
    }
    if (trimmed.startsWith("{")) {
      try {
        const o = JSON.parse(trimmed);
        if (o && typeof o === "object" && !(o.data || o.result?.data || o.audio)) {
          const msg = o.message ?? o.error ?? o.msg ?? o.err_msg;
          if (typeof msg === "string" && msg.length > 0) {
            throw new Error("豆包 TTS 接口返回错误: " + msg);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("豆包 TTS 接口返回错误:")) throw e;
      }
    }

    const isLikelyBase64 = (s: string) => {
      const t = s.replace(/\s/g, "");
      return t.length > 0 && /^[A-Za-z0-9+/]*=*$/.test(t);
    };

    let fullBase64 = "";
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.code === 20000000) continue;
        if (obj.code === 55000000 && typeof obj.message === "string") {
          throw new Error(`API 返回: ${obj.message} (code ${obj.code})`);
        }
        if (obj.data && typeof obj.data === "string" && isLikelyBase64(obj.data)) {
          fullBase64 += obj.data;
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("API 返回:")) throw e;
      }
    }

    if (!fullBase64 && trimmed) {
      try {
        const single = JSON.parse(rawText);
        if (single?.code === 55000000 && single?.message) {
          throw new Error(`API 返回: ${single.message} (code ${single.code})`);
        }
        const d = single?.data ?? single?.result?.data ?? single?.audio;
        if (d && typeof d === "string" && isLikelyBase64(d)) fullBase64 = d;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("API 返回:")) throw e;
      }
    }

    return fullBase64;
  };

  // 仅用 seed-tts-2.0，不发实例 ID，避免 403 requested resource not granted
  const resourceIds = USE_TTS_2_ONLY
    ? [RESOURCE_ID_TTS_2]
    : [RESOURCE_ID_TTS_1, RESOURCE_ID_TTS_1_ALT, RESOURCE_ID_TTS_1_CONCURR, RESOURCE_ID_TTS_2];

  const endpointsToTry = [
    getFallbackCorsProxy() + encodeURIComponent(TTS_ENDPOINT),
    getProxyUrl(TTS_ENDPOINT),
  ];

  let fullBase64 = "";
  let lastError: Error | null = null;
  let attempts = 0;

  for (const resourceId of resourceIds) {
    for (const endpoint of endpointsToTry) {
      if (attempts >= MAX_TTS_ATTEMPTS) break;
      attempts += 1;
      try {
        const got = await tryWithResourceId(resourceId, endpoint);
        if (got && isValidBase64(got)) {
          fullBase64 = got;
          break;
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const msg = lastError.message;
        const isResourceMismatch = /resource ID is mismatched|55000000/i.test(msg);
        if (isResourceMismatch) {
          continue;
        }
        if (isNetworkError(e) && endpoint === endpointsToTry[0]) {
          continue;
        }
        throw lastError;
      }
      if (fullBase64) break;
    }
    if (fullBase64) break;
  }

  if (!fullBase64) {
    const hint = lastError?.message ?? "";
    throw new Error(
      "豆包 TTS 未返回音频数据（resource ID 与音色不匹配）。\n\n" +
      "请确认：1) 控制台已开通「语音合成大模型」/ 豆包语音合成；2) 当前 Key 绑定的应用已开通 TTS 服务；3) 在控制台「音色列表」或通过 ListSpeakers 接口查看该 Key 实际可用的 speaker_id 与 resource_id，并确保 doubaoTtsService.ts 中的 DOUBAO_SPEAKERS 与 Resource ID 与之一致。\n" + hint
    );
  }

  const cleanBase64 = fullBase64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*=*$/.test(cleanBase64)) {
    lastTtsDebugSnippet = "[TTS 返回片段，前 500 字符]\n" + cleanBase64.slice(0, 500);
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[TTS] 代理返回非 Base64，前 300 字符:", cleanBase64.slice(0, 300));
    }
    throw new Error(
      "豆包 TTS 返回的数据不是有效的 Base64 音频。可能是代理或网络返回了错误页（如 HTML），请检查：1) 本页与开发服务是否同端口；2) /api/proxy 是否正常；3) 豆包 TTS 的 API Key 是否有效；4) 稍后重试。"
    );
  }
  const padded = cleanBase64.length % 4 === 0 ? cleanBase64 : cleanBase64 + "==".slice(0, (4 - (cleanBase64.length % 4)) % 4);
  let binaryString: string;
  try {
    binaryString = atob(padded);
  } catch {
    lastTtsDebugSnippet = "[TTS 返回片段，前 500 字符]\n" + cleanBase64.slice(0, 500);
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[TTS] Base64 解码失败，前 300 字符:", cleanBase64.slice(0, 300));
    }
    throw new Error(
      "豆包 TTS 返回的数据不是有效的 Base64 音频。可能是代理或网络返回了错误页（如 HTML），请检查：1) 本页与开发服务是否同端口；2) /api/proxy 是否正常；3) 豆包 TTS 的 API Key 是否有效；4) 稍后重试。"
    );
  }
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 将 MP3 ArrayBuffer 解码为 24kHz 单声道 PCM Int16，与现有 generateSpeech 输出一致
 */
async function decodeMp3ToPcm24k(mp3Buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (!mp3Buffer.byteLength) {
    throw new Error("豆包 TTS 返回的音频为空");
  }
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(mp3Buffer.slice(0));
  } catch (e) {
    audioCtx.close();
    throw new Error("豆包 TTS 音频解码失败，请确认 API 返回为 MP3。");
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

/** 朗读情感选项（2.0 通用场景音色支持） */
export type DoubaoEmotionOptions = { emotion?: string; emotionScale?: number };

/**
 * 豆包语音合成：输入文本、发音人，可选朗读情感，输出 24kHz 单声道 PCM Int16
 */
export const generateSpeechDoubao = async (
  text: string,
  speaker: string = DEFAULT_SPEAKER,
  options?: DoubaoEmotionOptions
): Promise<ArrayBuffer> => {
  const mp3Buffer = await fetchDoubaoTtsMp3(text, speaker, options);
  return decodeMp3ToPcm24k(mp3Buffer);
};
