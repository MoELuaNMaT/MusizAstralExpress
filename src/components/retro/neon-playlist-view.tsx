import { memo, useMemo, type FormEvent } from 'react';
import type { UnifiedSong } from '@/types';
import { normalizeImageUrl } from '@/lib/image-url';
import { useCachedCoverUrl } from '@/hooks/useCachedCoverUrl';

export interface NeonPlaylistViewProps {
  activeTape: string;
  onSelectTape: (tapeName: string) => void;
  songs: UnifiedSong[];
  currentSongId: string | null;
  isPlaying: boolean;
  onPlaySong: (index: number) => void;
  resolveLiked: (song: UnifiedSong) => boolean;
  likingSongIds: Record<string, boolean>;
  onLikeSong: (song: UnifiedSong) => void;
  onReturnToDeck: () => void;
  likedSource: string;
  dailySource: string;
  // 搜索 props
  keyword: string;
  setKeyword: (value: string) => void;
  isSearching: boolean;
  searchPlatformFilter: string;
  setSearchPlatformFilter: (value: string) => void;
  searchSuggestions: string[];
  searchHistory: string[];
  searchWarnings: string[];
  searchError: string | null;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onApplySearchKeyword: (keyword: string) => void;
  onClearSearchHistory: () => void;
}

const TAPE_MENUS = [
  { id: 'liked-stack', icon: 'favorite', label: '我喜欢' },
  { id: 'daily-stack', icon: 'radio', label: '推荐' },
  { id: 'search', icon: 'search', label: '搜索' },
  { id: 'history', icon: 'history', label: '历史' },
];

const TAPE_TITLES: Record<string, string> = {
  'liked-stack': '我喜欢的歌单',
  'daily-stack': '推荐歌单',
  'search': '全网搜索',
  'history': '历史记录'
};

const DEFAULT_NEON_COVER = 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2070&auto=format&fit=crop';

/** Resolve a human-readable platform badge for the current tape + source */
function resolvePlatformLabel(activeTape: string, likedSource: string, dailySource: string): { text: string; color: string } {
  if (activeTape === 'liked-stack') {
    if (likedSource === 'qq-liked') return { text: 'QQ音乐', color: 'text-emerald-400' };
    if (likedSource === 'netease-liked') return { text: '网易云', color: 'text-red-400' };
    return { text: '混合', color: 'text-cyan-400' };
  }
  if (activeTape === 'daily-stack') {
    if (dailySource === 'qq') return { text: 'QQ音乐', color: 'text-emerald-400' };
    if (dailySource === 'netease') return { text: '网易云', color: 'text-red-400' };
    return { text: '混合', color: 'text-cyan-400' };
  }
  if (activeTape === 'search') return { text: '搜索', color: 'text-on-surface-variant' };
  if (activeTape === 'history') return { text: '历史', color: 'text-on-surface-variant' };
  return { text: '', color: '' };
}

/** Resolve a short source tag for sidebar sub-label */
function resolveSourceTag(tapeId: string, likedSource: string, dailySource: string): string | null {
  if (tapeId === 'liked-stack') {
    if (likedSource === 'qq-liked') return 'QQ';
    if (likedSource === 'netease-liked') return 'NCM';
    return 'MIX';
  }
  if (tapeId === 'daily-stack') {
    if (dailySource === 'qq') return 'QQ';
    if (dailySource === 'netease') return 'NCM';
    return 'MIX';
  }
  return null;
}

function NeonSongCover({
  song,
  isCurrent,
}: {
  song: UnifiedSong;
  isCurrent: boolean;
}) {
  const coverUrl = useCachedCoverUrl(song.coverUrl, DEFAULT_NEON_COVER);
  const normalizedFallback = normalizeImageUrl(DEFAULT_NEON_COVER);

  return (
    <img
      src={coverUrl || normalizedFallback}
      alt={`${song.name} 封面`}
      className={`cover-img w-full h-full object-cover ${isCurrent ? 'is-current scale-105' : ''}`}
      loading="lazy"
    />
  );
}

export const NeonPlaylistView = memo(({
  activeTape,
  onSelectTape,
  songs,
  currentSongId,
  onPlaySong,
  onReturnToDeck,
  likedSource,
  dailySource,
  keyword,
  setKeyword,
  isSearching,
  searchPlatformFilter,
  setSearchPlatformFilter,
  searchSuggestions,
  searchHistory,
  searchWarnings,
  searchError,
  onSearch,
  onApplySearchKeyword,
  onClearSearchHistory,
}: NeonPlaylistViewProps) => {

  const displaySongs = useMemo(() => songs.slice(0, 48), [songs]);
  const platform = resolvePlatformLabel(activeTape, likedSource, dailySource);

  return (
    <div className="fixed inset-0 z-50 bg-background text-on-background selection:bg-primary selection:text-on-primary">
      {/* Side Navigation — Frosted Holographic Terminal */}
      <nav className="absolute left-0 top-0 bottom-0 w-44 flex flex-col z-40 overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(20,5,40,0.96) 0%, rgba(12,2,28,0.98) 100%)',
          borderRight: '1px solid rgba(255,131,209,0.2)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.6), inset -1px 0 0 rgba(255,131,209,0.08)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Subtle noise texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] z-0"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundSize: '128px 128px' }}
        />
        {/* Right edge glow line */}
        <div className="absolute right-0 top-0 bottom-0 w-[1px] z-20 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent 5%, rgba(255,131,209,0.5) 30%, rgba(15,206,255,0.4) 70%, transparent 95%)', boxShadow: '0 0 12px rgba(255,131,209,0.15)' }}
        />

        {/* Brand area */}
        <div className="relative pt-7 pb-5 px-5 z-10">
          {/* Corner brackets decoration */}
          <div className="absolute top-3 left-3 w-4 h-4 border-t border-l border-primary/30 rounded-tl-sm" />
          <div className="absolute top-3 right-3 w-4 h-4 border-t border-r border-primary/30 rounded-tr-sm" />
          <div className="font-['Space_Grotesk'] text-[13px] font-black tracking-[0.2em] text-primary/90"
            style={{ textShadow: '0 0 10px rgba(255,131,209,0.35)' }}
          >
            SELECTOR
          </div>
          <div className="font-['Space_Grotesk'] text-[9px] font-bold tracking-[0.15em] text-on-surface-variant/50 mt-1">
            SOURCE CONTROL
          </div>
          {/* Divider */}
          <div className="mt-4 h-[1px]" style={{ background: 'linear-gradient(90deg, rgba(255,131,209,0.3), rgba(15,206,255,0.2), transparent)' }} />
        </div>

        {/* Navigation items */}
        <div className="flex flex-col gap-1 w-full px-3 relative z-10">
          {TAPE_MENUS.map((menu) => {
            const isActive = activeTape === menu.id;
            const sourceTag = resolveSourceTag(menu.id, likedSource, dailySource);
            const sourceColor = sourceTag === 'QQ' ? '#34d399' : sourceTag === 'NCM' ? '#f87171' : '#22d3ee';
            const sourceLabel = sourceTag === 'QQ' ? 'QQ音乐' : sourceTag === 'NCM' ? '网易云' : '混合';

            return (
              <button
                key={menu.id}
                onClick={() => onSelectTape(menu.id)}
                className="relative w-full text-left transition-all duration-200 group rounded-md overflow-hidden"
                style={isActive ? {
                  background: 'linear-gradient(135deg, rgba(255,131,209,0.1) 0%, rgba(15,206,255,0.06) 100%)',
                  border: '1px solid rgba(255,131,209,0.25)',
                  boxShadow: 'inset 0 0 16px rgba(255,131,209,0.06), 0 0 10px rgba(255,131,209,0.08)',
                } : {
                  background: 'transparent',
                  border: '1px solid transparent',
                }}
              >
                {/* Left accent bar */}
                {isActive && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px]"
                    style={{ background: 'linear-gradient(180deg, #ff83d1, #0fceff)', boxShadow: '0 0 6px rgba(255,131,209,0.5)' }}
                  />
                )}
                <div className={`flex items-center gap-3 py-3 pl-4 pr-3 ${isActive ? '' : 'opacity-40 hover:opacity-75'} transition-opacity duration-200`}>
                  <span className={`material-symbols-outlined transition-all duration-200`}
                    style={{
                      fontSize: '20px',
                      color: isActive ? '#ff83d1' : '#6b6b7b',
                      textShadow: isActive ? '0 0 8px rgba(255,131,209,0.5)' : 'none',
                      fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >{menu.icon}</span>
                  <div className="flex flex-col min-w-0 gap-0.5">
                    {/* ★ Larger category label */}
                    <span className="font-['Space_Grotesk'] font-bold leading-none transition-colors duration-200"
                      style={{
                        fontSize: '16px',
                        color: isActive ? '#f3deff' : '#6b6b7b',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {menu.label}
                    </span>
                    {/* Platform source */}
                    {sourceTag && (
                      <span className="font-['Space_Grotesk'] text-[10px] font-bold flex items-center gap-1 transition-colors duration-200"
                        style={{ color: isActive ? sourceColor : 'rgba(107,107,123,0.5)' }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full transition-all duration-200"
                          style={{
                            background: isActive ? sourceColor : 'rgba(107,107,123,0.3)',
                            boxShadow: isActive ? `0 0 5px ${sourceColor}` : 'none',
                          }}
                        />
                        {sourceLabel}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        
        {/* Hint */}
        <div className="mt-5 mx-4 relative z-10">
          <div className="flex items-center justify-center gap-1.5 py-2 rounded-md"
            style={{ border: '1px solid rgba(255,131,209,0.1)', background: 'rgba(255,131,209,0.03)' }}
          >
            <span className="font-['Space_Grotesk'] text-[9px] font-bold text-on-surface-variant/30 tracking-wider">
              ↻ 双击切换平台
            </span>
          </div>
        </div>

        {/* Bottom section */}
        <div className="mt-auto relative z-10">
          {/* Divider */}
          <div className="mx-4 mb-3 h-[1px]" style={{ background: 'linear-gradient(90deg, transparent, rgba(239,68,68,0.25), transparent)' }} />
          
          {/* Eject button */}
          <div className="mb-5 px-3 w-full">
            <button
              onClick={onReturnToDeck}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md transition-all duration-200 group"
              title="EJECT / MAIN DECK"
              style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.18)',
              }}
            >
              <span className="material-symbols-outlined text-lg text-red-500/60 group-hover:text-red-400 transition-all"
                style={{ fontSize: '18px' }}
              >eject</span>
              <span className="font-['Space_Grotesk'] text-[11px] font-bold text-red-500/60 group-hover:text-red-400 uppercase tracking-[0.15em] transition-all">
                Eject
              </span>
            </button>
          </div>

          {/* Bottom corner brackets */}
          <div className="relative h-4 mx-3 mb-3">
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-primary/20 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-primary/20 rounded-br-sm" />
          </div>
        </div>
      </nav>

      {/* Main Canvas */}
      <main className="absolute left-44 right-0 top-0 bottom-0 overflow-y-auto overflow-x-hidden neon-scroll">
        {/* Background Elements */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-x-0 bottom-0 h-[409px] vapor-grid"></div>
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-t from-primary via-surface-variant to-transparent rounded-full opacity-20 blur-[100px]"></div>
          <div className="absolute top-20 right-20 w-32 h-32 rounded-full bg-gradient-to-br from-secondary to-primary opacity-30 blur-sm"></div>
        </div>

        <div className="relative z-10 px-8 pb-32">
          <header className="sticky top-0 z-50 pt-8 pb-4 mb-8 flex items-end justify-between border-b-4 border-primary/20 bg-background/90 backdrop-blur-xl">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-4xl font-['Space_Grotesk'] font-black tracking-[0.1em] text-primary italic drop-shadow-[4px_4px_0px_#3c0066] uppercase">
                  {TAPE_TITLES[activeTape] || 'UNKNOWN_VOLUMES'}
                </h1>
                {/* Platform badge in header */}
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-['Space_Grotesk'] font-black uppercase tracking-wider ${
                  platform.text === 'QQ音乐'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : platform.text === '网易云'
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    platform.text === 'QQ音乐' ? 'bg-emerald-400' : platform.text === '网易云' ? 'bg-red-400' : 'bg-cyan-400'
                  } shadow-[0_0_6px_currentColor]`} />
                  {platform.text}
                </span>
              </div>
              <p className="text-tertiary font-mono text-xs mt-2 uppercase tracking-widest vfd-text">
                Status: {songs.length}_SAMPLES_LOADED // BUFFER_CLEAN
              </p>
            </div>
          </header>

          {/* Search Console — 仅搜索磁带显示 */}
          {activeTape === 'search' && (
            <div className="mb-8 space-y-4">
              {/* 搜索输入行 */}
              <form onSubmit={onSearch} className="flex gap-3">
                <input
                  className="flex-1 px-4 py-3 font-['Space_Grotesk'] text-sm font-medium text-on-background placeholder-on-surface-variant/40 bg-surface-container border border-primary/30 rounded-md outline-none transition-all duration-200 focus:border-primary/60 focus:shadow-[0_0_12px_rgba(255,131,209,0.2),inset_0_0_16px_rgba(255,131,209,0.06)]"
                  placeholder="输入歌名、歌手或专辑"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="px-5 py-3 font-['Space_Grotesk'] text-xs font-black tracking-[0.15em] uppercase text-on-primary bg-primary rounded-md border border-primary/80 shadow-[0_0_12px_rgba(255,131,209,0.3)] transition-all duration-200 hover:shadow-[0_0_20px_rgba(255,131,209,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSearching ? '[ SCANNING ]' : '[ SCAN ]'}
                </button>
              </form>

              {/* 平台筛选 */}
              <div className="flex gap-2">
                {(['all', 'netease', 'qq'] as const).map((filter) => {
                  const labels: Record<string, string> = { all: '全部', netease: '网易云', qq: 'QQ' };
                  const isActive = searchPlatformFilter === filter;
                  const colors: Record<string, string> = {
                    all: 'border-primary/25 bg-primary/10 text-primary',
                    netease: 'border-red-500/25 bg-red-500/10 text-red-400',
                    qq: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
                  };
                  const inactiveColors: Record<string, string> = {
                    all: 'border-on-surface-variant/15 bg-transparent text-on-surface-variant/40',
                    netease: 'border-on-surface-variant/15 bg-transparent text-on-surface-variant/40',
                    qq: 'border-on-surface-variant/15 bg-transparent text-on-surface-variant/40',
                  };
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setSearchPlatformFilter(filter)}
                      className={`px-4 py-2 rounded-md border font-['Space_Grotesk'] text-xs font-bold tracking-wider uppercase transition-all duration-200 ${isActive ? colors[filter] : inactiveColors[filter]} ${isActive ? 'shadow-[0_0_8px_rgba(255,131,209,0.15)]' : 'hover:bg-on-surface-variant/5'}`}
                    >
                      {labels[filter]}
                    </button>
                  );
                })}
              </div>

              {/* 搜索建议 + 历史标签 */}
              {(searchSuggestions.length > 0 || searchHistory.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {searchSuggestions.slice(0, 6).map((item) => (
                    <button
                      key={`suggestion-${item}`}
                      type="button"
                      onClick={() => onApplySearchKeyword(item)}
                      className="px-3 py-1.5 rounded border border-primary/20 bg-primary/5 font-['Space_Grotesk'] text-[11px] font-bold text-on-surface-variant transition-all duration-200 hover:bg-primary/10 hover:border-primary/40 hover:text-on-background"
                    >
                      {item}
                    </button>
                  ))}
                  {searchHistory.slice(0, 4).map((item) => (
                    <button
                      key={`history-${item}`}
                      type="button"
                      onClick={() => onApplySearchKeyword(item)}
                      className="px-3 py-1.5 rounded border border-secondary/20 bg-secondary/5 font-['Space_Grotesk'] text-[11px] font-bold text-on-surface-variant transition-all duration-200 hover:bg-secondary/10 hover:border-secondary/40 hover:text-on-background"
                    >
                      {item}
                    </button>
                  ))}
                  {searchHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearSearchHistory}
                      className="px-3 py-1.5 rounded border border-error/20 bg-error/5 font-['Space_Grotesk'] text-[11px] font-bold text-error/60 transition-all duration-200 hover:bg-error/10 hover:text-error"
                    >
                      清空历史
                    </button>
                  )}
                </div>
              )}

              {/* 内联警告 */}
              {searchWarnings.length > 0 && songs.length > 0 && (
                <div className="px-4 py-3 rounded-md border border-tertiary/20 bg-tertiary/5 space-y-1">
                  {searchWarnings.map((warning) => (
                    <p key={warning} className="font-['Space_Grotesk'] text-[11px] font-medium text-tertiary/80">
                      {warning}
                    </p>
                  ))}
                </div>
              )}

              {/* 错误态 */}
              {searchError && (
                <div className="flex items-center gap-3 px-5 py-4 rounded-md border border-error/30 bg-error/5">
                  <span className="material-symbols-outlined text-error text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                  <p className="font-['Space_Grotesk'] text-sm font-medium text-error">{searchError}</p>
                </div>
              )}

              {/* 空态 */}
              {!searchError && keyword.trim() && songs.length === 0 && !isSearching && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3" style={{ fontVariationSettings: "'FILL' 1" }}>search_off</span>
                  <p className="font-['Space_Grotesk'] text-sm font-bold text-on-surface-variant/40 uppercase tracking-widest">
                    当前关键词没有命中结果
                  </p>
                </div>
              )}
              {!searchError && !keyword.trim() && songs.length === 0 && !isSearching && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-3" style={{ fontVariationSettings: "'FILL' 1" }}>manage_search</span>
                  <p className="font-['Space_Grotesk'] text-sm font-bold text-on-surface-variant/40 uppercase tracking-widest vfd-text">
                    输入关键词后开始检索音乐信号
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Library Grid */}
          <div className="neon-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-10 pt-4">
            {displaySongs.map((song, idx) => {
              const isCurrent = currentSongId === song.id;

              return (
                <div key={song.id} className="flex flex-col gap-4">
                  <div 
                    onClick={() => onPlaySong(idx)}
                    className="jewel-case relative group cursor-pointer aspect-square bg-white/5 p-1 rounded shadow-2xl border border-white/20"
                  >
                    <div className="absolute inset-0 gloss z-20 pointer-events-none rounded"></div>
                    <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/10 border-l border-white/20 z-10 flex items-center justify-center">
                      <span className="text-[6px] text-white/40 rotate-90 font-bold uppercase tracking-widest truncate w-full pl-2">
                        {song.album || 'DIGITAL_MASTER'}
                      </span>
                    </div>
                    <div className="w-full h-full overflow-hidden bg-surface-container">
                      <NeonSongCover song={song} isCurrent={isCurrent} />
                    </div>
                    {isCurrent && (
                        <div className="absolute inset-0 z-30 border-4 border-secondary pointer-events-none rounded shadow-[0_0_20px_rgba(15,206,255,0.6)]"></div>
                    )}
                    <div className="absolute bottom-4 left-4 right-8 bg-black/80 p-2 backdrop-blur-sm border-l-4 border-primary">
                      <div className="text-[10px] font-['Space_Grotesk'] font-black text-primary truncate">
                        {song.artist || 'UNKNOWN'}
                      </div>
                      <div className="text-xs font-['Space_Grotesk'] font-bold text-white uppercase tracking-tighter truncate">
                        {song.name}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-2.5 shadow-lg rounded-b"
                    style={{
                      background: 'linear-gradient(180deg, rgba(26,0,49,0.95), rgba(13,0,24,0.98))',
                      borderTop: '2px solid rgba(255,131,209,0.3)',
                    }}
                  >
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="font-['Space_Grotesk'] text-xs font-black text-primary tracking-wider"
                        style={{ textShadow: '0 0 6px rgba(255,131,209,0.6)' }}
                      >
                        TRK:{String(idx + 1).padStart(2, '0')}
                      </span>
                      {/* Show platform origin per song */}
                      <span className={`font-['Space_Grotesk'] text-[9px] font-bold flex items-center gap-1 ${
                        song.platform === 'qq' ? 'text-emerald-400' : song.platform === 'netease' ? 'text-red-400' : 'text-zinc-600'
                      }`}
                        style={song.platform ? { textShadow: `0 0 4px currentColor` } : {}}
                      >
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                          song.platform === 'qq' ? 'bg-emerald-400' : song.platform === 'netease' ? 'bg-red-400' : 'bg-zinc-600'
                        }`} style={song.platform ? { boxShadow: '0 0 4px currentColor' } : {}} />
                        {song.platform === 'qq' ? 'QQ' : song.platform === 'netease' ? 'NCM' : ''}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(60,0,102,0.6)' }}>
                      <div className={`h-full rounded-full transition-all duration-500 ${isCurrent ? 'w-full' : 'w-0'}`}
                        style={isCurrent ? {
                          background: 'linear-gradient(90deg, #0fceff, #ff83d1)',
                          boxShadow: '0 0 8px rgba(15,206,255,0.5)',
                        } : { background: '#ff83d1' }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {songs.length > 48 && (
              <div className="text-center mt-12 text-tertiary text-sm vfd-text">
                  [ TRUNCATED VIEW: SHOWING FIRST 48 SAMPLES OPTIMIZED ]
              </div>
          )}
        </div>

        {/* Scanlines Overlay */}
        <div className="fixed inset-0 scanlines z-40 pointer-events-none opacity-30"></div>
      </main>
    </div>
  );
});
