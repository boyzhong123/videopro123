import React from 'react';
import { GeneratedItem } from '../types';

interface ResultCardProps {
  item: GeneratedItem;
  aspectRatio: string;
  onRetry: (id: string) => void;
  onImageError?: (id: string) => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ item, aspectRatio, onRetry, onImageError }) => {
  const errorDetail = item.errorDetail;
  const copyableError = [item.error, errorDetail].filter(Boolean).join('\n\n');
  // Use CSS aspectRatio property (e.g., "16/9")
  const ratioStyle = aspectRatio.replace(':', '/');

  return (
    <div className="bg-[#0f0f0f] border border-[#222] flex flex-col h-full transition-all hover:border-[#444] group relative">
      
      {/* Image Frame */}
      <div className="p-3 pb-0">
          <div 
            className="w-full bg-[#050505] relative flex items-center justify-center overflow-hidden border border-[#222]"
            style={{ aspectRatio: ratioStyle }}
          >
            {item.imageUrl ? (
              <>
                <img 
                  src={item.imageUrl} 
                  alt="Generated result" 
                  className="w-full h-full object-cover animate-fade-in transition-transform duration-1000 ease-in-out group-hover:scale-[1.02]"
                  onError={() => onImageError?.(item.id)}
                />
                {/* Overlay on hover for Regenerate */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                    <button
                        onClick={() => onRetry(item.id)}
                        className="bg-slate-500/20 hover:bg-slate-500/30 backdrop-blur-md border border-slate-400/40 text-slate-300 px-4 py-2 rounded-sm text-xs uppercase tracking-widest font-medium transition-all transform translate-y-2 group-hover:translate-y-0"
                    >
                        Regenerate
                    </button>
                </div>
              </>
            ) : item.loading ? (
              <div className="flex flex-col items-center justify-center gap-4 text-slate-500">
                <div className="w-12 h-12 border border-slate-700 border-t-slate-300 rounded-full animate-spin opacity-50"></div>
                <span className="text-xs font-serif italic tracking-wider opacity-60">Painting in progress...</span>
              </div>
            ) : item.error ? (
              <div className="flex flex-col items-center justify-center gap-3 p-4 text-center w-full h-full bg-[#1a0f0f] overflow-y-auto">
                <p className="text-red-900/80 font-serif italic text-sm">Creation Failed</p>
                {item.error && item.error !== "Image generation failed" && (
                  <p className="text-slate-500 text-[10px] max-w-[95%] leading-relaxed text-left">{item.error}</p>
                )}
                {errorDetail && (
                  <pre className="text-[10px] text-slate-500 bg-black/40 p-2 rounded max-h-24 overflow-auto text-left w-[95%] whitespace-pre-wrap break-all border border-[#333]">
                    {errorDetail}
                  </pre>
                )}
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(copyableError).then(() => alert('已复制到剪贴板，可直接粘贴给开发者'))}
                  className="text-[10px] text-amber-400 hover:text-amber-300 border border-amber-600/50 hover:border-amber-500 px-3 py-1.5 rounded transition-colors"
                >
                  📋 复制报错信息（可粘贴给开发者）
                </button>
                <button 
                  onClick={() => onRetry(item.id)}
                  className="px-5 py-2.5 text-xs bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/40 hover:text-white transition-all uppercase tracking-widest shadow-[0_0_15px_rgba(255,0,0,0.1)] hover:shadow-[0_0_20px_rgba(255,0,0,0.2)]"
                >
                  Retry Image
                </button>
              </div>
            ) : (
              <div className="text-slate-800 text-sm font-serif italic">Canvas Empty</div>
            )}
          </div>
      </div>

      {/* Caption Area */}
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3 border-b border-[#222] pb-2">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Exhibit No. {item.id}</h3>
            {item.imageUrl && <span className="w-1.5 h-1.5 bg-[#d4af37] rounded-full shadow-[0_0_8px_rgba(212,175,55,0.6)]"></span>}
        </div>
        {item.sceneText && (
          <p className="text-xs text-slate-300 mb-2 font-medium">{item.sceneText}</p>
        )}
        <p className="text-xs text-slate-500 leading-relaxed font-serif italic flex-1 overflow-y-auto max-h-24 custom-scrollbar">
          "{item.prompt}"
        </p>
      </div>
    </div>
  );
};

export default ResultCard;