import type { ChangeEvent, WheelEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { SongListRow } from '@/components/home/song-list-row';
import { PlaylistPlatformCover, PlatformBadge } from '@/components/home/platform-badges';
import { text, playlistTypeNameMap } from '@/constants/home.constants';
import type { PanelTab, NeteaseLikedOrder } from '@/constants/home.constants';
import { useSongLikeStore } from '@/stores';
import { getSongLikeKey } from '@/utils/home.utils';
import type { UnifiedPlaylist, UnifiedSong } from '@/types';

interface PlaylistsPanelProps {
  isMobileRuntime: boolean;
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  isInitialPlaylistBootstrapPending: boolean;
  initialPlaylistBootstrapMessage: string;
  isPlaylistLoading: boolean;
  playlistError: string | null;
  playlists: UnifiedPlaylist[];
  playlistWarnings: string[];
  selectedPlaylist: UnifiedPlaylist | null;
  onSelectPlaylist: (playlist: UnifiedPlaylist) => void;
  playlistDetailSongs: UnifiedSong[];
  playlistDetailError: string | null;
  isDetailLoading: boolean;
  isDetailRefreshing: boolean;
  isNeteaseLikedPlaylistSelected: boolean;
  isDetailBusy: boolean;
  neteaseLikedOrder: NeteaseLikedOrder;
  onNeteaseLikedOrderChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onForceRefreshNeteaseWebOrder: () => void;
  onRefresh: () => void;
  isSearching: boolean;
  isDailyLoading: boolean;
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
  onDetailPlayAt: (index: number) => void;
  onDetailDoublePlayAt: (index: number) => void;
  onLikeSongAction: (song: UnifiedSong) => void;
  onScrollableWheel: (event: WheelEvent<HTMLElement>) => void;
}

export function PlaylistsPanel({
  isMobileRuntime,
  panelTab,
  setPanelTab,
  isInitialPlaylistBootstrapPending,
  initialPlaylistBootstrapMessage,
  isPlaylistLoading,
  playlistError,
  playlists,
  playlistWarnings,
  selectedPlaylist,
  onSelectPlaylist,
  playlistDetailSongs,
  playlistDetailError,
  isDetailLoading,
  isDetailRefreshing: _isDetailRefreshing,
  isNeteaseLikedPlaylistSelected,
  isDetailBusy,
  neteaseLikedOrder,
  onNeteaseLikedOrderChange,
  onForceRefreshNeteaseWebOrder,
  onRefresh,
  isSearching,
  isDailyLoading,
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
  onDetailPlayAt,
  onDetailDoublePlayAt,
  onLikeSongAction,
  onScrollableWheel,
}: PlaylistsPanelProps) {
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);

  if (panelTab !== 'playlists') {
    return null;
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
        <div className="pt-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="mt-1 text-3xl font-black tracking-[0.18em] text-transparent drop-shadow-[0_2px_10px_rgba(56,189,248,0.35)] bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 bg-clip-text sm:text-4xl">
              整合歌单
            </h2>
            {!selectedPlaylist && (
              <p className="mt-1 text-xs text-slate-400">{text.detailHint}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className={`items-center gap-2 ${isMobileRuntime ? 'hidden' : 'flex'}`}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPanelTab('playlists')}
              >
                {text.panelTabPlaylists}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanelTab('daily')}
              >
                {text.panelTabDaily}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanelTab('history')}
              >
                {text.panelTabHistory}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={onRefresh}
                disabled={isInitialPlaylistBootstrapPending || isPlaylistLoading || isSearching || isDetailBusy || isDailyLoading}
                className="shrink-0"
              >
                {text.refresh}
              </Button>
            </div>
            {isNeteaseLikedPlaylistSelected && (
              <div className="hidden" aria-hidden="true">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <span>{text.neteaseLikedOrderLabel}</span>
                  <select
                    value={neteaseLikedOrder}
                    onChange={onNeteaseLikedOrderChange}
                    disabled={isDetailBusy}
                    className="h-8 rounded-md border border-slate-600 bg-slate-900/90 px-2 text-xs text-slate-100"
                  >
                    <option value="latest">{text.neteaseLikedOrderLatest}</option>
                    <option value="earliest">{text.neteaseLikedOrderEarliest}</option>
                    <option value="api">{text.neteaseLikedOrderApi}</option>
                  </select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onForceRefreshNeteaseWebOrder()}
                  disabled={isDetailBusy}
                >
                  {text.neteaseRebuildWebOrder}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch gap-4 xl:grid-cols-[340px,1fr]">
          <section
            className="am-song-scrollbar h-full min-h-0 space-y-3 overflow-y-scroll pr-1"
            onWheel={onScrollableWheel}
            onWheelCapture={onScrollableWheel}
          >
            {isInitialPlaylistBootstrapPending ? (
              <div className="space-y-3 py-1">
                <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>{initialPlaylistBootstrapMessage || text.bootstrappingPlaylists}</span>
                  </div>
                  <p className="mt-2 text-xs text-cyan-200/90">{text.bootstrappingPlaylistsHint}</p>
                </div>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`playlist-bootstrap-skeleton-${index}`} className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-14 w-14 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : isPlaylistLoading ? (
              <div className="space-y-3 py-1">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={`playlist-skeleton-${index}`} className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-14 w-14 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : playlistError ? (
              <p className="text-sm text-rose-300">{playlistError}</p>
            ) : playlists.length === 0 ? (
              <div className="am-empty-state">
                <p className="text-sm text-slate-300">{text.noPlaylists}</p>
              </div>
            ) : (
              playlists.map((playlist) => {
                const selected = selectedPlaylist?.id === playlist.id;

                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => void onSelectPlaylist(playlist)}
                    className={`am-touch-target touch-manipulation w-full rounded-lg border px-3 py-3 flex items-center gap-3 text-left transition ${
                      selected
                        ? 'border-blue-400 bg-blue-500/10'
                        : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/70'
                    }`}
                  >
                        <PlaylistPlatformCover playlist={playlist} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{playlist.name}</p>
                      <p className="text-xs text-slate-400 mt-1 truncate">
                        {playlist.creator || text.unknownCreator} - {playlist.songCount} {text.songsUnit}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end text-xs">
                      <PlatformBadge platform={playlist.platform} />
                      <span className="text-slate-400">{playlistTypeNameMap[playlist.type]}</span>
                    </div>
                  </button>
                );
              })
            )}
          </section>

          <section className="min-w-0 h-full min-h-0 overflow-hidden flex flex-col space-y-2">
            {isInitialPlaylistBootstrapPending ? (
              <div className="am-empty-state">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Spinner size="sm" />
                  <span>{text.bootstrappingPlaylists}</span>
                </div>
              </div>
            ) : !selectedPlaylist ? (
              <div className="am-empty-state">
                <p className="text-sm text-slate-300">{text.noSelectedPlaylist}</p>
              </div>
            ) : isDetailLoading ? (
              <div className="space-y-2 py-1">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div key={`playlist-detail-skeleton-${index}`} className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-2">
                    <Skeleton className="h-14 w-full" />
                  </div>
                ))}
              </div>
            ) : playlistDetailError ? (
              <p className="text-sm text-rose-300">{playlistDetailError}</p>
            ) : playlistDetailSongs.length === 0 ? (
              <div className="am-empty-state">
                <p className="text-sm text-slate-300">{text.noSongsInPlaylist}</p>
              </div>
            ) : (
              <div
                ref={containerRef}
                className="am-song-scrollbar min-h-0 flex-1 overflow-y-scroll pr-1"
                onWheel={onScrollableWheel}
                onWheelCapture={onScrollableWheel}
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
                          showIndex
                          onSelectSong={onSelectSong}
                          onDoublePlayAt={onDetailDoublePlayAt}
                          onPlayAt={onDetailPlayAt}
                          onLikeSong={onLikeSongAction}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        {!isInitialPlaylistBootstrapPending && playlistWarnings.length > 0 && (
          <div className="space-y-1 text-xs text-amber-200">
            {playlistWarnings.map((item) => (
              <p key={item}>- {item}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { PlaylistsPanelProps };
