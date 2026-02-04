import React, { useState } from 'react';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

interface InputAreaProps {
  onGenerate: (text: string, style: string, aspectRatio: string, count: number, viewDistance: string, reasoningEffort: ReasoningEffort) => void;
  isLoading: boolean;
}

const REASONING_OPTIONS: { id: ReasoningEffort; label: string; desc: string }[] = [
  { id: 'minimal', label: '不思考', desc: '最快' },
  { id: 'low', label: 'Low', desc: '轻量' },
  { id: 'medium', label: 'Medium', desc: '平衡' },
  { id: 'high', label: 'High', desc: '深度' },
];

const STYLES = [
  { id: 'Photorealistic', label: '写实摄影', desc: 'Cinematic Lighting' },
  { id: 'Cyberpunk', label: '赛博朋克', desc: 'Neon & Future' },
  { id: 'Anime', label: '日系动漫', desc: 'Studio Ghibli' },
  { id: 'Watercolor', label: '水彩画', desc: 'Soft & Artistic' },
  { id: 'Oil Painting', label: '经典油画', desc: 'Impressionism' },
  { id: '3D Render', label: '3D 渲染', desc: 'Octane Render' },
  { id: 'Pixel Art', label: '像素艺术', desc: '8-bit Retro' },
  { id: 'Minimalist', label: '极简主义', desc: 'Less is More' },
];

const RATIOS = [
  { id: '1:1', label: '1:1 Square' },
  { id: '16:9', label: '16:9 Cinema' },
  { id: '4:3', label: '4:3 Classic' },
  { id: '3:4', label: '3:4 Portrait' },
  { id: '9:16', label: '9:16 Mobile' },
];

const VIEW_DISTANCES = [
  { id: 'Default', label: 'Default / 默认' },
  { id: 'Close-up', label: 'Close-up / 近景' },
  { id: 'Wide Shot', label: 'Wide Shot / 远景' },
];

