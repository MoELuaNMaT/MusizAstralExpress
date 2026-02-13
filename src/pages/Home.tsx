import { memo, type ChangeEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { libraryService } from '@/services/library.service';
import { formatDuration } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PlayerBar } from '@/components/player/player-bar';
import type { UnifiedPlaylist, UnifiedSong } from '@/types';
import neteasePlatformIcon from '@/assets/platforms/netease.ico';
import qqPlatformIcon from '@/assets/platforms/qq.ico';

const DEFAULT_AVATAR = 'https://p.qlogo.cn/gh/0/0/100';
const NETEASE_LIKED_ORDER_STORAGE_KEY = 'allmusic_netease_liked_order_v1';
const THEME_MODE_STORAGE_KEY = 'allmusic_theme_mode_v1';
const UI_VERSION_STORAGE_KEY = 'allmusic_ui_version_v1';
const LOCAL_API_READY_EVENT = 'allmusic:local-api-ready';
const INITIAL_PLAYLIST_VISIBLE_COUNT = 18;
const PLAYLIST_APPEND_CHUNK_SIZE = 60;

const text = {
  title: 'ALLMusic',
  subtitle: '双平台资源整合（歌单 + 搜索）',
  loading: '正在加载...',
  loginRequired: '请先完成双平台登录后再进入整合页。',
  backToLogin: '返回登录页',
  refresh: '刷新数据',
  logout: '退出',
  connected: '已连接',
  disconnected: '未连接',
  neteaseConnected: '网易云已连接',
  qqConnected: 'QQ 音乐已连接',
  cardNetease: '网易云音乐',
  cardQQ: 'QQ 音乐',
  cardPlaylists: '已整合歌单',
  connectedCount: '已连接平台',
  searchTitle: '统一搜索',
  searchDescription: '同一个关键词同时搜索网易云与 QQ 音乐。',
  searchPlaceholder: '输入歌曲名 / 歌手名，例如：晴天',
  searchBtn: '开始搜索',
  searching: '搜索中',
  playlistsTitle: '整合歌单',
  playlistsDesc: '仅保留各平台我喜欢歌单；当双平台都可用时，新增双平台混合歌单。',
  panelTabPlaylists: '整合歌单',
  panelTabDaily: '每日推荐',
  dailySourceMerged: '双平台推荐',
  dailySourceNetease: '网易云推荐',
  dailySourceQQ: 'QQ 音乐推荐',
  dailyRightTitle: '推荐歌单',
  noDailySongsInSource: '当前推荐源暂无歌曲。',
  loadingPlaylists: '正在加载歌单...',
  noPlaylists: '暂无可展示歌单。',
  unknownCreator: '未知创建者',
  songsUnit: '首',
  detailHint: '点击上方任意歌单，查看歌曲列表。',
  detailRefresh: '仅刷新当前歌单',
  neteaseRebuildWebOrder: '重抓网页顺序',
  neteaseLikedOrderLabel: '网易云我喜欢排序',
  neteaseLikedOrderLatest: '最新优先',
  neteaseLikedOrderEarliest: '最早优先',
  neteaseLikedOrderApi: 'API 原序',
  noSelectedPlaylist: '未选择歌单。',
  loadingDetail: '正在加载歌单详情...',
  noSongsInPlaylist: '该歌单暂无歌曲。',
  searchResultsTitle: '搜索结果',
  searchResultsDesc: '当前最多展示 30 条，按平台交错排序。',
  searchFilterAll: '全部',
  searchFilterNetease: '仅网易云',
  searchFilterQQ: '仅 QQ',
  noFilteredSearchResults: '当前筛选条件下暂无歌曲。',
  dailyTitle: '每日推荐',
  dailyDesc: '仅聚合网易云与 QQ 的个性化推荐。',
  dailyRefresh: '刷新推荐',
  loadingDaily: '正在加载推荐...',
  noDailySongs: '暂无推荐歌曲。',
  loadingSearchResults: '正在加载搜索结果...',
  noSearchResults: '请在上方输入关键词后搜索。',
  unknownArtist: '未知歌手',
  unknownAlbum: '未知专辑',
  enterKeyword: '请先输入搜索关键词。',
  noSongMatched: '未搜索到匹配歌曲。',
  likeSong: '\u7ea2\u5fc3\u6536\u85cf',
  likedSong: '\u5df2\u52a0\u5165\u6211\u559c\u6b22',
  likingSong: '\u5904\u7406\u4e2d...',
  playSong: '播放',
  pauseSong: '暂停',
} as const;

const platformNameMap: Record<'netease' | 'qq' | 'merged', string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  merged: '双平台混合',
};

const playlistTypeNameMap: Record<UnifiedPlaylist['type'], string> = {
  liked: '我喜欢',
  created: '我创建的',
  collected: '我收藏的',
};

