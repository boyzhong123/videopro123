import React, { useState, useCallback } from 'react';
import Header from './components/Header';
import InputArea from './components/InputArea';
import ResultCard from './components/ResultCard';
import VideoMaker from './components/VideoMaker';
import { generateCreativePrompts, generateImageFromPrompt } from './services/geminiService';
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
      setItems(currentItems => 
        currentItems.map(item => 
          item.id === id 
            ? { ...item, loading: false, error: "Image generation failed" }
            : item
        )
      );
    }
  };

  const handleRetryItem = useCallback((id: string) => {
    // Find the item to get its prompt
    const itemToRetry = items.find(item => item.id === id);
    if (!itemToRetry) return;

    // Reset state for this item to loading
    setItems(currentItems => 
      currentItems.map(item => 
        item.id === id 
          ? { ...item, loading: true, error: undefined, imageUrl: undefined }
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
          <span className="text-xs text-slate-600">若文案为空会填入测试句，可直接到下方「Video Production」开始合成</span>
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
            
            <div className={`grid gap-10 ${
              currentRatio === '9:16' || currentRatio === '3:4' 
                ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' 
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            }`}>
              {items.map((item) => (
                <ResultCard 
                  key={item.id} 
                  item={item} 
                  aspectRatio={currentRatio} 
                  onRetry={handleRetryItem}
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