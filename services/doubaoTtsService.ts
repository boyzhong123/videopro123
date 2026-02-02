/**
 * 豆包（火山引擎）语音合成 TTS 服务
 * API 文档: https://www.volcengine.com/docs/6561/1257584
 */

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

/** 同源代理 URL（开发/生产用） */
function getProxyUrl(target: string): string {
  if (typeof window !== "undefined" && window.location?.origin)
    return `${window.location.origin}/api/proxy?url=${encodeURIComponent(target)}`;
  return getFallbackCorsProxy() + encodeURIComponent(target);
}

/** 同源代理失败时回退：VITE_CORS_PROXY 或 corsproxy.io */
function getFallbackCorsProxy(): string {
  return (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CORS_PROXY) || "https://corsproxy.io/?";
}

function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|network error|load failed|networkrequestfailed/i.test(msg) || msg === "Failed to fetch";
}

/** 火山引擎控制台获取：Access Key（必填） */
const DOUBAO_TTS_ACCESS_KEY = "967f1530-77bd-4c80-a841-80d9840db772";
/** 火山引擎控制台获取：App ID（v3 接口建议填写，否则仅用 x-api-key 尝试） */
const DOUBAO_TTS_APP_ID = "";

/** TTS 1.0 资源 ID（仅适用于 1.0 音色） */
const RESOURCE_ID_TTS_1 = "volc.service_type.10029";
const RESOURCE_ID_TTS_1_ALT = "seed-tts-1.0";
const RESOURCE_ID_TTS_1_CONCURR = "volc.service_type.10048";
/** TTS 2.0 资源 ID（仅适用于 2.0 音色） */
const RESOURCE_ID_TTS_2 = "seed-tts-2.0";

/** 是否仅使用 TTS 2.0（与控制台「豆包语音合成模型2.0」一致时设为 true） */
const USE_TTS_2_ONLY = true;

/**
 * 2.0 音色（通用场景），参考：https://www.volcengine.com/docs/6561/1257544
 * 支持能力：情感变化、指令遵循、ASMR。朗读情感可通过 emotion / emotion_scale 调节。
 */
export const DOUBAO_SPEAKERS = [
  { id: "zh_female_xiaohe_uranus_bigtts", label: "小何 2.0（女）" },
  { id: "zh_female_vv_uranus_bigtts", label: "Vivi 2.0（女）" },
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

const DEFAULT_SPEAKER: DoubaoSpeakerId = "zh_female_vv_uranus_bigtts"; // Vivi 2.0（女）

/**
 * 调用豆包 TTS 接口（v3 单向流式），返回 MP3 的 ArrayBuffer。
 * 若返回 55000000 resource ID 与音色不匹配，会自动用另一资源 ID 重试一次。
 */
async function fetchDoubaoTtsMp3(
  text: string,
  speaker: string = DEFAULT_SPEAKER,
  options?: { emotion?: string; emotionScale?: number }
): Promise<ArrayBuffer> {
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

  const tryWithResourceId = async (resourceId: string, endpoint: string): Promise<string> => {
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
      body: JSON.stringify(body),
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`豆包 TTS 请求失败: ${response.status} - ${rawText.slice(0, 500)}`);
    }
    const trimmed = rawText.trim();
    if (trimmed.startsWith("<") || /<\s*!?DOCTYPE|<\s*html/i.test(trimmed)) {
      throw new Error("代理或网络返回了 HTML 页面（非 TTS 数据），请确认本页与开发服务同端口、/api/proxy 可用，或稍后重试。");
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

  const resourceIds = USE_TTS_2_ONLY
    ? [RESOURCE_ID_TTS_2]
    : [RESOURCE_ID_TTS_1, RESOURCE_ID_TTS_1_ALT, RESOURCE_ID_TTS_1_CONCURR, RESOURCE_ID_TTS_2];

  const endpointsToTry = [getProxyUrl(TTS_ENDPOINT), getFallbackCorsProxy() + encodeURIComponent(TTS_ENDPOINT)];

  let fullBase64 = "";
  let lastError: Error | null = null;

  for (const resourceId of resourceIds) {
    for (const endpoint of endpointsToTry) {
      try {
        fullBase64 = await tryWithResourceId(resourceId, endpoint);
        if (fullBase64) break;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const msg = lastError.message;
        if (!USE_TTS_2_ONLY && (msg.includes("resource ID is mismatched") || msg.includes("55000000"))) {
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
    throw new Error(
      "豆包 TTS 返回的数据不是有效的 Base64 音频。可能是代理或网络返回了错误页（如 HTML），请检查：1) 本页与开发服务是否同端口；2) /api/proxy 是否正常；3) 稍后重试。"
    );
  }
  let binaryString: string;
  try {
    binaryString = atob(cleanBase64);
  } catch {
    throw new Error(
      "豆包 TTS 返回的数据不是有效的 Base64 音频。可能是代理或网络返回了错误页（如 HTML），请检查：1) 本页与开发服务是否同端口；2) /api/proxy 是否正常；3) 稍后重试。"
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
