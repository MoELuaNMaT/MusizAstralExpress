import type { WheelEvent } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SongListRow } from '@/components/home/song-list-row';
import { text } from '@/constants/home.constants';
import type { PanelTab } from '@/constants/home.constants';
import { useSongLikeStore } from '@/stores';
import { getSongLikeKey } from '@/utils/home.utils';
import type { UnifiedSong } from '@/types';

interface HistoryPanelProps {
  isMobileRuntime: boolean;
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  playerHistory: UnifiedSong[];
  clearPlayerHistory: () => void;
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
  onHistoryPlayAt: (index: number) => void;
  onHistoryDoublePlayAt: (index: number) => void;
  onLikeSongAction: (song: UnifiedSong) => void;
  onScrollableWheel: (event: WheelEvent<HTMLElement>) => void;
}

export function HistoryPanel({
  isMobileRuntime,
  panelTab,
  setPanelTab,
  playerHistory,
  clearPlayerHistory,
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
  onHistoryPlayAt,
  onHistoryDoublePlayAt,
  onLikeSongAction,
  onScrollableWheel,
}: HistoryPanelProps) {
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);

  if (panelTab !== 'history') {
    return null;
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{text.historyTitle}</h3>
            <p className="text-sm text-slate-400">{text.historyDesc}</p>
          </div>
          <div className={`items-center gap-2 ${isMobileRuntime ? 'hidden' : 'flex'}`}>
            <Button
              variant="ghost"
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
              variant="primary"
              size="sm"
              onClick={() => setPanelTab('history')}
            >
              {text.panelTabHistory}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">共 {playerHistory.length} 首</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearPlayerHistory}
            disabled={playerHistory.length === 0}
          >
            {text.clearHistory}
          </Button>
        </div>

        {playerHistory.length === 0 ? (
          <div className="am-empty-state">
            <p className="text-sm text-slate-300">{text.noHistorySongs}</p>
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
                      showIndex
                      onSelectSong={onSelectSong}
                      onDoublePlayAt={onHistoryDoublePlayAt}
                      onPlayAt={onHistoryPlayAt}
                      onLikeSong={onLikeSongAction}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { HistoryPanelProps };