const InputArea: React.FC<InputAreaProps> = ({ onGenerate, isLoading }) => {
  const [inputText, setInputText] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0].id);
  const [selectedRatio, setSelectedRatio] = useState('4:3');
  const [imageCount, setImageCount] = useState(4);
  const [selectedView, setSelectedView] = useState('Default');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('minimal');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && !isLoading) {
      onGenerate(inputText.trim(), selectedStyle, selectedRatio, imageCount, selectedView, reasoningEffort);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto bg-[#0a0a0a] border border-[#222] p-8 md:p-10 rounded-sm shadow-2xl mb-16 relative">
      {/* Accent corner */}
      <div className="absolute top-0 left-0 w-20 h-20 border-t border-l border-slate-500/40 rounded-tl-lg pointer-events-none"></div>
      <div className="absolute bottom-0 right-0 w-20 h-20 border-b border-r border-slate-500/40 rounded-br-lg pointer-events-none"></div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-10">
        
        {/* Text Input */}
        <div className="flex flex-col gap-4">
          <label htmlFor="prompt-input" className="font-serif text-xl italic text-slate-400">
            1. The Vision <span className="text-xs not-italic text-slate-500 ml-2 tracking-wide uppercase">/ 一段话，按句生成不同场景</span>
          </label>
          <div className="relative group">
            <textarea
              id="prompt-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="e.g., Spring has arrived. Birds sing in the trees. Children play on the grass. The sunset paints the clouds golden. (Each sentence or scene generates a keyframe.)"
              className="w-full p-6 text-slate-300 bg-[#111] border border-[#333] focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/50 rounded-sm focus:outline-none transition-all resize-none h-36 placeholder-slate-600 font-light leading-relaxed"
              disabled={isLoading}
            />
            <div className="absolute bottom-4 right-4 text-xs font-mono text-slate-500">
              {inputText.length} CHARS
            </div>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-col lg:flex-row gap-10 border-t border-[#222] pt-8">
          {/* Style Selector */}
          <div className="flex-1 flex flex-col gap-4">
            <label className="font-serif text-xl italic text-slate-400">
               2. Art Style <span className="text-xs not-italic text-slate-500 ml-2 tracking-wide uppercase">/ 艺术风格</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setSelectedStyle(style.id)}
                  disabled={isLoading}
                  className={`flex flex-col items-start px-4 py-3 border transition-all text-left group relative
                    ${selectedStyle === style.id 
                      ? 'bg-[#1a1a1a] border-[#d4af37]/90 text-[#d4af37]/95' 
                      : 'bg-[#121212] border-[#2a2a2a] text-slate-300 hover:border-slate-500 hover:bg-[#161616] hover:text-slate-400'
                    }
                  `}
                >
                  <span className="font-serif text-sm tracking-wide z-10">
                    {style.label}
                  </span>
                  <span className={`text-[10px] mt-1 uppercase tracking-widest font-sans z-10 ${selectedStyle === style.id ? 'text-[#d4af37]/85' : 'text-slate-500'}`}>
                    {style.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Right Column: Ratio, View & Quantity */}
          <div className="w-full lg:w-64 flex flex-col gap-8">
            {/* Aspect Ratio */}
            <div className="flex flex-col gap-4">
              <label className="font-serif text-xl italic text-slate-400">
                3. Canvas <span className="text-xs not-italic text-slate-500 ml-2 tracking-wide uppercase">/ 画布</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {RATIOS.map((ratio) => (
                  <button
                    key={ratio.id}
                    type="button"
                    onClick={() => setSelectedRatio(ratio.id)}
                    disabled={isLoading}
                    className={`px-4 py-2 border transition-all text-left text-xs uppercase tracking-widest
                      ${selectedRatio === ratio.id 
                        ? 'bg-[#151515] border-[#d4af37] text-[#d4af37]/95' 
                        : 'bg-[#121212] border-[#2a2a2a] text-slate-300 hover:border-slate-500 hover:bg-[#161616] hover:text-slate-400'
                      }
                    `}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            {/* View Distance Selection */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-500 uppercase tracking-widest">Composition / 景别</label>
              <div className="flex flex-col gap-2">
                 {VIEW_DISTANCES.map((view) => (
                    <button
                        key={view.id}
                        type="button"
                        onClick={() => setSelectedView(view.id)}
                        disabled={isLoading}
                        className={`px-3 py-2 border text-xs text-left uppercase tracking-widest transition-all
                            ${selectedView === view.id
                             ? 'bg-[#151515] border-[#d4af37] text-[#d4af37]/95'
                             : 'bg-[#121212] border-[#2a2a2a] text-slate-300 hover:border-slate-500 hover:bg-[#161616] hover:text-slate-400'
                            }
                        `}
                    >
                        {view.label}
                    </button>
                 ))}
              </div>
            </div>

            {/* Reasoning Effort / 思考程度 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-500 uppercase tracking-widest">Reasoning / 思考程度</label>
              <div className="grid grid-cols-2 gap-2">
                {REASONING_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setReasoningEffort(opt.id)}
                    disabled={isLoading}
                    className={`px-3 py-2 border text-xs text-left uppercase tracking-widest transition-all
                      ${reasoningEffort === opt.id
                        ? 'bg-[#151515] border-[#d4af37] text-[#d4af37]/95'
                        : 'bg-[#121212] border-[#2a2a2a] text-slate-300 hover:border-slate-500 hover:bg-[#161616] hover:text-slate-400'
                      }`}
                    title={opt.desc}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity Slider: 1–10 张，对应一段话的 N 个场景 */}
            <div className="flex flex-col gap-4">
               <label className="font-serif text-xl italic text-slate-400 flex justify-between items-end">
                 4. 场景数量 <span className="text-xs not-italic text-[#d4af37]/90 tracking-widest font-mono text-lg">{imageCount} 张</span>
               </label>
               <input 
                 type="range" 
                 min="1" 
                 max="10" 
                 step="1"
                 value={imageCount}
                 onChange={(e) => setImageCount(parseInt(e.target.value))}
                 disabled={isLoading}
                 className="w-full h-1 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#d4af37]"
               />
               {/* 1–10 刻度小节点，与滑块 thumb 位置一一对应 */}
               <div className="flex justify-between items-end px-[3px] mt-2">
                 {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                   <span key={n} className={`flex flex-col items-center gap-1 min-w-0 flex-1 ${imageCount === n ? 'text-[#d4af37]' : 'text-slate-300'}`}>
                     <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${imageCount === n ? 'bg-[#d4af37]/90' : 'bg-slate-500/70'}`} />
                     <span className="text-[9px] font-mono">{n}</span>
                   </span>
                 ))}
               </div>
            </div>
          </div>
        </div>

        {/* Submit Button with Animation */}
        <button
          type="submit"
          disabled={!inputText.trim() || isLoading}
          className={`w-full py-4 px-6 border border-transparent font-serif italic text-xl tracking-wider transition-all duration-150 transform mt-4 relative overflow-hidden group active:scale-[0.98] active:shadow-inner
            ${isLoading || !inputText.trim() 
              ? 'bg-[#1e1e1e] text-slate-500 cursor-not-allowed border-[#2a2a2a]' 
              : 'bg-[#e8e6e3] text-slate-800 hover:bg-[#d4af37] hover:text-slate-900 hover:border-[#d4af37] hover:shadow-[0_0_25px_rgba(212,175,55,0.4)]'
            }`}
        >
          {/* Ripple Effect Container */}
          <div className="absolute inset-0 bg-slate-400/20 scale-0 group-active:scale-100 transition-transform duration-300 rounded-full origin-center pointer-events-none"></div>
          
          <span className="relative z-10 flex items-center justify-center gap-3">
            {isLoading ? (
                <>
                  <span className="w-5 h-5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></span>
                  Curating Collection...
                </>
            ) : 'Create Masterpieces'}
          </span>
        </button>
      </form>
    </div>
  );
};

export default InputArea;