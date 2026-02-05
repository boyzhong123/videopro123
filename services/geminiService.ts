import { GoogleGenAI } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is missing. Calls will fail.");
    return new GoogleGenAI({ apiKey: "" });
  }
  return new GoogleGenAI({ apiKey: apiKey });
};

/** 豆包/火山 API Key（图像生成、对话），Vite 需在 .env 配置 VITE_DOUBAO_API_KEY */
function getDoubaoApiKey(): string {
  const env = typeof import.meta !== "undefined" ? (import.meta as any).env : {};
  return (env.VITE_DOUBAO_API_KEY || "").trim();
}

const USE_CORS_PROXY =
  typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_USE_CORS_PROXY === "true";
const CORS_PROXY_PREFIX =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CORS_PROXY) || "https://corsproxy.io/?";

// CRITICAL FIX: Explicitly check for string "null" which causes "nullhttps://..."
function getFallbackCorsProxy(): string | null {
  const proxy = USE_CORS_PROXY ? CORS_PROXY_PREFIX : null;
  if (!proxy || proxy === "null" || proxy === "undefined" || proxy === "false") {
    return null;
  }
  return proxy;
}

/** 优先同源 /api/proxy；origin 为 null/"null" 时用相对路径，避免拼出 nullhttps://... */
export function getProxyUrl(target: string): string {
  const origin = typeof window !== "undefined" ? window.location?.origin : "";
  const base = origin && origin !== "null" ? origin : "";
  if (base) return `${base}/api/proxy?url=${encodeURIComponent(target)}`;
  const fallback = getFallbackCorsProxy();
  if (fallback && fallback !== "null" && fallback !== "undefined") return fallback + encodeURIComponent(target);
  return `/api/proxy?url=${encodeURIComponent(target)}`;
}

/**
 * Helper: Generate a fallback prompt locally if API fails.
 * Enhanced to provide richer, video-ready prompts.
 */
const generateFallbackPrompt = (
  userInput: string,
  style: string,
  viewDistance: string,
  variation: string,
  sceneFocus?: string
): string => {
  const styleKeywords: Record<string, string> = {
    'Photorealistic': 'cinematic film still, hyper-realistic, 8k resolution, ray tracing, highly detailed texture, atmospheric lighting, Arri Alexa, bokeh',
    'Cyberpunk': 'futuristic neon city, cybernetic details, high tech, night time, volumetric fog, blade runner style, vibrant neon colors',
    'Anime': 'Makoto Shinkai style, Studio Ghibli, high quality anime art, vibrant colors, detailed background, beautiful composition, 4k',
    'Watercolor': 'masterpiece watercolor painting, soft bleeding edges, artistic paper texture, dreamy atmosphere, elegant brushwork',
    'Oil Painting': 'classic oil painting on canvas, impasto brush strokes, rich colors, texture, impressionist masterpiece, dramatic lighting',
    '3D Render': 'Unreal Engine 5 render, Octane render, C4D, hyper detailed, subsurface scattering, global illumination, 3D masterpiece',
    'Pixel Art': 'high quality pixel art, 16-bit, detailed sprites, retro aesthetic, vibrant palette, game asset style',
    'Minimalist': 'clean minimalist design, flat colors, simple geometric shapes, vector art, high contrast, elegant composition'
  };

  const viewKeywords: Record<string, string> = {
    'Close-up': 'extreme close-up shot, macro details, focus on facial features and texture, shallow depth of field',
    'Wide Shot': 'wide angle establishing shot, epic scale, detailed environment, vast landscape, cinematic composition',
    'Default': 'cinematic medium shot, perfectly framed, balanced composition, movie keyframe'
  };

  const extraStyle = styleKeywords[style] || 'highly detailed, cinematic quality, masterpiece, 8k';
  const viewDesc = viewKeywords[viewDistance] || 'cinematic shot';
  const eraNote = 'consistent time period and era, no anachronism, same world and story.';
  const noText = 'no text, no words, no letters, no writing, no captions in the image.';
  const subject = (sceneFocus && sceneFocus.trim()) ? sceneFocus.trim() : userInput;
  return `(Masterpiece, top quality) ${viewDesc} of ${subject}. ${eraNote} ${variation}. ${extraStyle}, dramatic lighting, trending on ArtStation, vivid details, sharp focus. ${noText}`;
};

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * 将用户的一段话切分为 N 个场景描述，用于视频分镜（每句/每段对应一张图）。
 * 优先调用豆包 API；失败时用本地按句切分。
 */
