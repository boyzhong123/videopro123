import { GoogleGenAI } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is missing. Calls will fail.");
    return new GoogleGenAI({ apiKey: "" });
  }
  return new GoogleGenAI({ apiKey: apiKey });
};

// SHARED API KEY for Doubao services
const DOUBAO_API_KEY = "34869c98-5ed6-4091-97bc-669de7b38ef1";

const USE_CORS_PROXY =
  typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_USE_CORS_PROXY === "true";
const CORS_PROXY_PREFIX =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_CORS_PROXY) || "https://corsproxy.io/?";

function getFallbackCorsProxy(): string | null {
  return USE_CORS_PROXY ? CORS_PROXY_PREFIX : null;
}

/** 优先同源 /api/proxy；可选启用 CORS 代理（VITE_USE_CORS_PROXY=true） */
function getProxyUrl(target: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/proxy?url=${encodeURIComponent(target)}`;
  }
  const fallback = getFallbackCorsProxy();
  return fallback ? fallback + encodeURIComponent(target) : target;
}

/**
 * Helper: Generate a fallback prompt locally if API fails.
 * Enhanced to provide richer, video-ready prompts.
 */
const generateFallbackPrompt = (
  userInput: string,
  style: string,
  viewDistance: string,
  variation: string
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
  return `(Masterpiece, top quality) ${viewDesc} of ${userInput}. ${eraNote} ${variation}. ${extraStyle}, dramatic lighting, trending on ArtStation, vivid details, sharp focus. ${noText}`;
};

/**
 * Helper: Generate a SINGLE prompt via API
 * Optimized for Video Keyframes: Richer detail, cinematic terms.
 */
const generateSinglePromptWithDoubao = async (
  userInput: string,
  style: string,
  viewDistance: string,
  variationInstruction: string,
  index: number
): Promise<string> => {
  const modelId = "doubao-seed-1-8-251228";
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  const endpoint = getProxyUrl(originalEndpoint + (originalEndpoint.includes("?") ? "&" : "?") + "_t=" + (Date.now() + index));

  const systemPrompt = `
    You are an expert Film Concept Artist.
    Task: Write ONE highly detailed, cinematic image generation prompt based on the user's input.
    
    The prompt will be used to generate a keyframe for a VIDEO. All keyframes must feel like the same story and world.
    AVOID simple or short descriptions.
    
    User Input: "${userInput}"
    Target Style: "${style}"
    Camera Distance: "${viewDistance}"
    Specific Focus: "${variationInstruction}"
    
    Requirements:
    1. Start with the main subject and action.
    2. Describe the environment and background in detail.
    3. Strictly enforce the "${style}" aesthetic (e.g., lighting, color palette, texture).
    4. Enforce the "${viewDistance}" composition (e.g., if Wide Shot, describe the vastness; if Close-up, describe details).
    5. Add quality boosters: "8k", "cinematic lighting", "masterpiece".
    6. ERA & TIME PERIOD CONSISTENCY (critical for video): If the scene involves buildings, architecture, or people, choose ONE time period/era and describe ONLY that era. No anachronism. Keep clothing, architecture, and props all from the same era.
    7. Decide whether to include people/characters based on the content: if the user's input is about nature, landscape, or knowledge (e.g. geography, science), describe only scenery/environment; if it involves story or characters, include them.
    8. CRITICAL: The image must contain NO text, no words, no letters, no writing, no captions, no subtitles, no signage with readable text. Describe only visual elements; never suggest any text or writing in the scene.
    9. Output ONLY the English prompt. No explanations. The prompt should be around 50-80 words.
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000); // Increased timeout slightly for longer generation

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate cinematic prompt." }
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 400 // Increased limit for detailed video prompts
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) throw new Error("Empty content");
    return content.trim();

  } catch (error) {
    console.warn(`Doubao Prompt (Idx ${index}) failed, using fallback.`);
    // Return null to signal fallback needed
    return ""; 
  }
};

/**
 * Generates multiple prompts. 
 * ROBUST STRATEGY: Try API -> If 504/Fail -> Use Local Fallback instantly.
 */
const generatePromptsParallel = async (
  userInput: string, 
  style: string, 
  count: number,
  viewDistance: string
): Promise<string[]> => {
  
  const variations = [
    { instruction: "Focus on dramatic lighting, atmosphere, and mood. Keep the same time period/era as the user's scene (no mixing primitive and modern).", suffix: "dramatic cinematic lighting, atmospheric, volumetric fog, moody, same era" },
    { instruction: "Focus on intricate textures, material details. Maintain era consistency: buildings and people must belong to one coherent time period.", suffix: "intricate details, highly textured, 8k resolution, coherent era, no anachronism" },
    { instruction: "Focus on dynamic composition, depth of field. Same world and era throughout—no cavemen with modern cities or vice versa.", suffix: "dynamic angle, depth of field, rule of thirds, consistent time period" },
    { instruction: "Focus on vibrant color theory, contrast. Keep clothing, architecture, and props from a single era.", suffix: "vibrant colors, high contrast, color graded, single era throughout" },
    { instruction: "Focus on environmental storytelling. Ensure architecture and people match the same historical or modern setting.", suffix: "detailed background, environmental storytelling, same era and world" },
    { instruction: "Focus on artistic interpretation and style. One consistent time period for the whole video.", suffix: "artistic interpretation, masterpiece, award winning, era consistent" },
  ];

  const promises = Array.from({ length: count }).map(async (_, i) => {
    const v = variations[i % variations.length];
    
    const apiResult = await generateSinglePromptWithDoubao(userInput, style, viewDistance, v.instruction, i);
    
    if (apiResult && apiResult.length > 20) {
      return apiResult;
    }
    
    return generateFallbackPrompt(userInput, style, viewDistance, v.suffix);
  });

  // Wait for all (since we handle errors inside map, Promise.all won't reject)
  return Promise.all(promises);
};

/**
 * Generates detailed image prompts.
 */
export const generateCreativePrompts = async (
  userInput: string, 
  style: string, 
  count: number = 4,
  viewDistance: string = 'Default'
): Promise<string[]> => {
  return await generatePromptsParallel(userInput, style, count, viewDistance);
};

/**
 * Generates an image using Doubao (Volcengine).
 */
export const generateImageFromPrompt = async (prompt: string, aspectRatio: string = "1:1"): Promise<string> => {
  const originalEndpoint = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

  let width = 1024;
  let height = 1024;
  switch (aspectRatio) {
    case '16:9': width = 1536; height = 864; break;
    case '4:3': width = 1280; height = 960; break;
    case '3:4': width = 960; height = 1280; break;
    case '9:16': width = 864; height = 1536; break;
    case '1:1': default: width = 1280; height = 1280; break;
  }

  const body = JSON.stringify({
    model: "doubao-seedream-4-5-251128",
    prompt: `${prompt.trim()} No text, no words, no letters, no writing, no captions in the image.`,
    width,
    height,
    response_format: "url",
    sequential_image_generation: "disabled",
    stream: false,
    watermark: false
  });
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${DOUBAO_API_KEY}`,
  };

  const tryFetch = async (endpoint: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(endpoint, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoints = [getProxyUrl(originalEndpoint)];
    const fallback = getFallbackCorsProxy();
    if (fallback) endpoints.push(fallback + encodeURIComponent(originalEndpoint));
    for (const endpoint of endpoints) {
      try {
        const response = await tryFetch(endpoint);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Doubao API: ${response.status} - ${errorText.slice(0, 200)}`);
        }
        const data = await response.json();
        if (data.data?.[0]?.url) {
          const originalUrl = data.data[0].url;
          return `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&output=png`;
        }
        throw new Error("No valid image URL returned");
      } catch (err) {
        console.warn("Image gen proxy attempt failed:", endpoint.slice(0, 50), err);
        continue;
      }
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("图片生成失败。若站点在境外，境内访问时请尝试开启网络代理后重试；或部署到境内服务器可无需代理。");
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