import type { FormEvent } from 'react';
import { SongListRow } from '@/components/home/song-list-row';
import { text, DEFAULT_AVATAR } from '@/constants/home.constants';
import type { SearchPlatformFilter } from '@/constants/home.constants';
import { getSongLikeKey } from '@/utils/home.utils';
import { useSongLikeStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { UiVersionSwitcher } from '@/components/theme/ui-version-switcher';
import type { UnifiedSong, UnifiedUser } from '@/types';
import { normalizeImageUrl } from '@/lib/image-url';

interface HomeHeaderProps {
  isMobileRuntime: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  isSearchDropdownOpen: boolean;
  onOpenSearchDropdown: () => void;
  isSearching: boolean;
  searchPlatformFilter: SearchPlatformFilter;
  onSetSearchPlatformFilter: (filter: SearchPlatformFilter) => void;
  searchSuggestions: string[];
  searchHistory: string[];
  searchResults: UnifiedSong[];
  filteredSearchResults: UnifiedSong[];
  searchWarnings: string[];
  searchError: string | null;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onApplySearchKeyword: (keyword: string) => void;
  onClearSearchHistory: () => void;
  searchDropdownRef: React.RefObject<HTMLDivElement | null>;
  containerRef: (node: HTMLDivElement | null) => void;
  measureRef: (node: HTMLDivElement | null) => void;
  virtualStart: number;
  virtualEnd: number;
  totalHeight: number;
  itemHeight: number;
  virtualItems: UnifiedSong[];
  playingSongId: string | null;
  isPlayerPlaying: boolean;
  selectedSongKey: string | null;
  doublePlayCueSongKey: string | null;
  likingSongIds: Record<string, boolean>;
  onSelectSong: (song: UnifiedSong) => void;
  onSearchPlayAt: (index: number) => void;
  onSearchDoublePlayAt: (index: number) => void;
  onLikeSongAction: (song: UnifiedSong) => void;
  users: { netease: UnifiedUser | null; qq: UnifiedUser | null };
  neteaseDisplayNickname: string;
  qqDisplayNickname: string;
  onRemoveUser: (platform: 'netease' | 'qq') => void;
}

export function HomeHeader({
  isMobileRuntime,
  keyword,
  onKeywordChange,
  isSearchDropdownOpen,
  onOpenSearchDropdown,
  isSearching,
  searchPlatformFilter,
  onSetSearchPlatformFilter,
  searchSuggestions,
  searchHistory,
  searchResults,
  filteredSearchResults,
  searchWarnings,
  searchError,
  onSearch,
  onApplySearchKeyword,
  onClearSearchHistory,
  searchDropdownRef,
  containerRef,
  measureRef,
  virtualStart,
  virtualEnd: _virtualEnd,
  totalHeight,
  itemHeight,
  virtualItems,
  playingSongId,
  isPlayerPlaying,
  selectedSongKey,
  doublePlayCueSongKey,
  likingSongIds,
  onSelectSong,
  onSearchPlayAt,
  onSearchDoublePlayAt,
  onLikeSongAction,
  users,
  neteaseDisplayNickname,
  qqDisplayNickname,
  onRemoveUser,
}: HomeHeaderProps) {
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);

  return (
    <header className="relative z-[80] shrink-0 border-b border-white/15 bg-slate-900/35 backdrop-blur">
      <div className="container mx-auto px-4 py-3">
        <div className={`flex gap-3 ${isMobileRuntime ? 'flex-wrap items-start' : 'items-center'}`}>
          <div className="flex shrink-0 items-center gap-3">
            <h1 className="am-title-gradient text-2xl font-bold">
              {text.title}
            </h1>
            <p className="hidden text-xs text-slate-400 2xl:block">{text.subtitle}</p>
          </div>

          <div
            ref={searchDropdownRef}
            className={`relative flex min-w-0 items-center gap-2 ${
              isMobileRuntime ? 'order-3 w-full max-w-none' : 'mx-auto max-w-4xl flex-1'
            }`}
          >
            <form onSubmit={onSearch} className="flex w-full items-center gap-2">
              <Input
                value={keyword}
                onChange={(event) => {
                  onKeywordChange(event.target.value);
                  onOpenSearchDropdown();
                }}
                onFocus={() => onOpenSearchDropdown()}
                placeholder={text.searchPlaceholder}
                disabled={isSearching}
                className="h-11"
              />
              <Button type="submit" variant="primary" disabled={isSearching} className="h-11 shrink-0 px-5">
                {isSearching ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size="sm" />
                    {text.searching}
                  </span>
                ) : (
                  text.searchBtn
                )}
              </Button>
            </form>

            {isSearchDropdownOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[120] rounded-xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">{text.searchResultsDesc}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Button
                      variant={searchPlatformFilter === 'all' ? 'primary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onSetSearchPlatformFilter('all')}
                    >
                      {text.searchFilterAll}
                    </Button>
                    <Button
                      variant={searchPlatformFilter === 'netease' ? 'primary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onSetSearchPlatformFilter('netease')}
                    >
                      {text.searchFilterNetease}
                    </Button>
                    <Button
                      variant={searchPlatformFilter === 'qq' ? 'primary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onSetSearchPlatformFilter('qq')}
                    >
                      {text.searchFilterQQ}
                    </Button>
                  </div>
                </div>

                {(searchSuggestions.length > 0 || searchHistory.length > 0) && (
                  <div className="mb-3 space-y-2 rounded-lg border border-slate-700/80 bg-slate-900/50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">
                        {text.searchSuggestionTitle}
                      </p>
                      {searchHistory.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={onClearSearchHistory}
                        >
                          {text.clearSearchHistory}
                        </Button>
                      )}
                    </div>

                    {searchSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {searchSuggestions.map((item) => (
                          <Button
                            key={`suggestion_${item}`}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 rounded-full px-2.5 text-[11px]"
                            onClick={() => onApplySearchKeyword(item)}
                            title={`搜索 ${item}`}
                          >
                            {item}
                          </Button>
                        ))}
                      </div>
                    )}

                    {searchHistory.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">{text.searchHistoryTitle}:</span>
                        {searchHistory.slice(0, 8).map((item) => (
                          <button
                            key={`history_${item}`}
                            type="button"
                            className="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-violet-300/70 hover:text-violet-200"
                            onClick={() => onApplySearchKeyword(item)}
                            title={`使用历史关键词：${item}`}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {searchError && <p className="mb-2 text-sm text-rose-300">{searchError}</p>}
                {searchWarnings.length > 0 && (
                  <div className="mb-2 space-y-1 text-xs text-amber-200">
                    {searchWarnings.map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                )}

                {isSearching ? (
                  <div className="space-y-2 py-1">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={`search-skeleton-${index}`} className="rounded-lg border border-slate-700/70 bg-slate-900/55 p-2">
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ))}
                  </div>
                ) : searchResults.length === 0 ? (
                  <p className="text-sm text-slate-400">{text.noSearchResults}</p>
                ) : filteredSearchResults.length === 0 ? (
                  <p className="text-sm text-slate-400">{text.noFilteredSearchResults}</p>
                ) : (
                  <div
                    ref={containerRef}
                    className="am-song-scrollbar max-h-[52vh] overflow-y-scroll pr-1 sm:max-h-[360px]"
                  >
                    <div className="relative" style={{ height: `${totalHeight}px` }}>
                      {virtualItems.map((song, offsetIndex) => {
                        const index = virtualStart + offsetIndex;
                        const likeKey = getSongLikeKey(song);
                        const isLiked = resolveLiked(song);
                        const isLiking = Boolean(likingSongIds[likeKey]);
                        const isCurrentPlaying = playingSongId === song.id;
                        const isSelectedSong = selectedSongKey === likeKey;
                        const isDoublePlayCue = doublePlayCueSongKey === likeKey;
                        const playActionLabel = isCurrentPlaying && isPlayerPlaying ? text.pauseSong : text.playSong;
                        const playActionIcon = isCurrentPlaying && isPlayerPlaying ? '\u23f8' : '\u25b6';

                        return (
                          <div
                            key={`${song.id}_${index}`}
                            ref={offsetIndex === 0 ? measureRef : undefined}
                            className="absolute left-0 right-0 pb-2"
                            style={{ top: `${index * itemHeight}px` }}
                          >
                            <SongListRow
                              song={song}
                              index={index}
                              isLiked={isLiked}
                              isLiking={isLiking}
                              isCurrentPlaying={isCurrentPlaying}
                              isSelectedSong={isSelectedSong}
                              isDoublePlayCue={isDoublePlayCue}
                              playActionLabel={playActionLabel}
                              playActionIcon={playActionIcon}
                              unknownArtistText={text.unknownArtist}
                              unknownAlbumText={text.unknownAlbum}
                              compact
                              onSelectSong={onSelectSong}
                              onDoublePlayAt={onSearchDoublePlayAt}
                              onPlayAt={onSearchPlayAt}
                              onLikeSong={onLikeSongAction}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className={`flex items-center gap-2 text-xs ${
              isMobileRuntime ? 'order-2 ml-auto w-full justify-end overflow-x-auto pb-1' : 'ml-auto shrink-0'
            }`}
          >
            {users.netease && (
              <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-1.5 py-1">
                <img src={normalizeImageUrl(users.netease.avatarUrl) || DEFAULT_AVATAR} alt={neteaseDisplayNickname} className="h-6 w-6 rounded-full" />
                {!isMobileRuntime && (
                  <span className="max-w-40 truncate text-[11px] text-slate-200">{neteaseDisplayNickname}</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveUser('netease')}
                  className="h-6 rounded-full border border-slate-600/80 bg-slate-800/70 px-2.5 text-[11px] hover:bg-slate-700/80"
                >
                  {isMobileRuntime ? '退' : text.logout}
                </Button>
              </div>
            )}

            {users.qq && (
              <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-1.5 py-1">
                <img src={normalizeImageUrl(users.qq.avatarUrl) || DEFAULT_AVATAR} alt={qqDisplayNickname} className="h-6 w-6 rounded-full" />
                {!isMobileRuntime && (
                  <span className="max-w-40 truncate text-[11px] text-slate-200">{qqDisplayNickname}</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveUser('qq')}
                  className="h-6 rounded-full border border-slate-600/80 bg-slate-800/70 px-2.5 text-[11px] hover:bg-slate-700/80"
                >
                  {isMobileRuntime ? '退' : text.logout}
                </Button>
              </div>
            )}

            <UiVersionSwitcher className="shrink-0" compact={isMobileRuntime} triggerLabel="切换主题" />
          </div>
        </div>
      </div>
    </header>
  );
}

export type { HomeHeaderProps };
