import { memo, type MouseEvent as ReactMouseEvent } from 'react';
import { useThemeStore } from '@/stores';
import { formatDuration } from '@/lib/utils';
import { useCachedCoverUrl } from '@/hooks/useCachedCoverUrl';
import { Button } from '@/components/ui/button';
import { SongSourceBadge } from '@/components/home/platform-badges';
import { DEFAULT_AVATAR } from '@/constants/home.constants';
import type { UnifiedSong } from '@/types';

interface SongListRowProps {
  song: UnifiedSong;
  index: number;
  isLiked: boolean;
  isLiking: boolean;
  isCurrentPlaying: boolean;
  isSelectedSong: boolean;
  isDoublePlayCue: boolean;
  playActionLabel: string;
  playActionIcon: string;
  unknownArtistText: string;
  unknownAlbumText: string;
  compact?: boolean;
  showIndex?: boolean;
  onSelectSong: (song: UnifiedSong) => void;
  onDoublePlayAt: (index: number) => void;
  onPlayAt: (index: number) => void;
  onLikeSong: (song: UnifiedSong) => void;
}

const SongListRow = memo(({
  song,
  index,
  isLiked,
  isLiking,
  isCurrentPlaying,
  isSelectedSong,
  isDoublePlayCue,
  playActionLabel,
  playActionIcon,
  unknownArtistText,
  unknownAlbumText,
  compact = false,
  showIndex = false,
  onSelectSong,
  onDoublePlayAt,
  onPlayAt,
  onLikeSong,
}: SongListRowProps) => {
  const coverUrl = useCachedCoverUrl(song.coverUrl, DEFAULT_AVATAR);
  const theme = useThemeStore((state) => state.theme);

  const handleStopPropagation = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const handlePlayClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onPlayAt(index);
  };

  const handleLikeClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onLikeSong(song);
  };

  return (
    <div
      className={`am-song-row group rounded-lg border px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors duration-100 ${
        isDoublePlayCue
          ? 'am-song-row-doubleplay border-emerald-300/80 bg-emerald-500/10 ring-2 ring-emerald-300/50'
          : isSelectedSong
            ? 'am-song-row-selected border-cyan-300/70 bg-cyan-500/10 ring-1 ring-cyan-300/40'
            : 'am-song-row-idle border-slate-700 bg-slate-900/40 hover:border-violet-300/60 hover:bg-slate-900/70'
      }`}
      onMouseDown={() => onSelectSong(song)}
      onDoubleClick={() => onDoublePlayAt(index)}
      title="单击选中，双击播放"
    >
      {showIndex && <span className="w-8 text-xs text-slate-400 text-right">{index + 1}</span>}
      <img
        src={coverUrl}
        alt={song.name}
        className={`am-song-row-cover ${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded object-cover`}
      />
      <div className="flex-1 min-w-0">
        <p className="am-song-row-title text-sm font-medium truncate">{song.name}</p>
        <p className="am-song-row-meta text-xs text-slate-400 truncate">
          {song.artist || unknownArtistText} - {song.album || unknownAlbumText}
        </p>
        {!compact && (
          <div className="am-song-row-info mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span>{formatDuration(song.duration || 0)}</span>
            <SongSourceBadge platform={song.platform} theme={theme} />
          </div>
        )}
      </div>
      {compact ? (
        <div className="flex items-center gap-1">
          <SongSourceBadge platform={song.platform} theme={theme} compact />
          <p className="text-xs text-slate-400">{formatDuration(song.duration || 0)}</p>
          <Button
            variant={isCurrentPlaying ? 'primary' : 'ghost'}
            size="sm"
            className="am-song-row-play-btn h-7 w-7 p-0 text-sm"
            onMouseDown={handleStopPropagation}
            onClick={handlePlayClick}
            title={playActionLabel}
          >
            {playActionIcon}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`am-song-row-like-btn h-7 w-7 p-0 text-sm ${isLiked ? 'text-rose-400 hover:text-rose-300' : 'text-slate-400 hover:text-rose-300'}`}
            onMouseDown={handleStopPropagation}
            onClick={handleLikeClick}
            disabled={isLiking}
            title={isLiked ? '\u53d6\u6d88\u7ea2\u5fc3' : '\u52a0\u5165\u6211\u559c\u6b22'}
          >
            {isLiking ? '\u2026' : isLiked ? '\u2665' : '\u2661'}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={isCurrentPlaying ? 'primary' : 'ghost'}
            size="sm"
            className="am-song-row-play-btn h-8 w-8 p-0 text-base"
            onMouseDown={handleStopPropagation}
            onClick={handlePlayClick}
            title={playActionLabel}
          >
            {playActionIcon}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`am-song-row-like-btn h-8 w-8 p-0 text-lg ${isLiked ? 'text-rose-400 hover:text-rose-300' : 'text-slate-400 hover:text-rose-300'}`}
            onMouseDown={handleStopPropagation}
            onClick={handleLikeClick}
            disabled={isLiking}
            title={isLiked ? '\u53d6\u6d88\u7ea2\u5fc3' : '\u52a0\u5165\u6211\u559c\u6b22'}
          >
            {isLiking ? '\u2026' : isLiked ? '\u2665' : '\u2661'}
          </Button>
        </div>
      )}
    </div>
  );
});

SongListRow.displayName = 'SongListRow';

export { SongListRow };
export type { SongListRowProps };
