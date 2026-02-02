import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="mb-12 text-center relative py-8">
      {/* Decorative Line */}
      <div className="w-16 h-[1px] bg-gradient-to-r from-transparent via-yellow-600/50 to-transparent mx-auto mb-6"></div>
      
      <h1 className="text-5xl md:text-7xl font-serif italic text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-200 to-slate-500 mb-6 tracking-wide drop-shadow-lg">
        The Inspiration Gallery
      </h1>
      <h2 className="text-xl md:text-2xl font-serif text-slate-400 mb-4 tracking-widest uppercase text-[0.8em]">
        听说在线 · 灵感画廊
      </h2>
      
      <p className="text-slate-500 text-sm md:text-base font-light tracking-wider max-w-lg mx-auto leading-loose font-serif">
        "Where imagination meets the canvas of artificial intelligence."
      </p>
      
      {/* Decorative Line */}
      <div className="w-16 h-[1px] bg-gradient-to-r from-transparent via-yellow-600/50 to-transparent mx-auto mt-6"></div>
    </header>
  );
};

export default Header;