const platformBadgeStyleMap: Record<'netease' | 'qq' | 'merged', string> = {
  netease: 'bg-red-500/20 text-red-300 border-red-500/40',
  qq: 'bg-green-500/20 text-green-300 border-green-500/40',
  merged: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
};
const platformIconUrlMap: Record<'netease' | 'qq', string> = {
  netease: neteasePlatformIcon,
  qq: qqPlatformIcon,
};

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
      className={`group rounded-lg border px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors duration-100 ${
        isDoublePlayCue
          ? 'border-emerald-300/80 bg-emerald-500/10 ring-2 ring-emerald-300/50'
          : isSelectedSong
            ? 'border-cyan-300/70 bg-cyan-500/10 ring-1 ring-cyan-300/40'
            : 'border-slate-700 bg-slate-900/40 hover:border-violet-300/60 hover:bg-slate-900/70'
      }`}
      onMouseDown={() => onSelectSong(song)}
      onDoubleClick={() => onDoublePlayAt(index)}
      title="单击选中，双击播放"
    >
      {showIndex && <span className="w-8 text-xs text-slate-400 text-right">{index + 1}</span>}
      <img
        src={song.coverUrl || DEFAULT_AVATAR}
        alt={song.name}
        className={`${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded object-cover`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{song.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {song.artist || unknownArtistText} - {song.album || unknownAlbumText}
        </p>
        {!compact && (
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span>{formatDuration(song.duration || 0)}</span>
            <PlatformBadge platform={song.platform} />
          </div>
        )}
        <p className={`mt-1 text-[11px] truncate transition ${
          isDoublePlayCue
            ? 'text-emerald-200'
            : isSelectedSong
              ? 'text-cyan-200'
              : 'text-slate-500 group-hover:text-slate-300'
        }`}
        >
          {isDoublePlayCue ? '已双击播放' : isSelectedSong ? '已选中（双击播放）' : '单击选中 · 双击播放'}
        </p>
      </div>
      {compact ? (
        <div className="flex items-center gap-1">
          <PlatformBadge platform={song.platform} />
          <p className="text-xs text-slate-400">{formatDuration(song.duration || 0)}</p>
          <Button
            variant={isCurrentPlaying ? 'primary' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0 text-sm"
            onMouseDown={handleStopPropagation}
            onClick={handlePlayClick}
            title={playActionLabel}
          >
            {playActionIcon}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 w-7 p-0 text-sm ${isLiked ? 'text-rose-400 hover:text-rose-300' : 'text-slate-400 hover:text-rose-300'}`}
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
            className="h-8 w-8 p-0 text-base"
            onMouseDown={handleStopPropagation}
            onClick={handlePlayClick}
            title={playActionLabel}
          >
            {playActionIcon}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 text-lg ${isLiked ? 'text-rose-400 hover:text-rose-300' : 'text-slate-400 hover:text-rose-300'}`}
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

const isNumericId = (value: string): boolean => /^\d+$/.test(value.trim());
type NeteaseLikedOrder = 'latest' | 'earliest' | 'api';
type SearchPlatformFilter = 'all' | 'netease' | 'qq';
type PanelTab = 'playlists' | 'daily';
type DailySourceTab = 'merged' | 'netease' | 'qq';
type ThemeMode = 'night' | 'day';
type UiVersion = 'current' | 'v4-glam';
type UiBridge = {
  switchUiVersion?: (next: UiVersion) => Promise<void>;
};

function resolveUiBridge(): UiBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridge = (window as Window & { __ALLMUSIC_BRIDGE__?: UiBridge }).__ALLMUSIC_BRIDGE__;
  return bridge || null;
}

const isNeteaseLikedOrder = (value: string | null): value is NeteaseLikedOrder => (
  value === 'latest' || value === 'earliest' || value === 'api'
);

const resolveQQSongIdentity = (song: Pick<UnifiedSong, 'originalId' | 'qqSongId' | 'qqSongMid'>): { songId: string; songMid: string } => {
  const originalId = song.originalId.trim();
  const songId = (song.qqSongId || '').trim() || (isNumericId(originalId) ? originalId : '');
  const songMid = (song.qqSongMid || '').trim() || (!isNumericId(originalId) ? originalId : '');
  return { songId, songMid };
};

const getSongLikeKey = (song: Pick<UnifiedSong, 'platform' | 'originalId' | 'qqSongId' | 'qqSongMid'>): string => {
  if (song.platform !== 'qq') {
    return `${song.platform}:${song.originalId}`;
  }

  const identity = resolveQQSongIdentity(song);
  if (identity.songId) {
    return `qq:id:${identity.songId}`;
  }
  if (identity.songMid) {
    return `qq:mid:${identity.songMid}`;
  }
  return `qq:raw:${song.originalId}`;
};

export function HomePage() {
  const { users, cookies, isAuthenticated, isLoading, removeUser } = useAuthStore();
  const playingSongId = usePlayerStore((state) => state.currentSong?.id || null);
  const playerQueue = usePlayerStore((state) => state.queue);
  const playerCurrentIndex = usePlayerStore((state) => state.currentIndex);
  const isPlayerPlaying = usePlayerStore((state) => state.isPlaying);
  const setPlayerQueue = usePlayerStore((state) => state.setQueue);
  const setPlayerIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  const togglePlayerPlay = usePlayerStore((state) => state.togglePlay);

  const [mounted, setMounted] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'night';
    }
    return window.localStorage.getItem(THEME_MODE_STORAGE_KEY) === 'day' ? 'day' : 'night';
  });
  const [panelTab, setPanelTab] = useState<PanelTab>('playlists');
  const [dailySourceTab, setDailySourceTab] = useState<DailySourceTab>('merged');
  const [playlists, setPlaylists] = useState<UnifiedPlaylist[]>([]);
  const [playlistWarnings, setPlaylistWarnings] = useState<string[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<UnifiedSong[]>([]);
  const [searchPlatformFilter, setSearchPlatformFilter] = useState<SearchPlatformFilter>('all');
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [dailySongs, setDailySongs] = useState<UnifiedSong[]>([]);
  const [dailyWarnings, setDailyWarnings] = useState<string[]>([]);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [isDailyLoading, setIsDailyLoading] = useState(false);
  const [likingSongIds, setLikingSongIds] = useState<Record<string, boolean>>({});
  const [likeActionMessage, setLikeActionMessage] = useState<string | null>(null);
  const [likeActionError, setLikeActionError] = useState<string | null>(null);
  const [selectedSongKey, setSelectedSongKey] = useState<string | null>(null);
  const [doublePlayCueSongKey, setDoublePlayCueSongKey] = useState<string | null>(null);

  const [selectedPlaylist, setSelectedPlaylist] = useState<UnifiedPlaylist | null>(null);
  const [playlistDetailSongs, setPlaylistDetailSongs] = useState<UnifiedSong[]>([]);
  const [visiblePlaylistSongCount, setVisiblePlaylistSongCount] = useState(INITIAL_PLAYLIST_VISIBLE_COUNT);
  const [playlistDetailError, setPlaylistDetailError] = useState<string | null>(null);
  const [playlistDetailInfo, setPlaylistDetailInfo] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [neteaseLikedOrder, setNeteaseLikedOrder] = useState<NeteaseLikedOrder>(() => {
    if (typeof window === 'undefined') {
      return 'latest';
    }

    const storedOrder = window.localStorage.getItem(NETEASE_LIKED_ORDER_STORAGE_KEY);
    return isNeteaseLikedOrder(storedOrder) ? storedOrder : 'latest';
  });
  const selectedPlaylistIdRef = useRef<string | null>(null);
  const detailRequestSeqRef = useRef(0);
  const progressivePlaylistRenderTimerRef = useRef<number | null>(null);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceTimerRef = useRef<number | null>(null);
  const doublePlayCueTimerRef = useRef<number | null>(null);
  const localApiReadyRefreshAtRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    selectedPlaylistIdRef.current = selectedPlaylist?.id ?? null;
  }, [selectedPlaylist?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(NETEASE_LIKED_ORDER_STORAGE_KEY, neteaseLikedOrder);
  }, [neteaseLikedOrder]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    if (themeMode === 'day') {
      document.body.classList.add('am-theme-day');
    } else {
      document.body.classList.remove('am-theme-day');
    }
  }, [themeMode]);

  useEffect(() => {
    if (!isSearchDropdownOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(target)) {
        setIsSearchDropdownOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchDropdownOpen(false);
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isSearchDropdownOpen]);

  useEffect(() => () => {
    if (doublePlayCueTimerRef.current !== null) {
      window.clearTimeout(doublePlayCueTimerRef.current);
      doublePlayCueTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (progressivePlaylistRenderTimerRef.current !== null) {
      window.clearTimeout(progressivePlaylistRenderTimerRef.current);
      progressivePlaylistRenderTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (progressivePlaylistRenderTimerRef.current !== null) {
      window.clearTimeout(progressivePlaylistRenderTimerRef.current);
      progressivePlaylistRenderTimerRef.current = null;
    }

    const total = playlistDetailSongs.length;
    const initialCount = Math.min(INITIAL_PLAYLIST_VISIBLE_COUNT, total);
    setVisiblePlaylistSongCount(initialCount);

    if (total <= initialCount) {
      return;
    }

    const appendChunk = () => {
      setVisiblePlaylistSongCount((prev) => {
        const next = Math.min(total, prev + PLAYLIST_APPEND_CHUNK_SIZE);
        if (next < total) {
          progressivePlaylistRenderTimerRef.current = window.setTimeout(appendChunk, 16);
        } else {
          progressivePlaylistRenderTimerRef.current = null;
        }
        return next;
      });
    };

    progressivePlaylistRenderTimerRef.current = window.setTimeout(appendChunk, 36);

    return () => {
      if (progressivePlaylistRenderTimerRef.current !== null) {
        window.clearTimeout(progressivePlaylistRenderTimerRef.current);
        progressivePlaylistRenderTimerRef.current = null;
      }
    };
  }, [playlistDetailSongs]);

  const filteredSearchResults = useMemo(() => {
    if (searchPlatformFilter === 'all') {
      return searchResults;
    }
    return searchResults.filter((song) => song.platform === searchPlatformFilter);
  }, [searchPlatformFilter, searchResults]);
  const dailyNeteaseSongs = useMemo(
    () => dailySongs.filter((song) => song.platform === 'netease'),
    [dailySongs],
  );
  const dailyQQSongs = useMemo(
    () => dailySongs.filter((song) => song.platform === 'qq'),
    [dailySongs],
  );
  const activeDailySongs = useMemo(() => {
    if (dailySourceTab === 'netease') {
      return dailyNeteaseSongs;
    }
    if (dailySourceTab === 'qq') {
      return dailyQQSongs;
    }
    return dailySongs;
  }, [dailyNeteaseSongs, dailyQQSongs, dailySongs, dailySourceTab]);
  const visiblePlaylistDetailSongs = useMemo(
    () => playlistDetailSongs.slice(0, visiblePlaylistSongCount),
    [playlistDetailSongs, visiblePlaylistSongCount],
  );
  const dailySourceTitle = useMemo(() => {
    if (dailySourceTab === 'netease') {
      return text.dailySourceNetease;
    }
    if (dailySourceTab === 'qq') {
      return text.dailySourceQQ;
    }
    return text.dailySourceMerged;
  }, [dailySourceTab]);

  const loadPlaylists = useCallback(async () => {
    setIsPlaylistLoading(true);
    setPlaylistError(null);

    try {
      const result = await libraryService.loadUnifiedPlaylists({
        neteaseUserId: users.netease?.userId,
        neteaseCookie: cookies.netease,
        qqUserId: users.qq?.userId,
        qqCookie: cookies.qq,
      });

      setPlaylists(result.playlists);
      setPlaylistWarnings(result.warnings);

      if (result.playlists.length === 0 && result.warnings.length > 0) {
        setPlaylistError(result.warnings[0]);
      }

      const currentSelectedId = selectedPlaylistIdRef.current;
      if (currentSelectedId) {
        const latestSelected = result.playlists.find((item) => item.id === currentSelectedId) || null;
        if (!latestSelected) {
          selectedPlaylistIdRef.current = null;
          setSelectedPlaylist(null);
          setPlaylistDetailSongs([]);
          setPlaylistDetailError(null);
          setPlaylistDetailInfo(null);
        } else {
          setSelectedPlaylist(latestSelected);
        }
      }

      return result;
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId]);

  const loadDailyRecommendations = useCallback(async () => {
    setIsDailyLoading(true);
    setDailyError(null);

    try {
      const result = await libraryService.loadDailyRecommendations({
        neteaseUserId: users.netease?.userId,
        neteaseCookie: cookies.netease,
        qqUserId: users.qq?.userId,
        qqCookie: cookies.qq,
      });

      setDailySongs(result.songs);
      setDailyWarnings(result.warnings);
      if (result.songs.length === 0 && result.warnings.length > 0) {
        setDailyError(result.warnings[0]);
      }
    } finally {
      setIsDailyLoading(false);
    }
  }, [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId]);

  useEffect(() => {
    if (!mounted || !isAuthenticated) {
      return;
    }

    void loadPlaylists();
    void loadDailyRecommendations();
  }, [mounted, isAuthenticated, loadDailyRecommendations, loadPlaylists]);

  const loadPlaylistDetail = useCallback(
    async (
      playlist: UnifiedPlaylist,
      options?: { neteaseLikedOrder?: NeteaseLikedOrder; forceRefreshNeteaseWebOrder?: boolean },
    ) => {
      const requestSeq = detailRequestSeqRef.current + 1;
      detailRequestSeqRef.current = requestSeq;
      const likedOrder = options?.neteaseLikedOrder || neteaseLikedOrder;

      selectedPlaylistIdRef.current = playlist.id;
      setSelectedPlaylist(playlist);
      setPlaylistDetailError(null);
      setPlaylistDetailInfo(null);
      setPlaylistDetailSongs([]);
      setIsDetailLoading(true);

      try {
        const detail = await libraryService.loadPlaylistDetail(playlist, {
          neteaseUserId: users.netease?.userId,
          neteaseCookie: cookies.netease,
          neteaseLikedOrder: likedOrder,
          qqUserId: users.qq?.userId,
          forceRefreshNeteaseWebOrder: Boolean(options?.forceRefreshNeteaseWebOrder),
          qqCookie: cookies.qq,
        });

        if (detailRequestSeqRef.current !== requestSeq || selectedPlaylistIdRef.current !== playlist.id) {
          return;
        }

        setPlaylistDetailSongs(detail.songs);
        setPlaylistDetailError(detail.warning || null);
        setPlaylistDetailInfo(detail.info || null);
        setPlaylists((prev) => prev.map((item) => (
          item.id === playlist.id
            ? { ...item, songCount: detail.songs.length }
            : item
        )));
      } catch (error) {
        if (detailRequestSeqRef.current !== requestSeq || selectedPlaylistIdRef.current !== playlist.id) {
          return;
        }

        const message = error instanceof Error ? error.message : '歌单详情加载失败，请稍后重试。';
        setPlaylistDetailError(message);
      } finally {
        if (detailRequestSeqRef.current === requestSeq && selectedPlaylistIdRef.current === playlist.id) {
          setIsDetailLoading(false);
        }
      }
    },
    [cookies.netease, cookies.qq, neteaseLikedOrder, users.netease?.userId, users.qq?.userId],
  );

  useEffect(() => {
    if (!mounted || !isAuthenticated || selectedPlaylist || isPlaylistLoading || playlists.length === 0) {
      return;
    }

    const preferredPlaylist = playlists.find((item) => item.platform === 'merged') ?? playlists[0];
    void loadPlaylistDetail(preferredPlaylist);
  }, [isAuthenticated, isPlaylistLoading, loadPlaylistDetail, mounted, playlists, selectedPlaylist]);

  const executeSearch = useCallback(
    async (nextKeyword: string) => {
      const trimmedKeyword = nextKeyword.trim();
      if (!trimmedKeyword) {
        setSearchError(text.enterKeyword);
        setSearchResults([]);
        setSearchWarnings([]);
        return;
      }

      setIsSearching(true);
      setSearchError(null);
      setLikeActionMessage(null);
      setLikeActionError(null);

      try {
        const result = await libraryService.searchUnifiedSongs(trimmedKeyword, {
          neteaseUserId: users.netease?.userId,
          neteaseCookie: cookies.netease,
          qqUserId: users.qq?.userId,
          qqCookie: cookies.qq,
        });

        setSearchResults(result.songs);
        setSearchWarnings(result.warnings);

        if (result.songs.length === 0) {
          if (result.warnings.length > 0) {
            setSearchError(result.warnings[0]);
          } else {
            setSearchError(text.noSongMatched);
          }
        }
      } finally {
        setIsSearching(false);
      }
    },
    [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId],
  );

  useEffect(() => {
    if (!isSearchDropdownOpen) {
      return;
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      if (searchDebounceTimerRef.current !== null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
      setSearchResults([]);
      setSearchWarnings([]);
      setSearchError(null);
      return;
    }

    if (searchDebounceTimerRef.current !== null) {
      window.clearTimeout(searchDebounceTimerRef.current);
    }

    searchDebounceTimerRef.current = window.setTimeout(() => {
      void executeSearch(trimmedKeyword);
    }, 300);

    return () => {
      if (searchDebounceTimerRef.current !== null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
    };
  }, [executeSearch, isSearchDropdownOpen, keyword]);

  const refreshCurrentView = useCallback(
    async ({ includeSearch = true, includeDaily = true }: { includeSearch?: boolean; includeDaily?: boolean } = {}) => {
      const playlistResult = await loadPlaylists();
      const selectedPlaylistId = selectedPlaylistIdRef.current;
      if (selectedPlaylistId) {
        const latestSelected = playlistResult.playlists.find((item) => item.id === selectedPlaylistId);
        if (latestSelected) {
          await loadPlaylistDetail(latestSelected);
        }
      }

      if (includeSearch && keyword.trim()) {
        await executeSearch(keyword);
      }
      if (includeDaily) {
        await loadDailyRecommendations();
      }
    },
    [executeSearch, keyword, loadDailyRecommendations, loadPlaylistDetail, loadPlaylists],
  );

  useEffect(() => {
    if (!mounted || !isAuthenticated) {
      return;
    }

    const onLocalApiReady = () => {
      const now = Date.now();
      if (now - localApiReadyRefreshAtRef.current < 1500) {
        return;
      }
      localApiReadyRefreshAtRef.current = now;
      void refreshCurrentView({ includeSearch: false, includeDaily: true });
    };

    window.addEventListener(LOCAL_API_READY_EVENT, onLocalApiReady);
    return () => {
      window.removeEventListener(LOCAL_API_READY_EVENT, onLocalApiReady);
    };
  }, [isAuthenticated, mounted, refreshCurrentView]);

  const handleLikeSong = useCallback(
    async (song: UnifiedSong) => {
      const songKey = getSongLikeKey(song);
      if (likingSongIds[songKey]) {
        return;
      }

      const targetLike = !Boolean(song.isLiked);
      setLikeActionMessage(null);
      setLikeActionError(null);
      setLikingSongIds((prev) => ({ ...prev, [songKey]: true }));

      try {
        const result = await libraryService.likeSong(
          song,
          {
            neteaseCookie: cookies.netease,
            qqCookie: cookies.qq,
          },
          targetLike,
        );

        if (!result.success) {
          setLikeActionError(result.warning || '操作失败，请稍后重试。');
          return;
        }

        const platformName = platformNameMap[song.platform];
        const actionLabel = targetLike ? '已加入我喜欢' : '已取消我喜欢';
        setLikeActionMessage(
          result.warning
            ? `${platformName}${actionLabel}（${result.warning}）`
            : `${platformName}${actionLabel}`,
        );

        await refreshCurrentView();
      } catch (error) {
        setLikeActionError(error instanceof Error ? error.message : '操作失败，请稍后重试。');
      } finally {
        setLikingSongIds((prev) => {
          const next = { ...prev };
          delete next[songKey];
          return next;
        });
      }
    },
    [cookies.netease, cookies.qq, likingSongIds, refreshCurrentView],
  );

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSearchDropdownOpen(true);
    if (searchDebounceTimerRef.current !== null) {
      window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    await executeSearch(keyword);
  };

  const handlePlaySong = useCallback((songs: UnifiedSong[], index: number, options?: { forcePlay?: boolean }) => {
    if (index < 0 || index >= songs.length) {
      return;
    }

    const targetSong = songs[index];
    const currentQueueSong = playerCurrentIndex >= 0 ? playerQueue[playerCurrentIndex] : null;
    const isSameSongInCurrentQueue = Boolean(currentQueueSong && currentQueueSong.id === targetSong.id);
    const forcePlay = Boolean(options?.forcePlay);

    if (isSameSongInCurrentQueue && playingSongId === targetSong.id) {
      if (forcePlay) {
        setPlayerIsPlaying(true);
      } else {
        togglePlayerPlay();
      }
      return;
    }

    setPlayerQueue(songs, index);
    setPlayerIsPlaying(true);
  }, [
    playerCurrentIndex,
    playerQueue,
    playingSongId,
    setPlayerIsPlaying,
    setPlayerQueue,
    togglePlayerPlay,
  ]);

  const handleSelectSong = useCallback((song: UnifiedSong) => {
    setSelectedSongKey(getSongLikeKey(song));
  }, []);

  const handleDoublePlaySong = useCallback((songs: UnifiedSong[], index: number) => {
    if (index < 0 || index >= songs.length) {
      return;
    }

    const targetSong = songs[index];
    const songKey = getSongLikeKey(targetSong);
    setSelectedSongKey(songKey);
    setDoublePlayCueSongKey(songKey);

    if (doublePlayCueTimerRef.current !== null) {
      window.clearTimeout(doublePlayCueTimerRef.current);
    }
    doublePlayCueTimerRef.current = window.setTimeout(() => {
      setDoublePlayCueSongKey((prev) => (prev === songKey ? null : prev));
      doublePlayCueTimerRef.current = null;
    }, 520);

    handlePlaySong(songs, index, { forcePlay: true });
  }, [handlePlaySong]);

  const handleLikeSongAction = useCallback((song: UnifiedSong) => {
    void handleLikeSong(song);
  }, [handleLikeSong]);

  const handleSearchPlayAt = useCallback((index: number) => {
    handlePlaySong(filteredSearchResults, index);
  }, [filteredSearchResults, handlePlaySong]);

  const handleSearchDoublePlayAt = useCallback((index: number) => {
    handleDoublePlaySong(filteredSearchResults, index);
  }, [filteredSearchResults, handleDoublePlaySong]);

  const handleDetailPlayAt = useCallback((index: number) => {
    handlePlaySong(playlistDetailSongs, index);
  }, [handlePlaySong, playlistDetailSongs]);

  const handleDetailDoublePlayAt = useCallback((index: number) => {
    handleDoublePlaySong(playlistDetailSongs, index);
  }, [handleDoublePlaySong, playlistDetailSongs]);

  const handleDailyPlayAt = useCallback((index: number) => {
    handlePlaySong(activeDailySongs, index);
  }, [activeDailySongs, handlePlaySong]);

  const handleDailyDoublePlayAt = useCallback((index: number) => {
    handleDoublePlaySong(activeDailySongs, index);
  }, [activeDailySongs, handleDoublePlaySong]);

  const handleRefresh = async () => {
    await refreshCurrentView();
  };

  const handleSwitchToV4 = useCallback(async () => {
    const bridge = resolveUiBridge();
    if (bridge && typeof bridge.switchUiVersion === 'function') {
      await bridge.switchUiVersion('v4-glam');
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_VERSION_STORAGE_KEY, 'v4-glam');
      window.location.reload();
    }
  }, []);

  const handleRefreshDaily = async () => {
    await loadDailyRecommendations();
  };

  const handleScrollableWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    const container = event.currentTarget;
    if (container.scrollHeight <= container.clientHeight) {
      return;
    }

    const baseDelta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * container.clientHeight
        : event.deltaY;

    if (!Number.isFinite(baseDelta) || baseDelta === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    container.scrollTop += baseDelta;
  }, []);

  const handleRefreshCurrentDetail = async () => {
    if (!selectedPlaylist) {
      return;
    }

    await loadPlaylistDetail(selectedPlaylist);
  };

  const handleForceRefreshNeteaseWebOrder = async () => {
    if (!selectedPlaylist || selectedPlaylist.platform !== 'netease' || selectedPlaylist.type !== 'liked') {
      return;
    }

    await loadPlaylistDetail(selectedPlaylist, { forceRefreshNeteaseWebOrder: true });
  };

  const isNeteaseLikedPlaylistSelected = Boolean(
    selectedPlaylist
    && selectedPlaylist.platform === 'netease'
    && selectedPlaylist.type === 'liked',
  );

  const handleNeteaseLikedOrderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextOrder = event.target.value;
    if (!isNeteaseLikedOrder(nextOrder) || nextOrder === neteaseLikedOrder) {
      return;
    }

    setNeteaseLikedOrder(nextOrder);

    if (selectedPlaylist && selectedPlaylist.platform === 'netease' && selectedPlaylist.type === 'liked') {
      void loadPlaylistDetail(selectedPlaylist, { neteaseLikedOrder: nextOrder });
    }
  };

  if (!mounted || isLoading) {
    return (
      <div className="am-screen h-screen flex items-center justify-center">
        <div className="text-slate-300 flex items-center gap-2">
          <Spinner size="sm" />
          <span>{text.loading}</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="am-screen h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-slate-300 space-y-4">
            <p>{text.loginRequired}</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {text.backToLogin}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="am-screen h-screen overflow-hidden flex flex-col text-white">
      <div className="am-spark-layer" aria-hidden="true">
        <span className="am-spark am-spark-pink" style={{ left: '6%', top: '11%', animationDuration: '2.8s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '18%', top: '26%', animationDuration: '3.1s' }} />
        <span className="am-spark am-spark-violet" style={{ left: '34%', top: '13%', animationDuration: '2.2s' }} />
        <span className="am-spark am-spark-pink" style={{ left: '62%', top: '18%', animationDuration: '2.5s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '78%', top: '9%', animationDuration: '2.9s' }} />
        <span className="am-spark am-spark-violet" style={{ left: '12%', top: '68%', animationDuration: '2.4s' }} />
        <span className="am-spark am-spark-pink" style={{ left: '57%', top: '76%', animationDuration: '2.1s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '88%', top: '72%', animationDuration: '2.7s' }} />
      </div>

      <header className="relative z-[80] shrink-0 border-b border-white/15 bg-slate-900/35 backdrop-blur">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 items-center gap-3">
              <h1 className="am-title-gradient text-2xl font-bold">
                {text.title}
              </h1>
              <p className="hidden text-xs text-slate-400 2xl:block">{text.subtitle}</p>
            </div>

            <div ref={searchDropdownRef} className="relative mx-auto flex min-w-0 max-w-4xl flex-1 items-center gap-2">
              <form onSubmit={handleSearch} className="flex w-full items-center gap-2">
                <Input
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value);
                    setIsSearchDropdownOpen(true);
                  }}
                  onFocus={() => setIsSearchDropdownOpen(true)}
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
                        onClick={() => setSearchPlatformFilter('all')}
                      >
                        {text.searchFilterAll}
                      </Button>
                      <Button
                        variant={searchPlatformFilter === 'netease' ? 'primary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSearchPlatformFilter('netease')}
                      >
                        {text.searchFilterNetease}
                      </Button>
                      <Button
                        variant={searchPlatformFilter === 'qq' ? 'primary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSearchPlatformFilter('qq')}
                      >
                        {text.searchFilterQQ}
                      </Button>
                    </div>
                  </div>

                  {searchError && <p className="mb-2 text-sm text-rose-300">{searchError}</p>}
                  {searchWarnings.length > 0 && (
                    <div className="mb-2 space-y-1 text-xs text-amber-200">
                      {searchWarnings.map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                    </div>
                  )}

                  {isSearching ? (
                    <div className="py-6 text-slate-300 flex items-center justify-center gap-2">
                      <Spinner size="sm" />
                      <span>{text.loadingSearchResults}</span>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <p className="text-sm text-slate-400">{text.noSearchResults}</p>
                  ) : filteredSearchResults.length === 0 ? (
                    <p className="text-sm text-slate-400">{text.noFilteredSearchResults}</p>
                  ) : (
                    <div className="am-song-scrollbar space-y-2 max-h-[360px] overflow-y-scroll pr-1">
                      {filteredSearchResults.map((song, index) => {
                        const likeKey = getSongLikeKey(song);
                        const isLiked = Boolean(song.isLiked);
                        const isLiking = Boolean(likingSongIds[likeKey]);
                        const isCurrentPlaying = playingSongId === song.id;
                        const isSelectedSong = selectedSongKey === likeKey;
                        const isDoublePlayCue = doublePlayCueSongKey === likeKey;
                        const playActionLabel = isCurrentPlaying && isPlayerPlaying ? text.pauseSong : text.playSong;
                        const playActionIcon = isCurrentPlaying && isPlayerPlaying ? '\u23f8' : '\u25b6';

                        return (
                          <SongListRow
                            key={song.id}
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
                            onSelectSong={handleSelectSong}
                            onDoublePlayAt={handleSearchDoublePlayAt}
                            onPlayAt={handleSearchPlayAt}
                            onLikeSong={handleLikeSongAction}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs">
              {users.netease && (
                <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-1.5 py-1">
                  <img src={users.netease.avatarUrl || DEFAULT_AVATAR} alt={users.netease.nickname} className="h-6 w-6 rounded-full" />
                  <span className="max-w-40 truncate text-[11px] text-slate-200">网易云 · 已连接 · {users.netease.nickname}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeUser('netease')} className="h-6 px-2 text-[11px]">
                    {text.logout}
                  </Button>
                </div>
              )}

              {users.qq && (
                <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-1.5 py-1">
                  <img src={users.qq.avatarUrl || DEFAULT_AVATAR} alt={users.qq.nickname} className="h-6 w-6 rounded-full" />
                  <span className="max-w-40 truncate text-[11px] text-slate-200">QQ · 已连接 · {users.qq.nickname}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeUser('qq')} className="h-6 px-2 text-[11px]">
                    {text.logout}
                  </Button>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSwitchToV4()}
                className="shrink-0"
                title="切换到 V4 UI"
              >
                ✨ V4 UI
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setThemeMode((prev) => (prev === 'night' ? 'day' : 'night'))}
                className="shrink-0"
                title={themeMode === 'night' ? '切换到白天模式' : '切换到夜间模式'}
              >
                {themeMode === 'night' ? '☀ 白天' : '🌙 夜间'}
              </Button>

              <Button variant="default" size="sm" onClick={handleRefresh} disabled={isPlaylistLoading || isSearching || isDetailLoading || isDailyLoading} className="shrink-0">
                {text.refresh}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4 pb-36">
        {likeActionError && <p className="text-sm text-rose-300">{likeActionError}</p>}
        {likeActionMessage && <p className="text-sm text-emerald-300">{likeActionMessage}</p>}

        {panelTab === 'playlists' && (
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{text.playlistsTitle}</h3>
                <p className="text-sm text-slate-400">{text.playlistsDesc}</p>
              </div>
              <div className="flex items-center gap-2">
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-base font-semibold truncate">{selectedPlaylist ? selectedPlaylist.name : text.detailHint}</p>
                {playlistDetailInfo && !playlistDetailError && (
                  <p className="mt-1 text-xs text-amber-200">{playlistDetailInfo}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                {isNeteaseLikedPlaylistSelected && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <span>{text.neteaseLikedOrderLabel}</span>
                      <select
                        value={neteaseLikedOrder}
                        onChange={handleNeteaseLikedOrderChange}
                        disabled={isDetailLoading}
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
                      onClick={() => void handleForceRefreshNeteaseWebOrder()}
                      disabled={isDetailLoading}
                    >
                      {text.neteaseRebuildWebOrder}
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRefreshCurrentDetail()}
                  disabled={!selectedPlaylist || isDetailLoading}
                >
                  {text.detailRefresh}
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch gap-4 xl:grid-cols-[340px,1fr]">
              <section
                className="am-song-scrollbar h-full min-h-0 space-y-3 overflow-y-scroll pr-1"
                onWheel={handleScrollableWheel}
                onWheelCapture={handleScrollableWheel}
              >
                {isPlaylistLoading ? (
                  <div className="py-10 text-slate-300 flex items-center justify-center gap-2">
                    <Spinner size="sm" />
                    <span>{text.loadingPlaylists}</span>
                  </div>
                ) : playlistError ? (
                  <p className="text-sm text-rose-300">{playlistError}</p>
                ) : playlists.length === 0 ? (
                  <p className="text-sm text-slate-400">{text.noPlaylists}</p>
                ) : (
                  playlists.map((playlist) => {
                    const selected = selectedPlaylist?.id === playlist.id;

                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => void loadPlaylistDetail(playlist)}
                        className={`w-full rounded-lg border px-3 py-3 flex items-center gap-3 text-left transition ${
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
                {!selectedPlaylist ? (
                  <p className="text-sm text-slate-400">{text.noSelectedPlaylist}</p>
                ) : isDetailLoading ? (
                  <div className="py-10 text-slate-300 flex items-center justify-center gap-2">
                    <Spinner size="sm" />
                    <span>{text.loadingDetail}</span>
                  </div>
                ) : playlistDetailError ? (
                  <p className="text-sm text-rose-300">{playlistDetailError}</p>
                ) : playlistDetailSongs.length === 0 ? (
                  <p className="text-sm text-slate-400">{text.noSongsInPlaylist}</p>
                ) : (
                  <div
                    className="am-song-scrollbar min-h-0 flex-1 overflow-y-scroll pr-1 space-y-2"
                    onWheel={handleScrollableWheel}
                    onWheelCapture={handleScrollableWheel}
                  >
                    {visiblePlaylistDetailSongs.map((song, index) => {
                      const likeKey = getSongLikeKey(song);
                      const isLiked = Boolean(song.isLiked);
                      const isLiking = Boolean(likingSongIds[likeKey]);
                      const isCurrentPlaying = playingSongId === song.id;
                      const isSelectedSong = selectedSongKey === likeKey;
                      const isDoublePlayCue = doublePlayCueSongKey === likeKey;
                      const playActionLabel = isCurrentPlaying && isPlayerPlaying ? text.pauseSong : text.playSong;
                      const playActionIcon = isCurrentPlaying && isPlayerPlaying ? '\u23f8' : '\u25b6';

                      return (
                        <SongListRow
                          key={`${song.id}_${index}`}
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
                          onSelectSong={handleSelectSong}
                          onDoublePlayAt={handleDetailDoublePlayAt}
                          onPlayAt={handleDetailPlayAt}
                          onLikeSong={handleLikeSongAction}
                        />
                      );
                    })}
                    {visiblePlaylistSongCount < playlistDetailSongs.length && (
                      <p className="px-2 py-1 text-center text-xs text-slate-400">
                        正在继续加载歌曲...（{visiblePlaylistSongCount}/{playlistDetailSongs.length}）
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            {playlistWarnings.length > 0 && (
              <div className="space-y-1 text-xs text-amber-200">
                {playlistWarnings.map((item) => (
                  <p key={item}>- {item}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {panelTab === 'daily' && (
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{text.dailyTitle}</h3>
                <p className="text-sm text-slate-400">{text.dailyDesc}</p>
              </div>
              <div className="flex items-center gap-2">
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-semibold truncate">{text.dailyRightTitle} 路 {dailySourceTitle}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRefreshDaily()}
                disabled={isDailyLoading}
              >
                {text.dailyRefresh}
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch gap-4 xl:grid-cols-[260px,1fr]">
              <section
                className="am-song-scrollbar h-full min-h-0 space-y-3 overflow-y-scroll pr-1"
                onWheel={handleScrollableWheel}
                onWheelCapture={handleScrollableWheel}
              >
                <button
                  type="button"
                  onClick={() => setDailySourceTab('merged')}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
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
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
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
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
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
                  <div className="py-10 text-slate-300 flex items-center justify-center gap-2">
                    <Spinner size="sm" />
                    <span>{text.loadingDaily}</span>
                  </div>
                ) : dailyError ? (
                  <p className="text-sm text-rose-300">{dailyError}</p>
                ) : activeDailySongs.length === 0 ? (
                  <p className="text-sm text-slate-400">{text.noDailySongsInSource}</p>
                ) : (
                  <div
                    className="am-song-scrollbar min-h-0 flex-1 overflow-y-scroll pr-1 space-y-2"
                    onWheel={handleScrollableWheel}
                    onWheelCapture={handleScrollableWheel}
                  >
                    {activeDailySongs.map((song, index) => {
                      const likeKey = getSongLikeKey(song);
                      const isLiked = Boolean(song.isLiked);
                      const isLiking = Boolean(likingSongIds[likeKey]);
                      const isCurrentPlaying = playingSongId === song.id;
                      const isSelectedSong = selectedSongKey === likeKey;
                      const isDoublePlayCue = doublePlayCueSongKey === likeKey;
                      const playActionLabel = isCurrentPlaying && isPlayerPlaying ? text.pauseSong : text.playSong;
                      const playActionIcon = isCurrentPlaying && isPlayerPlaying ? '\u23f8' : '\u25b6';

                      return (
                        <SongListRow
                          key={`${song.id}_${index}`}
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
                          onSelectSong={handleSelectSong}
                          onDoublePlayAt={handleDailyDoublePlayAt}
                          onPlayAt={handleDailyPlayAt}
                          onLikeSong={handleLikeSongAction}
                        />
                      );
                    })}
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
        )}

      </main>
      <PlayerBar />
    </div>
  );
}



