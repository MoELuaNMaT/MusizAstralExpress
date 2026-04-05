import {
  platformIconUrlMap,
  platformNameMap,
  platformBadgeStyleMap,
  songSourceLabelMap,
} from '@/constants/home.constants';
import type { ThemeId } from '@/stores/theme.store';
import type { UnifiedPlaylist } from '@/types';

const PlatformIcon = ({
  platform,
  className = 'h-4 w-4',
}: {
  platform: 'netease' | 'qq' | 'merged';
  className?: string;
}) => (
  platform === 'merged' ? (
    <span className={`inline-flex items-center justify-center rounded-full bg-violet-300/30 text-[10px] font-bold leading-none text-violet-100 ${className}`}>∞</span>
  ) : (
    <img
      src={platformIconUrlMap[platform]}
      alt={platformNameMap[platform]}
      className={`rounded-full bg-white/90 p-[1px] object-cover ${className}`}
      loading="lazy"
    />
  )
);

const PlatformBadge = ({ platform, className = '' }: { platform: 'netease' | 'qq' | 'merged'; className?: string }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${platformBadgeStyleMap[platform]} ${className}`}
  >
    <PlatformIcon platform={platform} />
    <span>{platformNameMap[platform]}</span>
  </span>
);

const SongSourceBadge = ({
  platform,
  theme,
  compact = false,
}: {
  platform: 'netease' | 'qq' | 'merged';
  theme: ThemeId;
  compact?: boolean;
}) => {
  if (theme === 'fallout') {
    return (
      <span className="am-song-source am-song-source-fallout" title={platformNameMap[platform]}>
        {songSourceLabelMap[platform]}
      </span>
    );
  }

  if (theme === 'clay') {
    if (platform === 'merged') {
      return (
        <span className="am-song-source am-song-source-clay text-violet-500" title={platformNameMap[platform]}>
          ∞
        </span>
      );
    }

    return (
      <span className="am-song-source am-song-source-clay" title={platformNameMap[platform]} aria-label={platformNameMap[platform]}>
        <span className={`am-song-source-dot ${platform === 'netease' ? 'am-song-source-dot-netease' : 'am-song-source-dot-qq'}`} />
      </span>
    );
  }

  return <PlatformBadge platform={platform} className={compact ? 'px-1.5 py-0 text-[10px]' : ''} />;
};

const PlaylistPlatformCover = ({ playlist }: { playlist: UnifiedPlaylist }) => {
  if (playlist.platform === 'merged') {
    return (
      <div className="w-14 h-14 rounded-md border border-violet-400/40 bg-violet-500/15 flex items-center justify-center gap-1">
        <PlatformIcon platform="netease" className="h-6 w-6" />
        <PlatformIcon platform="qq" className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-md border border-slate-600 bg-slate-900/70 flex items-center justify-center">
      <PlatformIcon platform={playlist.platform} className="h-8 w-8" />
    </div>
  );
};

export { PlatformIcon, PlatformBadge, SongSourceBadge, PlaylistPlatformCover };