const splitParagraphIntoScenes = async (paragraph: string, count: number, reasoningEffort: ReasoningEffort = 'minimal'): Promise<string[]> => {
  const trimmed = paragraph.trim();
  if (count <= 0) return [];
  if (count === 1) return [trimmed];

  const modelId = "doubao-seed-1-8-251228";
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  const endpoint = getProxyUrl(originalEndpoint + "?_t=" + Date.now());

  const systemPrompt = `You are a video storyboard assistant. Split the user's paragraph into exactly ${count} scene descriptions for keyframes, in order. Each scene = one image for the video.
Output format: exactly ${count} lines. One scene per line. No numbering, no bullets, no extra explanation. Each line should be a short scene description (can be in Chinese or English).`;

  const userMessage = `Split this into exactly ${count} scenes (one per line):\n\n${trimmed}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getDoubaoApiKey()}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 800,
        reasoning_effort: reasoningEffort,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const rawText = await response.text();
    const data = JSON.parse(rawText);
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") throw new Error("Empty response");

    const lines = content
      .split(/\n+/)
      .map((s: string) => s.replace(/^\s*[\d\.\-\*]+\s*/, "").trim())
      .filter((s: string) => s.length > 0);

    if (lines.length >= count) {
      return lines.slice(0, count);
    }
    if (lines.length > 0) {
      while (lines.length < count) lines.push(lines[lines.length - 1]);
      return lines.slice(0, count);
    }
  } catch (e) {
    console.warn("splitParagraphIntoScenes API failed, using local split:", e);
  }

  // 本地回退：按句号、问号、感叹号、换行切分，再取前 N 段或均匀分配
  const sentences = trimmed
    .split(/[。！？.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (sentences.length === 0) return Array(count).fill(trimmed);

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i * sentences.length) / count);
    result.push(sentences[Math.min(idx, sentences.length - 1)] || trimmed);
  }
  return result;
};

/**
 * Helper: Generate a SINGLE prompt via API
 * Optimized for Video Keyframes: Richer detail, cinematic terms.
 * sceneFocus = 本张图对应的那一段话/那一句，只描述该场景。
 */
const generateSinglePromptWithDoubao = async (
  userInput: string,
  style: string,
  viewDistance: string,
  sceneFocus: string,
  index: number,
  totalCount: number,
  reasoningEffort: ReasoningEffort = 'minimal'
): Promise<string> => {
  const modelId = "doubao-seed-1-8-251228";
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  const endpoint = getProxyUrl(originalEndpoint + (originalEndpoint.includes("?") ? "&" : "?") + "_t=" + (Date.now() + index));

  const sceneHint = totalCount > 1
    ? `\n    This is keyframe ${index + 1} of ${totalCount}. The image must depict ONLY this part of the story: "${sceneFocus}". Same world and style as the full story, but this frame's content is strictly this scene.`
    : "";

  const systemPrompt = `
    You are an expert Film Concept Artist.
    Task: Write ONE highly detailed, cinematic image generation prompt for a VIDEO keyframe.
    
    The full story/paragraph context: "${userInput}"
    This keyframe must show ONLY this scene (one part of the story): "${sceneFocus}"
    All keyframes together form one video, so keep the same world and style. AVOID simple or short descriptions.${sceneHint}
    
    Target Style: "${style}"
    Camera Distance: "${viewDistance}"
    
    Requirements:
    1. BE FAITHFUL to the source: describe exactly what the text says, no unrelated additions.
    2. Start with the main subject and action, then environment and background.
    3. Strictly enforce the "${style}" aesthetic and "${viewDistance}" composition.
    4. Add quality boosters: "8k", "cinematic lighting", "masterpiece".
    6. ERA & TIME PERIOD CONSISTENCY (critical for video): If the scene involves buildings, architecture, or people, choose ONE time period/era and describe ONLY that era. No anachronism. Keep clothing, architecture, and props all from the same era.
    7. NON-NARRATIVE = NO PEOPLE: If the text is informational, explanatory, or non-story (science, geography, nature, concepts), describe ONLY scenery/environment/objects—no people. Only include people when the text is narrative with characters or historical figures.
    8. CRITICAL: The image must contain NO text, no words, no letters, no writing, no captions, no subtitles, no signage with readable text. Describe only visual elements; never suggest any text or writing in the scene.
    9. Output ONLY the English prompt. No explanations. The prompt should be around 50-80 words.
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getDoubaoApiKey()}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate cinematic prompt." }
        ],
        stream: false,
        temperature: 0.45,
        max_tokens: 400,
        reasoning_effort: reasoningEffort,
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    const rawText = await response.text();
    let content: string | undefined;

    try {
      const data = JSON.parse(rawText);
      content = data.choices?.[0]?.message?.content;
    } catch {
      // 接口有时返回截断的 JSON（Unterminated string），尝试从原文中抽取 content
      const match = rawText.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (match) {
        content = match[1].replace(/\\(.)/g, "$1");
      }
    }

    if (!content || content.length < 20) throw new Error("Empty or invalid content");
    return content.trim();

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Doubao Prompt (Idx ${index}) failed (${msg}), using fallback.`);
    return ""; // 空字符串会触发 fallback
  }
};

