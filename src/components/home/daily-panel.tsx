import type { WheelEvent } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SongListRow } from '@/components/home/song-list-row';
import { PlatformIcon } from '@/components/home/platform-badges';
import { text, type PanelTab, type DailySourceTab } from '@/constants/home.constants';
import { useSongLikeStore } from '@/stores';
import { getSongLikeKey } from '@/utils/home.utils';
import type { UnifiedSong } from '@/types';

interface DailyPanelProps {
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  dailySourceTab: DailySourceTab;
  setDailySourceTab: (tab: DailySourceTab) => void;
  dailySongs: UnifiedSong[];
  dailyNeteaseSongs: UnifiedSong[];
  dailyQQSongs: UnifiedSong[];
  activeDailySongs: UnifiedSong[];
  dailyWarnings: string[];
  dailyError: string | null;
  isDailyLoading: boolean;
  onRefreshDaily: () => void;
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
  onDailyPlayAt: (index: number) => void;
  onDailyDoublePlayAt: (index: number) => void;
  onLikeSongAction: (song: UnifiedSong) => void;
  onScrollableWheel: (event: WheelEvent<HTMLElement>) => void;
}

export function DailyPanel({
  panelTab,
  setPanelTab,
  dailySourceTab,
  setDailySourceTab,
  dailySongs,
  dailyNeteaseSongs,
  dailyQQSongs,
  activeDailySongs,
  dailyWarnings,
  dailyError,
  isDailyLoading,
  onRefreshDaily,
  containerRef,
  measureRef,
  virtualStart,
  totalHeight,
  itemHeight,
  virtualItems,
  playingSongId,
  isPlayerPlaying,
  selectedSongKey,
  doublePlayCueSongKey,
  likingSongIds,
  onSelectSong,
  onDailyPlayAt,
  onDailyDoublePlayAt,
  onLikeSongAction,
  onScrollableWheel,
}: DailyPanelProps) {
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);

  if (panelTab !== 'daily') {
    return null;
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{text.dailyTitle}</h3>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanelTab('playlists')}
            >
              {text.panelTabPlaylists}
            </Button>
            <Button
              variant="primary"
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
              variant="ghost"
              size="sm"
              onClick={() => void onRefreshDaily()}
              disabled={isDailyLoading}
            >
              {text.dailyRefresh}
            </Button>
          </div>
        </div>
        <p className="text-sm text-slate-400">{text.dailyDesc}</p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch gap-4 xl:grid-cols-[260px,1fr]">
          <section
            className="am-song-scrollbar h-full min-h-0 space-y-3 overflow-y-scroll pr-1"
            onWheel={onScrollableWheel}
          >
            <button
              type="button"
              onClick={() => setDailySourceTab('merged')}
              className={`am-touch-target touch-manipulation w-full rounded-lg border px-3 py-3 text-left transition ${
                dailySourceTab === 'merged'
                  ? 'border-blue-400 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/70'
              }`}
            >
              <p className="font-medium inline-flex items-center gap-2">
                <PlatformIcon platform="merged" />
                {text.dailySourceMerged}
              </p>
              <p className="text-xs text-slate-400 mt-1">{dailySongs.length} 首</p>
            </button>
            <button
              type="button"
              onClick={() => setDailySourceTab('netease')}
              className={`am-touch-target touch-manipulation w-full rounded-lg border px-3 py-3 text-left transition ${
                dailySourceTab === 'netease'
                  ? 'border-blue-400 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/70'
              }`}
            >
              <p className="font-medium inline-flex items-center gap-2">
                <PlatformIcon platform="netease" />
                {text.dailySourceNetease}
              </p>
              <p className="text-xs text-slate-400 mt-1">{dailyNeteaseSongs.length} 首</p>
            </button>
            <button
              type="button"
              onClick={() => setDailySourceTab('qq')}
              className={`am-touch-target touch-manipulation w-full rounded-lg border px-3 py-3 text-left transition ${
                dailySourceTab === 'qq'
                  ? 'border-blue-400 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/70'
              }`}
            >
              <p className="font-medium inline-flex items-center gap-2">
                <PlatformIcon platform="qq" />
                {text.dailySourceQQ}
              </p>
              <p className="text-xs text-slate-400 mt-1">{dailyQQSongs.length} 首</p>
            </button>
          </section>

          <section className="min-w-0 h-full min-h-0 overflow-hidden flex flex-col space-y-2">
            {isDailyLoading ? (
              <div className="space-y-2 py-1">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div key={`daily-skeleton-${index}`} className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-2">
                    <Skeleton className="h-14 w-full" />
                  </div>
                ))}
              </div>
            ) : dailyError ? (
              <p className="text-sm text-rose-300">{dailyError}</p>
            ) : activeDailySongs.length === 0 ? (
              <div className="am-empty-state">
                <p className="text-sm text-slate-300">{text.noDailySongsInSource}</p>
              </div>
            ) : (
              <div
                ref={containerRef}
                className="am-song-scrollbar min-h-0 flex-1 overflow-y-scroll pr-1"
                onWheel={onScrollableWheel}
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
                          onSelectSong={onSelectSong}
                          onDoublePlayAt={onDailyDoublePlayAt}
                          onPlayAt={onDailyPlayAt}
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

        {dailyWarnings.length > 0 && (
          <div className="space-y-1 text-xs text-amber-200">
            {dailyWarnings.map((item) => (
              <p key={item}>- {item}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { DailyPanelProps };
