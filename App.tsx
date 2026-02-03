import React, { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import InputArea from './components/InputArea';
import ResultCard from './components/ResultCard';
import VideoMaker from './components/VideoMaker';
import { generateCreativePrompts, generateImageFromPrompt, getLastImageGenDebugInfo } from './services/geminiService';
import { checkProxyHealth, type ProxyHealthStatus } from './utils/proxyHealthCheck';
import { GeneratedItem } from './types';

const PRESET_IMAGE_URLS = [
  'https://picsum.photos/seed/p1/800/600',
  'https://picsum.photos/seed/p2/800/600',
  'https://picsum.photos/seed/p3/800/600',
  'https://picsum.photos/seed/p4/800/600',
];

const App: React.FC = () => {
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastInputText, setLastInputText] = useState('');
  const [currentRatio, setCurrentRatio] = useState('4:3');
  const [currentStyle, setCurrentStyle] = useState('Photorealistic');
  const [currentView, setCurrentView] = useState('Default');
  const [proxyHealth, setProxyHealth] = useState<ProxyHealthStatus | null>(null);
  const [showProxyWarning, setShowProxyWarning] = useState(true);

  // Check proxy health on mount
  useEffect(() => {
    checkProxyHealth().then(setProxyHealth);
  }, []);

  const loadPresetImages = useCallback(() => {
    const presetItems: GeneratedItem[] = PRESET_IMAGE_URLS.map((imageUrl, index) => ({
      id: (index + 1).toString(),
      prompt: `预设图 ${index + 1}`,
      imageUrl,
      loading: false,
    }));
    setItems(presetItems);
    setLastInputText(prev => (prev.trim() ? prev : '这是一段测试文案，用于验证语音合成与视频合成。'));
  }, []);

  const handleGenerate = useCallback(async (inputText: string, style: string, aspectRatio: string, count: number, viewDistance: string) => {
    setIsProcessing(true);
    setItems([]); // Clear previous results
    setLastInputText(inputText);
    setCurrentRatio(aspectRatio);
    setCurrentStyle(style);
    setCurrentView(viewDistance);

    try {
      // Step 1: Generate Prompts text first using Gemini 3 Flash with user specified count and view distance
      const prompts = await generateCreativePrompts(inputText, style, count, viewDistance);

      // Create initial item state with loading indicators
      const newItems: GeneratedItem[] = prompts.map((prompt, index) => ({
        id: (index + 1).toString(),
        prompt: prompt,
        loading: true,
      }));

      setItems(newItems);
      setIsProcessing(false); // Text gen done, images process in background

      // Step 2: Generate Images in parallel for each prompt
      prompts.forEach((prompt, index) => {
        triggerImageGeneration((index + 1).toString(), prompt, aspectRatio);
      });

    } catch (error) {
      console.error("Workflow failed", error);
      setIsProcessing(false);
      alert("抱歉，生成提示词时遇到问题，请检查网络或稍后重试。");
    }
  }, []);

  const triggerImageGeneration = async (id: string, prompt: string, aspectRatio: string) => {
    try {
      const imageUrl = await generateImageFromPrompt(prompt, aspectRatio);

      setItems(currentItems =>
        currentItems.map(item =>
          item.id === id
            ? { ...item, imageUrl: imageUrl, loading: false, error: undefined }
            : item
        )
      );
    } catch (error) {
      console.error(`Failed to generate image for id ${id}`, error);
      const message = error instanceof Error ? error.message : "Image generation failed";
      const detail = getLastImageGenDebugInfo() || (error instanceof Error ? error.stack : String(error));
      setItems(currentItems =>
        currentItems.map(item =>
          item.id === id
            ? { ...item, loading: false, error: message, errorDetail: detail }
            : item
        )
      );
    }
  };

  const handleImageLoadError = useCallback((id: string) => {
    setItems(currentItems =>
      currentItems.map(item => {
        if (item.id !== id) return item;
        const failedUrl = item.imageUrl;
        return {
          ...item,
          imageUrl: undefined,
          error: '图片加载失败，请点击重试',
          errorDetail: failedUrl ? `加载失败的图片 URL:\n${failedUrl}` : undefined,
          loading: false,
        };
      })
    );
  }, []);

  const handleRetryItem = useCallback((id: string) => {
    // Find the item to get its prompt
    const itemToRetry = items.find(item => item.id === id);
    if (!itemToRetry) return;

    // Reset state for this item to loading
    setItems(currentItems =>
      currentItems.map(item =>
        item.id === id
          ? { ...item, loading: true, error: undefined, errorDetail: undefined, imageUrl: undefined }
          : item
      )
    );

    // Trigger generation again
    triggerImageGeneration(id, itemToRetry.prompt, currentRatio);
  }, [items, currentRatio]);

  const allImagesReady = items.length > 0 && items.every(item => !item.loading && item.imageUrl);

  return (
    <div className="min-h-screen text-slate-200 selection:bg-[#d4af37] selection:text-black">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Header />

        {/* Proxy Health Warning Banner */}
        {proxyHealth && !proxyHealth.isHealthy && showProxyWarning && (
          <div className="mb-6 bg-red-900/20 border border-red-500/50 rounded-lg p-4 animate-fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-red-300 font-semibold">⚠️ 代理服务问题</h3>
                </div>
                <p className="text-sm text-red-200 mb-2">{proxyHealth.message}</p>
                {proxyHealth.suggestion && (
                  <pre className="text-xs text-red-100 bg-black/30 p-3 rounded border border-red-500/30 whitespace-pre-wrap font-mono">
                    {proxyHealth.suggestion}
                  </pre>
                )}
                <p className="text-xs text-red-300 mt-2">
                  💡 TTS语音合成和部分功能将无法使用，请先解决代理问题。
                </p>
              </div>
              <button
                onClick={() => setShowProxyWarning(false)}
                className="text-red-400 hover:text-red-300 transition-colors"
                title="关闭警告"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadPresetImages}
            disabled={isProcessing}
            className="text-sm text-slate-500 hover:text-[#d4af37] border border-[#333] hover:border-[#d4af37]/50 px-4 py-2 rounded transition-colors disabled:opacity-50"
            title="加载 4 张预设图，不调用作图接口，可直接测视频/语音合成"
          >
            使用预设 4 张图（不花钱测合成）
          </button>
          <span className="text-xs text-slate-600">若文案为空会填入测试句，可直接到下方「Video Production」开始合成。预设图不扣生图费；语音仍会调用豆包 TTS（同句已缓存，重复合成不重复扣费）</span>
        </div>

        <InputArea onGenerate={handleGenerate} isLoading={isProcessing} />

        {items.length > 0 && (
          <div className="mt-24 animate-fade-in-up">
            <div className="flex items-center justify-between mb-10 border-b border-[#222] pb-4">
              <h2 className="text-3xl font-serif italic text-white flex items-center gap-4">
                <span className="text-[#d4af37] text-4xl">/</span>
                The Collection
                <span className="text-xs font-sans not-italic text-slate-600 bg-[#111] px-2 py-1 border border-[#222] ml-2">
                  {items.length} ITEMS
                </span>
              </h2>
            </div>

            <div className={`grid gap-10 ${currentRatio === '9:16' || currentRatio === '3:4'
                ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}>
              {items.map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  aspectRatio={currentRatio}
                  onRetry={handleRetryItem}
                  onImageError={handleImageLoadError}
                />
              ))}
            </div>

            {/* Video Maker Section */}
            {allImagesReady && (
              <VideoMaker
                images={items}
                originalText={lastInputText}
                aspectRatio={currentRatio}
                style={currentStyle}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;