/** 本地按句切分，用于 sceneText 展示（无需 API） */
const localSplitScenes = (paragraph: string, count: number): string[] => {
  const trimmed = paragraph.trim();
  if (count <= 0) return [];
  if (count === 1) return [trimmed];
  const sentences = trimmed
    .split(/[。！？.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return Array(count).fill(trimmed);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i * sentences.length) / count);
    result.push(sentences[Math.min(idx, sentences.length - 1)] || trimmed);
  }
  return result;
};

/**
 * 一次 API 调用，直接返回 N 条图片 prompt。
 * 输出格式：N 行，每行一条英文 prompt，减少 token 提升速度。
 */
const generatePromptsInOneCall = async (
  userInput: string,
  style: string,
  count: number,
  viewDistance: string,
  reasoningEffort: ReasoningEffort = 'minimal'
): Promise<{ prompt: string; sceneText: string }[]> => {
  const modelId = "doubao-seed-1-8-251228";
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  const endpoint = getProxyUrl(originalEndpoint + "?_t=" + Date.now());

  const systemPrompt = `You are a Film Concept Artist. Output exactly ${count} English image prompts for a video, one per line.

CRITICAL - COVER ALL EXAMPLES: If the text mentions multiple distinct people or examples (e.g., Lincoln AND Helen Keller), you MUST depict each in at least one keyframe. Do NOT omit any named person or major example. Distribute keyframes across the full narrative.

CRITICAL - NON-NARRATIVE = NO PEOPLE: If the text is informational, explanatory, or non-story (e.g., science, geography, nature, concepts, how-things-work), describe ONLY scenery, environment, objects, or abstract visuals. Do NOT include any people, characters, or human figures.

Rules: Faithful to the source. Style: "${style}". Camera: "${viewDistance}". Add "8k, cinematic lighting, masterpiece". No text in images. Same world/era where relevant. Each prompt 50-80 words.
Output: exactly ${count} lines, one prompt per line, no numbering.`;

  const userMessage = `Generate ${count} keyframe prompts for:\n\n${userInput.trim()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getDoubaoApiKey()}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
        temperature: 0.45,
        max_tokens: 1200,
        reasoning_effort: reasoningEffort,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const rawText = await response.text();
    const data = JSON.parse(rawText);
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") throw new Error("Empty response");

    const lines = content
      .split(/\n+/)
      .map((s: string) => s.replace(/^\s*[\d\.\-\*]+\s*/, "").trim())
      .filter((s: string) => s.length > 20);

    const sceneTexts = localSplitScenes(userInput, count);
    const results: { prompt: string; sceneText: string }[] = [];
    for (let i = 0; i < count; i++) {
      const prompt = lines[i]?.trim() || "";
      if (prompt.length > 20) {
        results.push({ prompt, sceneText: sceneTexts[i] ?? "" });
      }
    }

    if (results.length >= count) return results.slice(0, count);
    if (results.length > 0) {
      const last = results[results.length - 1];
      while (results.length < count) results.push({ ...last });
      return results.slice(0, count);
    }
  } catch (e) {
    console.warn("generatePromptsInOneCall failed, fallback to parallel:", e);
  }

  return [];
};

/**
 * 回退：按场景切分 + 并行生成 prompt（原逻辑），返回带 sceneText 的结果。
 */
const generatePromptsParallel = async (
  userInput: string,
  style: string,
  count: number,
  viewDistance: string,
  reasoningEffort: ReasoningEffort = 'minimal'
): Promise<{ prompt: string; sceneText: string }[]> => {
  const scenes = await splitParagraphIntoScenes(userInput, count, reasoningEffort);
  const fallbackSuffixes = [
    "dramatic cinematic lighting, same era",
    "intricate details, 8k resolution, coherent era",
    "dynamic angle, depth of field, same era",
    "vibrant colors, color graded, single era",
    "detailed background, environmental storytelling, same era",
    "artistic interpretation, masterpiece, era consistent",
  ];

  const promises = Array.from({ length: count }).map(async (_, i) => {
    const sceneFocus = scenes[i] ?? userInput;
    let prompt: string;

    try {
      const apiResult = await generateSinglePromptWithDoubao(userInput, style, viewDistance, sceneFocus, i, count, reasoningEffort);
      if (apiResult && apiResult.length > 20) {
        prompt = apiResult;
      } else {
        prompt = generateFallbackPrompt(userInput, style, viewDistance, fallbackSuffixes[i % fallbackSuffixes.length], sceneFocus);
      }
    } catch (err) {
      console.warn(`Prompt ${i} API call error:`, err);
      prompt = generateFallbackPrompt(userInput, style, viewDistance, fallbackSuffixes[i % fallbackSuffixes.length], sceneFocus);
    }

    return { prompt, sceneText: sceneFocus };
  });

  return Promise.all(promises);
};

/**
 * Generates detailed image prompts. 优先一次调用（更快），失败时回退到并行。
 */
export const generateCreativePrompts = async (
  userInput: string,
  style: string,
  count: number = 4,
  viewDistance: string = 'Default',
  reasoningEffort: ReasoningEffort = 'minimal'
): Promise<{ prompt: string; sceneText: string }[]> => {
  const oneCall = await generatePromptsInOneCall(userInput, style, count, viewDistance, reasoningEffort);
  if (oneCall.length >= count) return oneCall;
  return generatePromptsParallel(userInput, style, count, viewDistance, reasoningEffort);
};

let lastImageGenDebugSnippet = "";
/** 图片生成失败时最近一次接口响应/错误片段，便于复制排查 */
export function getLastImageGenDebugInfo(): string {
  return lastImageGenDebugSnippet;
}

/** Volces/TOS 签名图 URL 是否完整（截断的 URL 会导致图片加载失败，如末尾 x-tos-process=image_YX） */
function isVolcesImageUrlComplete(url: string): boolean {
  if (!url || !url.startsWith("http")) {
    console.warn(`[URL Check] Invalid URL format: ${url?.slice(0, 50)}`);
    return false;
  }
  
  // 非 Volces/TOS URL 直接通过
  if (!/volces\.com|tos-cn-beijing/i.test(url)) {
    console.log(`[URL Check] Non-Volces URL, accepted: ${url.slice(0, 80)}`);
    return true;
  }
  
  // 必须有完整签名：X-Tos-Signature=<64位十六进制>
  const signatureMatch = url.match(/X-Tos-Signature=([0-9a-f]+)/i);
  if (!signatureMatch) {
    console.warn(`[URL Check] Missing X-Tos-Signature in Volces URL`);
    return false;
  }
  if (signatureMatch[1].length !== 64) {
    console.warn(`[URL Check] Incomplete signature: ${signatureMatch[1].length}/64 chars`);
    return false;
  }
  
  // 检查 URL 是否突然截断（不以正常字符结尾）
  const lastChar = url.slice(-1);
  const validEndings = /[a-zA-Z0-9=\-_]/;
  if (!validEndings.test(lastChar)) {
    console.warn(`[URL Check] URL ends with suspicious char: '${lastChar}'`);
    return false;
  }
  
  // 若含 x-tos-process=，末尾参数值需足够长（完整为 image/watermark,image_<base64>，截断常为 image_YX）
  const processMatch = url.match(/x-tos-process=([^&]*)$/i);
  if (processMatch) {
    try {
      const value = decodeURIComponent(processMatch[1] || "");
      if (value.length < 40) {
        console.warn(`[URL Check] x-tos-process value too short: ${value.length} chars (${value.slice(0, 30)})`);
        return false;
      }
    } catch (e) {
      console.warn(`[URL Check] Failed to decode x-tos-process: ${processMatch[1]?.slice(0, 30)}`);
      return false;
    }
  }
  
  console.log(`[URL Check] ✓ Complete Volces URL validated (${url.length} chars)`);
  return true;
}

/**
 * 图片生成：豆包 Seedream（OpenAI 兼容接口）
 * base_url: https://ark.cn-beijing.volces.com/api/v3
 * 官方案例：client.images.generate(model="doubao-seedream-4-5-251128", prompt=..., size="2K", response_format="url", extra_body={"watermark": True})
 */
/** imageIndex: 多图时传入 0-based 序号，用于不同 seed 提升画面差异度 */
export const generateImageFromPrompt = async (
  prompt: string,
  aspectRatio: string = "1:1",
  imageIndex?: number
): Promise<string> => {
  lastImageGenDebugSnippet = "";
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

  const apiKey = getDoubaoApiKey();
  if (!apiKey) {
    lastImageGenDebugSnippet = "未配置 VITE_DOUBAO_API_KEY";
    throw new Error(
      "未配置图像生成 Key。请在 .env 中设置 VITE_DOUBAO_API_KEY（火山方舟控制台获取，需开通 Seedream 图像生成），保存后重启 dev。"
    );
  }

  // 与官方 OpenAI 兼容接口一致：size "2K"，response_format "url"，watermark 可选
  const sizeMap: Record<string, string> = {
    "1:1": "2K",
    "16:9": "2K",
    "4:3": "2K",
    "3:4": "2K",
    "9:16": "2K",
  };
  const size = sizeMap[aspectRatio] ?? "2K";

  // 多图时每张用不同 seed，降低相似度；单张或不传时用 -1 随机
  const seed = imageIndex !== undefined ? 10000 + imageIndex : -1;

  const body = JSON.stringify({
    model: "doubao-seedream-4-5-251128",
    prompt: `${prompt.trim()} No text, no words, no letters, no writing, no captions in the image.`,
    size,
    response_format: "url",
    watermark: false,
    seed,
  });
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  const tryFetch = async (endpoint: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(endpoint, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  };

  let lastErr: string = "";
  let isAuthError = false;
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoints = [getProxyUrl(originalEndpoint)];
    const fallback = getFallbackCorsProxy();
    if (fallback) endpoints.push(fallback + encodeURIComponent(originalEndpoint));
    
    if (attempt > 0) {
      // 指数退避：第1次重试等3秒，第2次重试等6秒
      const delay = 3000 * attempt;
      console.log(`[Image Gen] Retry ${attempt}/3 after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[Image Gen] Attempt ${attempt + 1}/3, endpoint: ${endpoint.slice(0, 60)}...`);
        const response = await tryFetch(endpoint);
        
        // Use arrayBuffer + TextDecoder for more reliable reading
        const buffer = await response.arrayBuffer();
        const responseText = new TextDecoder('utf-8').decode(buffer);
        
        console.log(`[Image Gen] Response: ${response.status}, length: ${responseText.length} chars (${buffer.byteLength} bytes)`);
        
        if (!response.ok) {
          lastErr = `HTTP ${response.status}: ${responseText.slice(0, 300)}`;
          lastImageGenDebugSnippet = `[Image ${response.status}]\n${responseText.slice(0, 800)}`;
          
          // 检查是否是认证错误（不值得重试）
          if (response.status === 401 || response.status === 403) {
            isAuthError = true;
            throw new Error(lastErr);
          }
          
          // 检查是否是配额/限流错误
          if (response.status === 429 || responseText.includes("quota") || responseText.includes("rate limit")) {
            lastErr += " (API 配额不足或限流)";
            throw new Error(lastErr);
          }
          
          throw new Error(lastErr);
        }
        let data: { data?: Array<{ url?: string }>; error?: { message?: string } } | null = null;
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          // 响应可能被截断或含特殊字符，尝试从正文中提取 data[0].url
          console.warn(`JSON parse failed (${responseText.length} chars), attempting URL extraction:`, parseErr);
          
          // 尝试多种方式提取 URL
          let extractedUrl: string | undefined;
          
          // 方法1: 正则匹配 "url": "https://..."
          const match1 = responseText.match(/"url"\s*:\s*"(https?:\/\/[^"\\]+(?:\\.[^"\\]*)*)"/);
          if (match1) {
            extractedUrl = match1[1].replace(/\\(.)/g, "$1"); // 处理转义字符
          }
          
          // 方法2: 查找 Volces/TOS URL（包含签名）
          if (!extractedUrl) {
            const volcesMatch = responseText.match(/(https?:\/\/[^"\s]+?(?:volces\.com|tos-cn-beijing)[^"\s]*X-Tos-Signature=[0-9a-f]{64}[^"\s]*)/i);
            if (volcesMatch) {
              extractedUrl = volcesMatch[1].split('"')[0].split('\\')[0];
            }
          }
          
          // 方法3: 通用 HTTPS URL 提取
          if (!extractedUrl && responseText.includes("https://")) {
            const urlStart = responseText.indexOf("https://");
            const after = responseText.slice(urlStart);
            const end = after.search(/["'\s\\]/);
            extractedUrl = end !== -1 ? after.slice(0, end) : after.trim();
          }
          
          console.log(`Extracted URL candidate: ${extractedUrl?.slice(0, 100)}...`);
          
          if (extractedUrl && isVolcesImageUrlComplete(extractedUrl)) {
            console.log(`✓ Successfully extracted complete URL from truncated JSON`);
            return extractedUrl;
          }
          
          lastErr = `接口返回了被截断的 JSON（收到 ${responseText.length} 字符）。${extractedUrl ? '提取到的 URL 不完整。' : '未能提取到有效 URL。'}可能原因：网络不稳定、代理服务问题、或火山引擎 API 响应异常。`;
          lastImageGenDebugSnippet = `响应长度: ${responseText.length} 字符\n提取的URL: ${extractedUrl?.slice(0, 200) || '无'}\n\n响应前 800 字符:\n${responseText.slice(0, 800)}\n\n响应后 200 字符:\n${responseText.slice(-200)}`;
          throw new Error(lastErr);
        }
        if (data?.data?.[0]?.url) {
          const originalUrl = data.data[0].url;
          if (!isVolcesImageUrlComplete(originalUrl)) {
            lastErr = "接口返回的图片 URL 不完整（可能被截断）";
            lastImageGenDebugSnippet = originalUrl?.slice(0, 500) ?? "";
            throw new Error(lastErr);
          }
          // 直接返回 Volces 签名链接，避免 /api/proxy 被广告拦截器拦截（ERR_BLOCKED_BY_CLIENT）
          return originalUrl;
        }
        const apiMsg = data?.error?.message ?? (data as any)?.message ?? "";
        lastErr = apiMsg ? `接口返回无图片: ${apiMsg}` : "接口返回无 data[0].url";
        lastImageGenDebugSnippet = responseText.slice(0, 800);
        throw new Error(lastErr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!lastErr) lastErr = msg;
        console.warn(`[Image Gen] Attempt failed on ${endpoint.slice(0, 50)}:`, msg);
        
        // 如果是认证错误，不要继续尝试其他 endpoint
        if (isAuthError) break;
        continue;
      }
    }
    
    // 如果是认证错误，不要重试
    if (isAuthError) break;
  }
  
  // 构建详细的错误提示
  let hint = "请检查：\n";
  if (isAuthError) {
    hint += "❌ API Key 无效或未授权。请确认：\n";
    hint += "1) .env 中的 VITE_DOUBAO_API_KEY 正确（从火山引擎控制台获取）\n";
    hint += "2) 该 Key 已在火山引擎控制台开通「图像生成」/ Seedream 模型权限\n";
    hint += "3) Key 未过期且有足够配额";
  } else if (lastErr.includes("配额") || lastErr.includes("quota") || lastErr.includes("rate limit")) {
    hint += "⚠️ API 配额不足或触发限流。请检查：\n";
    hint += "1) 火山引擎控制台余额是否充足\n";
    hint += "2) 是否触发了每日/每分钟调用限制\n";
    hint += "3) 稍后再试";
  } else if (lastErr.includes("截断")) {
    hint += "⚠️ 响应数据被截断（可能原因）：\n";
    hint += "1) 网络不稳定导致传输中断（请检查网络连接）\n";
    hint += "2) 代理服务器配置问题（如使用 corsproxy.io 可能不稳定）\n";
    hint += "3) 本地开发服务器超时（重启 npm run dev）\n";
    hint += "4) 火山引擎 API 响应异常（稍后重试）\n";
    hint += "\n💡 建议：使用 npm start 自建代理服务器，或部署到 Vercel";
  } else {
    hint += "1) 本页与开发服务同源（如 localhost:3000），/api/proxy 可用\n";
    hint += "2) 火山引擎控制台该 Key 已开通「图像生成」/ Seedream 模型\n";
    hint += "3) 境内访问境外站点时需代理或部署到境内\n";
    hint += "4) 检查控制台（F12）是否有网络错误";
  }
  
  lastImageGenDebugSnippet = lastErr ? `最后错误: ${lastErr}\n\n调试信息:\n${lastImageGenDebugSnippet}` : "";
  throw new Error(`图片生成失败。\n\n${hint}${lastErr ? "\n\n最后错误: " + lastErr : ""}`);
};

export { generateSpeechDoubao } from './doubaoTtsService';
import type { DoubaoEmotionOptions } from './doubaoTtsService';

/**
 * 语音合成入口：仅使用豆包 TTS，返回 24kHz PCM Int16 ArrayBuffer。
 * 可选 options.emotion / options.emotionScale 调节朗读情感（2.0 通用场景音色支持）。
 */
export const generateSpeech = async (
  text: string,
  speaker: string,
  options?: DoubaoEmotionOptions
): Promise<ArrayBuffer> => {
  const { generateSpeechDoubao } = await import('./doubaoTtsService');
  return generateSpeechDoubao(text, speaker, options);
};