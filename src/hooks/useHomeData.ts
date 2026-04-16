import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlertStore, useAuthStore, usePlayerStore, useSongLikeStore, useToastStore } from '@/stores';
import { selectIsAuthenticated } from '@/stores/auth.store';
import { useSongLikeAction } from '@/hooks/useSongLikeAction';
import { libraryService } from '@/services/library.service';
import { authService } from '@/services/auth.service';
import { canUseTauriInvoke, isLikelyTauriMobileRuntime, isMobile } from '@/lib/runtime';
import { readPlaylistDetailCache, writePlaylistDetailCache } from '@/lib/db/playlist-detail-cache';
import {
  clearStaleDailyRecommendCache,
  getLocalDateKey,
  readDailyRecommendCache,
  writeDailyRecommendCache,
} from '@/lib/db/daily-recommend-cache';
import {
  addSearchHistoryKeyword,
  buildSearchSuggestions,
  readSearchHistory,
} from '@/lib/db/search-history';
import { useVirtualList } from '@/hooks/useVirtualList';
import type { UnifiedPlaylist, UnifiedSong, UnifiedUser } from '@/types';
import {
  text,
  platformNameMap,
  NETEASE_LIKED_ORDER_STORAGE_KEY,
  LOCAL_API_READY_EVENT,
  ANDROID_BACK_PRESS_EVENT,
  SEARCH_RESULT_ESTIMATED_ROW_HEIGHT,
  SONG_ROW_ESTIMATED_HEIGHT,
  PLAYLIST_DETAIL_ESTIMATED_ROW_HEIGHT,
  INITIAL_PLAYLIST_BOOTSTRAP_TIMEOUT_MS,
  INITIAL_PLAYLIST_BOOTSTRAP_RETRY_DELAY_MS,
  type NeteaseLikedOrder,
  type SearchPlatformFilter,
  type PanelTab,
  type DailySourceTab,
} from '@/constants/home.constants';
import {
  collectLoadedPlaylistPlatforms,
  isNeteaseLikedOrder,
  getSongLikeKey,
  resolveDisplayNickname,
} from '@/utils/home.utils';

const SONG_LIKE_CHANGED_EVENT = 'allmusic:song-like-changed';

export function useHomeData() {
  const users = useAuthStore((state) => state.users);
  const cookies = useAuthStore((state) => state.cookies);
  const isLoading = useAuthStore((state) => state.isLoading);
  const removeUser = useAuthStore((state) => state.removeUser);
  const setUser = useAuthStore((state) => state.setUser);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const pushAlert = useAlertStore((state) => state.pushAlert);
  const pushToast = useToastStore((state) => state.pushToast);
  const likedByKey = useSongLikeStore((state) => state.likedByKey);
  const likePendingByKey = useSongLikeStore((state) => state.pendingByKey);
  const resetSongLikeState = useSongLikeStore((state) => state.reset);
  const { toggleSongLike } = useSongLikeAction();
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);
  const playingSongId = usePlayerStore((state) => state.currentSong?.id || null);
  const playerQueue = usePlayerStore((state) => state.queue);
  const playerCurrentIndex = usePlayerStore((state) => state.currentIndex);
  const isPlayerPlaying = usePlayerStore((state) => state.isPlaying);
  const playerHistory = usePlayerStore((state) => state.history);
  const setPlayerQueue = usePlayerStore((state) => state.setQueue);
  const setPlayerIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  const togglePlayerPlay = usePlayerStore((state) => state.togglePlay);
  const clearPlayerHistory = usePlayerStore((state) => state.clearHistory);

  const [mounted, setMounted] = useState(false);
  const isMobileRuntime = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return isMobile();
  }, []);
  const [panelTab, setPanelTab] = useState<PanelTab>('playlists');
  const [dailySourceTab, setDailySourceTab] = useState<DailySourceTab>('merged');
  const [playlists, setPlaylists] = useState<UnifiedPlaylist[]>([]);
  const [playlistWarnings, setPlaylistWarnings] = useState<string[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [isInitialPlaylistBootstrapPending, setIsInitialPlaylistBootstrapPending] = useState(true);
  const [initialPlaylistBootstrapMessage, setInitialPlaylistBootstrapMessage] = useState<string>(text.bootstrappingPlaylists);
  const [isLocalApiReady, setIsLocalApiReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const shouldWaitForLocalApi = canUseTauriInvoke() && !isLikelyTauriMobileRuntime();
    if (!shouldWaitForLocalApi) {
      return true;
    }
    const runtimeWindow = window as Window & { __ALLMUSIC_LOCAL_API_READY__?: boolean };
    return Boolean(runtimeWindow.__ALLMUSIC_LOCAL_API_READY__);
  });

  const [keyword, setKeyword] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
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
  const [playlistDetailError, setPlaylistDetailError] = useState<string | null>(null);
  const [playlistDetailInfo, setPlaylistDetailInfo] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDetailRefreshing, setIsDetailRefreshing] = useState(false);
  const [neteaseLikedOrder, setNeteaseLikedOrder] = useState<NeteaseLikedOrder>(() => {
    if (typeof window === 'undefined') {
      return 'latest';
    }

    const storedOrder = window.localStorage.getItem(NETEASE_LIKED_ORDER_STORAGE_KEY);
    return isNeteaseLikedOrder(storedOrder) ? storedOrder : 'latest';
  });
  const selectedPlaylistIdRef = useRef<string | null>(null);
  const detailRequestSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const dailyRequestSeqRef = useRef(0);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceTimerRef = useRef<number | null>(null);
  const doublePlayCueTimerRef = useRef<number | null>(null);
  const likeRevalidateTimerRef = useRef<number | null>(null);
  const likeScopeRef = useRef<string>('');
  const likedPlaylistRefreshTimerRef = useRef<number | null>(null);
  const localApiReadyRefreshAtRef = useRef(0);

  const {
    containerRef: playlistDetailContainerRef,
    measureRef: playlistDetailMeasureRef,
    startIndex: playlistDetailVirtualStart,
    endIndex: playlistDetailVirtualEnd,
    totalHeight: playlistDetailVirtualTotalHeight,
    itemHeight: playlistDetailVirtualItemHeight,
  } = useVirtualList({
    itemCount: playlistDetailSongs.length,
    estimatedItemHeight: PLAYLIST_DETAIL_ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    resetKey: selectedPlaylist?.id ?? null,
  });
  const expectedPlaylistPlatforms = useMemo(() => {
    const expected: Array<'netease' | 'qq'> = [];
    if (users.netease && cookies.netease) {
      expected.push('netease');
    }
    if (users.qq && cookies.qq) {
      expected.push('qq');
    }
    return expected;
  }, [cookies.netease, cookies.qq, users.netease, users.qq]);
  const expectedPlaylistPlatformLabel = useMemo(() => {
    const labels = expectedPlaylistPlatforms.map((platform) => platformNameMap[platform]);
    return labels.length > 0 ? labels.join(' + ') : 'All platforms';
  }, [expectedPlaylistPlatforms]);
  const dailyRecommendCacheScope = useMemo(() => ({
    neteaseUserId: users.netease?.userId,
    neteaseCookie: cookies.netease,
    qqUserId: users.qq?.userId,
    qqCookie: cookies.qq,
  }), [
    cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId,
  ]);


  const filteredSearchResults = useMemo(() => {
    if (searchPlatformFilter === 'all') {
      return searchResults;
    }
    return searchResults.filter((song) => song.platform === searchPlatformFilter);
  }, [searchPlatformFilter, searchResults]);
  const searchSuggestions = useMemo(
    () => buildSearchSuggestions(keyword, searchHistory),
    [keyword, searchHistory],
  );
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
  const {
    containerRef: searchResultContainerRef,
    measureRef: searchResultMeasureRef,
    startIndex: searchVirtualStart,
    endIndex: searchVirtualEnd,
    totalHeight: searchVirtualTotalHeight,
    itemHeight: searchVirtualItemHeight,
  } = useVirtualList({
    itemCount: filteredSearchResults.length,
    estimatedItemHeight: SEARCH_RESULT_ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    resetKey: `${isSearchDropdownOpen}-${searchPlatformFilter}-${keyword.trim()}`,
  });
  const {
    containerRef: dailySongContainerRef,
    measureRef: dailySongMeasureRef,
    startIndex: dailyVirtualStart,
    endIndex: dailyVirtualEnd,
    totalHeight: dailyVirtualTotalHeight,
    itemHeight: dailyVirtualItemHeight,
  } = useVirtualList({
    itemCount: activeDailySongs.length,
    estimatedItemHeight: SONG_ROW_ESTIMATED_HEIGHT,
    overscan: 8,
    resetKey: `${dailySourceTab}-${activeDailySongs.length}`,
  });
  const {
    containerRef: historySongContainerRef,
    measureRef: historySongMeasureRef,
    startIndex: historyVirtualStart,
    endIndex: historyVirtualEnd,
    totalHeight: historyVirtualTotalHeight,
    itemHeight: historyVirtualItemHeight,
  } = useVirtualList({
    itemCount: playerHistory.length,
    estimatedItemHeight: SONG_ROW_ESTIMATED_HEIGHT,
    overscan: 8,
    resetKey: `history-${playerHistory.length}`,
  });
  const virtualSearchResults = useMemo(
    () => filteredSearchResults.slice(searchVirtualStart, searchVirtualEnd),
    [filteredSearchResults, searchVirtualEnd, searchVirtualStart],
  );
  const virtualDailySongs = useMemo(
    () => activeDailySongs.slice(dailyVirtualStart, dailyVirtualEnd),
    [activeDailySongs, dailyVirtualEnd, dailyVirtualStart],
  );
  const virtualHistorySongs = useMemo(
    () => playerHistory.slice(historyVirtualStart, historyVirtualEnd),
    [historyVirtualEnd, historyVirtualStart, playerHistory],
  );
  const virtualPlaylistDetailSongs = useMemo(
    () => playlistDetailSongs.slice(playlistDetailVirtualStart, playlistDetailVirtualEnd),
    [playlistDetailSongs, playlistDetailVirtualEnd, playlistDetailVirtualStart],
  );
  const neteaseDisplayNickname = useMemo(
    () => resolveDisplayNickname(users.netease),
    [users.netease?.nickname, users.netease?.userId],
  );
  const qqDisplayNickname = useMemo(
    () => resolveDisplayNickname(users.qq),
    [users.qq?.nickname, users.qq?.userId],
  );

  const notifyAlert = useCallback((
    title: string,
    message: string,
    options?: {
      level?: 'error' | 'warning' | 'info';
      source?: string;
      dedupeKey?: string;
      detail?: string;
    },
  ) => {
    pushAlert({
      level: options?.level || 'error',
      title,
      message,
      source: options?.source,
      dedupeKey: options?.dedupeKey,
      detail: options?.detail,
    });
  }, [pushAlert]);

  // --- Simple effects ---

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    setSearchHistory(readSearchHistory());
  }, [mounted]);

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

    const shouldWaitForLocalApi = canUseTauriInvoke() && !isLikelyTauriMobileRuntime();
    if (!shouldWaitForLocalApi) {
      setIsLocalApiReady(true);
      return;
    }

    const runtimeWindow = window as Window & { __ALLMUSIC_LOCAL_API_READY__?: boolean };
    if (runtimeWindow.__ALLMUSIC_LOCAL_API_READY__) {
      setIsLocalApiReady(true);
      return;
    }

    const onLocalApiReady = () => {
      runtimeWindow.__ALLMUSIC_LOCAL_API_READY__ = true;
      setIsLocalApiReady(true);
    };

    window.addEventListener(LOCAL_API_READY_EVENT, onLocalApiReady);
    return () => {
      window.removeEventListener(LOCAL_API_READY_EVENT, onLocalApiReady);
    };
  }, []);

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

  useEffect(() => {
    if (!isMobileRuntime || typeof window === 'undefined') {
      return;
    }

    const onAndroidBackPress = (event: Event) => {
      if (!isSearchDropdownOpen) {
        return;
      }
      event.preventDefault();
      setIsSearchDropdownOpen(false);
    };

    window.addEventListener(ANDROID_BACK_PRESS_EVENT, onAndroidBackPress);
    return () => {
      window.removeEventListener(ANDROID_BACK_PRESS_EVENT, onAndroidBackPress);
    };
  }, [isMobileRuntime, isSearchDropdownOpen]);

  useEffect(() => () => {
    searchRequestSeqRef.current += 1;
    dailyRequestSeqRef.current += 1;
    detailRequestSeqRef.current += 1;
    if (searchDebounceTimerRef.current !== null) {
      window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    if (doublePlayCueTimerRef.current !== null) {
      window.clearTimeout(doublePlayCueTimerRef.current);
      doublePlayCueTimerRef.current = null;
    }
    if (likeRevalidateTimerRef.current !== null) {
      window.clearTimeout(likeRevalidateTimerRef.current);
      likeRevalidateTimerRef.current = null;
    }
    if (likedPlaylistRefreshTimerRef.current !== null) {
      window.clearTimeout(likedPlaylistRefreshTimerRef.current);
      likedPlaylistRefreshTimerRef.current = null;
    }
  }, []);

  // --- Notification effects ---

  useEffect(() => {
    if (isInitialPlaylistBootstrapPending || !playlistError) {
      return;
    }
    notifyAlert('歌单加载失败', playlistError, {
      source: 'home.playlists',
      dedupeKey: `home:playlist-error:${playlistError}`,
    });
  }, [isInitialPlaylistBootstrapPending, notifyAlert, playlistError]);

  useEffect(() => {
    if (
      isInitialPlaylistBootstrapPending
      || !searchError
      || searchError === text.enterKeyword
      || searchError === text.noSongMatched
    ) {
      return;
    }
    notifyAlert('鎼滅储澶辫触', searchError, {
      source: 'home.search',
      dedupeKey: `home:search-error:${searchError}`,
    });
  }, [isInitialPlaylistBootstrapPending, notifyAlert, searchError]);

  useEffect(() => {
    if (isInitialPlaylistBootstrapPending || !dailyError) {
      return;
    }
    notifyAlert('每日推荐加载失败', dailyError, {
      source: 'home.daily',
      dedupeKey: `home:daily-error:${dailyError}`,
    });
  }, [dailyError, isInitialPlaylistBootstrapPending, notifyAlert]);

  useEffect(() => {
    if (isInitialPlaylistBootstrapPending || !playlistDetailError) {
      return;
    }
    notifyAlert('歌单详情加载失败', playlistDetailError, {
      source: 'home.playlist-detail',
      dedupeKey: `home:playlist-detail-error:${playlistDetailError}`,
    });
  }, [isInitialPlaylistBootstrapPending, notifyAlert, playlistDetailError]);

  useEffect(() => {
    if (!likeActionError) {
      return;
    }
    pushToast({
      level: 'warning',
      title: '鏀惰棌鎿嶄綔澶辫触',
      message: likeActionError,
      source: 'home.like-action',
      dedupeKey: `home:like-action-error:${likeActionError}`,
      durationMs: 3200,
    });
  }, [likeActionError, pushToast]);

  useEffect(() => {
    if (!likeActionMessage) {
      return;
    }
    pushToast({
      level: 'success',
      title: 'Like status',
      message: likeActionMessage,
      source: 'home.like-action',
      dedupeKey: `home:like-action-success:${likeActionMessage}`,
      durationMs: 2200,
    });
  }, [likeActionMessage, pushToast]);

  useEffect(() => {
    const nextScope = `${users.netease?.userId || ''}|${users.qq?.userId || ''}`;
    if (likeScopeRef.current && likeScopeRef.current !== nextScope) {
      resetSongLikeState();
    }
    likeScopeRef.current = nextScope;
  }, [resetSongLikeState, users.netease?.userId, users.qq?.userId]);

  // --- Data loading callbacks ---

  const loadPlaylists = useCallback(async (options?: { suppressEmptyError?: boolean }) => {
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

      if (!options?.suppressEmptyError && result.playlists.length === 0 && result.warnings.length > 0) {
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

      return {
        ...result,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load playlists. Please try again.';
      if (!options?.suppressEmptyError) {
        setPlaylistError(message);
      }
      setPlaylistWarnings([]);
      return {
        playlists: [],
        warnings: [message],
        success: false,
      };
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId]);

  const loadDailyRecommendations = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const requestSeq = dailyRequestSeqRef.current + 1;
    dailyRequestSeqRef.current = requestSeq;
    setDailyError(null);
    if (!forceRefresh) {
      clearStaleDailyRecommendCache();
      const cached = readDailyRecommendCache(dailyRecommendCacheScope);
      if (cached) {
        setDailySongs(cached.songs);
        setDailyWarnings(cached.warnings);
        if (cached.songs.length === 0 && cached.warnings.length > 0) {
          setDailyError(cached.warnings[0]);
        }
        setIsDailyLoading(false);
        return {
          songs: cached.songs,
          warnings: cached.warnings,
          success: true,
        };
      }
    }

    setIsDailyLoading(true);

    try {
      const result = await libraryService.loadDailyRecommendations({
        neteaseUserId: users.netease?.userId,
        neteaseCookie: cookies.netease,
        qqUserId: users.qq?.userId,
        qqCookie: cookies.qq,
      });

      if (dailyRequestSeqRef.current !== requestSeq) {
        return {
          songs: [],
          warnings: [],
          success: false,
        };
      }

      setDailySongs(result.songs);
      setDailyWarnings(result.warnings);
      if (result.songs.length === 0 && result.warnings.length > 0) {
        setDailyError(result.warnings[0]);
      }
      // 仅缓存有效结果，避免空结果阻塞当日后续重试
      if (result.songs.length > 0) {
        writeDailyRecommendCache(dailyRecommendCacheScope, {
          songs: result.songs,
          warnings: result.warnings,
        });
      }
      return {
        ...result,
        success: true,
      };
    } catch (error) {
      if (dailyRequestSeqRef.current !== requestSeq) {
        return {
          songs: [],
          warnings: [],
          success: false,
        };
      }

      const message = error instanceof Error ? error.message : 'Failed to load daily recommendations. Please try again.';
      setDailyError(message);
      setDailyWarnings([]);
      return {
        songs: [],
        warnings: [message],
        success: false,
      };
    } finally {
      if (dailyRequestSeqRef.current === requestSeq) {
        setIsDailyLoading(false);
      }
    }
  }, [cookies.netease, cookies.qq, dailyRecommendCacheScope, users.netease?.userId, users.qq?.userId]);

  // --- Bootstrap effect ---

  useEffect(() => {
    if (!mounted || !isAuthenticated) {
      setIsInitialPlaylistBootstrapPending(true);
      setInitialPlaylistBootstrapMessage(text.bootstrappingPlaylists);
      return;
    }

    if (!isLocalApiReady) {
      setIsInitialPlaylistBootstrapPending(true);
      setInitialPlaylistBootstrapMessage('正在等待本地 API 启动完成...');
      setPlaylistError(null);
      return;
    }

    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

    const bootstrapInitialPlaylists = async () => {
      setIsInitialPlaylistBootstrapPending(true);
      setInitialPlaylistBootstrapMessage(`正在等待 ${expectedPlaylistPlatformLabel} 首批歌单同步...`);

      const startedAt = Date.now();
      let attempt = 0;

      while (!cancelled) {
        attempt += 1;
        const result = await loadPlaylists({ suppressEmptyError: true });
        if (cancelled) {
          return;
        }

        const loadedPlatforms = collectLoadedPlaylistPlatforms(result.playlists);
        const hasLoadedAllExpectedPlatforms = expectedPlaylistPlatforms.length === 0
          || expectedPlaylistPlatforms.every((platform) => loadedPlatforms.has(platform));

        if (hasLoadedAllExpectedPlatforms) {
          setIsInitialPlaylistBootstrapPending(false);
          setInitialPlaylistBootstrapMessage('');
          await loadDailyRecommendations();
          return;
        }

        const missingPlatforms = expectedPlaylistPlatforms.filter((platform) => !loadedPlatforms.has(platform));
        const missingPlatformLabel = missingPlatforms.length > 0
          ? missingPlatforms.map((platform) => platformNameMap[platform]).join(' / ')
          : expectedPlaylistPlatformLabel;
        setInitialPlaylistBootstrapMessage(`正在等待 ${missingPlatformLabel} 歌单首次同步（第 ${attempt} 次）...`);

        if (Date.now() - startedAt >= INITIAL_PLAYLIST_BOOTSTRAP_TIMEOUT_MS) {
          const timeoutMessage = `Timed out waiting for playlists from ${missingPlatformLabel}. Please verify local API status and retry.`;
          setPlaylistError(timeoutMessage);
          setIsInitialPlaylistBootstrapPending(false);
          await loadDailyRecommendations();
          return;
        }

        await sleep(INITIAL_PLAYLIST_BOOTSTRAP_RETRY_DELAY_MS);
      }
    };

    void bootstrapInitialPlaylists();
    return () => {
      cancelled = true;
    };
  }, [
    expectedPlaylistPlatformLabel,
    expectedPlaylistPlatforms,
    isAuthenticated,
    isLocalApiReady,
    loadDailyRecommendations,
    loadPlaylists,
    mounted,
  ]);

  const loadPlaylistDetail = useCallback(
    async (
      playlist: UnifiedPlaylist,
      options?: {
        neteaseLikedOrder?: NeteaseLikedOrder;
        forceRefreshNeteaseWebOrder?: boolean;
      },
    ) => {
      const requestSeq = detailRequestSeqRef.current + 1;
      detailRequestSeqRef.current = requestSeq;
      const likedOrder = options?.neteaseLikedOrder || neteaseLikedOrder;

      selectedPlaylistIdRef.current = playlist.id;
      setSelectedPlaylist(playlist);
      setPlaylistDetailError(null);
      setPlaylistDetailInfo(null);
      const cachedDetail = readPlaylistDetailCache(playlist, {
        neteaseLikedOrder: likedOrder,
      });
      const hasCachedSnapshot = cachedDetail !== null;
      if (cachedDetail) {
        setPlaylistDetailSongs(cachedDetail.songs);
        setPlaylistDetailError(null);
        setPlaylistDetailInfo(cachedDetail.info || cachedDetail.warning || null);
        setIsDetailLoading(false);
        setIsDetailRefreshing(true);
      } else {
        setPlaylistDetailSongs([]);
        setIsDetailLoading(true);
        setIsDetailRefreshing(false);
      }

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
        const detailWarning = detail.warning || null;
        if (detailWarning && detail.songs.length > 0) {
          setPlaylistDetailError(null);
          setPlaylistDetailInfo(detail.info ? `${detail.info} 路 ${detailWarning}` : detailWarning);
        } else {
          setPlaylistDetailError(detailWarning);
          setPlaylistDetailInfo(detail.info || null);
        }
        writePlaylistDetailCache(playlist, {
          neteaseLikedOrder: likedOrder,
        }, {
          songs: detail.songs,
          warning: detail.warning,
          info: detail.info,
        });
        setPlaylists((prev) => prev.map((item) => (
          item.id === playlist.id
            ? { ...item, songCount: detail.songs.length }
            : item
        )));
      } catch (error) {
        if (detailRequestSeqRef.current !== requestSeq || selectedPlaylistIdRef.current !== playlist.id) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Failed to load playlist details. Please try again.';
        if (hasCachedSnapshot) {
          setPlaylistDetailError(null);
          setPlaylistDetailInfo(`Showing cached data, background refresh failed: ${message}`);
        } else {
          setPlaylistDetailError(message);
        }
      } finally {
        if (detailRequestSeqRef.current === requestSeq && selectedPlaylistIdRef.current === playlist.id) {
          setIsDetailLoading(false);
          setIsDetailRefreshing(false);
        }
      }
    },
    [cookies.netease, cookies.qq, neteaseLikedOrder, users.netease?.userId, users.qq?.userId],
  );

  // --- Auto-select effect ---

  useEffect(() => {
    if (
      !mounted
      || !isAuthenticated
      || isInitialPlaylistBootstrapPending
      || selectedPlaylist
      || isPlaylistLoading
      || playlists.length === 0
    ) {
      return;
    }

    const preferredPlaylist = playlists.find((item) => item.platform === 'merged') ?? playlists[0];
    void loadPlaylistDetail(preferredPlaylist);
  }, [
    isAuthenticated,
    isInitialPlaylistBootstrapPending,
    isPlaylistLoading,
    loadPlaylistDetail,
    mounted,
    playlists,
    selectedPlaylist,
  ]);

  const executeSearch = useCallback(
    async (nextKeyword: string, options?: { recordHistory?: boolean }) => {
      const trimmedKeyword = nextKeyword.trim();
      const requestSeq = searchRequestSeqRef.current + 1;
      searchRequestSeqRef.current = requestSeq;
      if (!trimmedKeyword) {
        setSearchError(text.enterKeyword);
        setSearchResults([]);
        setSearchWarnings([]);
        setIsSearching(false);
        return;
      }

      if (options?.recordHistory) {
        setSearchHistory(addSearchHistoryKeyword(trimmedKeyword));
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

        if (searchRequestSeqRef.current !== requestSeq) {
          return;
        }

        setSearchResults(result.songs);
        setSearchWarnings(result.warnings);

        if (result.songs.length === 0) {
          if (result.warnings.length > 0) {
            setSearchError(result.warnings[0]);
          } else {
            setSearchError(text.noSongMatched);
          }
        }
      } catch (error) {
        if (searchRequestSeqRef.current !== requestSeq) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Search failed. Please try again.';
        setSearchError(message);
        setSearchWarnings([]);
      } finally {
        if (searchRequestSeqRef.current === requestSeq) {
          setIsSearching(false);
        }
      }
    },
    [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId],
  );

  // --- Search debounce effect ---

  useEffect(() => {
    if (!isSearchDropdownOpen) {
      return;
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      searchRequestSeqRef.current += 1;
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
    async ({
      includeSearch = true,
      includeDaily = true,
      includeDailyForceRefresh = false,
    }: { includeSearch?: boolean; includeDaily?: boolean; includeDailyForceRefresh?: boolean } = {}) => {
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
        await loadDailyRecommendations({ forceRefresh: includeDailyForceRefresh });
      }
    },
    [executeSearch, keyword, loadDailyRecommendations, loadPlaylistDetail, loadPlaylists],
  );

  const patchSongsByLikeKey = useCallback((songs: UnifiedSong[], likeKey: string, isLiked: boolean): UnifiedSong[] => {
    let changed = false;
    const nextSongs = songs.map((item) => {
      if (getSongLikeKey(item) !== likeKey || Boolean(item.isLiked) === isLiked) {
        return item;
      }
      changed = true;
      return { ...item, isLiked };
    });
    return changed ? nextSongs : songs;
  }, []);

  const patchSongLikeInHomeState = useCallback((song: UnifiedSong, isLiked: boolean) => {
    const likeKey = getSongLikeKey(song);
    setSearchResults((prev) => patchSongsByLikeKey(prev, likeKey, isLiked));
    setDailySongs((prev) => patchSongsByLikeKey(prev, likeKey, isLiked));
    setPlaylistDetailSongs((prev) => patchSongsByLikeKey(prev, likeKey, isLiked));
  }, [patchSongsByLikeKey]);

  useEffect(() => {
    const keys = Object.keys(likedByKey);
    if (keys.length === 0) {
      return;
    }

    const applyLikedMap = (songs: UnifiedSong[]): UnifiedSong[] => {
      let changed = false;
      const nextSongs = songs.map((item) => {
        const override = likedByKey[getSongLikeKey(item)];
        if (typeof override !== 'boolean' || Boolean(item.isLiked) === override) {
          return item;
        }
        changed = true;
        return { ...item, isLiked: override };
      });
      return changed ? nextSongs : songs;
    };

    setSearchResults((prev) => applyLikedMap(prev));
    setDailySongs((prev) => applyLikedMap(prev));
    setPlaylistDetailSongs((prev) => applyLikedMap(prev));
  }, [likedByKey]);

  const scheduleLikeStateRevalidate = useCallback(() => {
    if (likeRevalidateTimerRef.current !== null) {
      window.clearTimeout(likeRevalidateTimerRef.current);
    }

    likeRevalidateTimerRef.current = window.setTimeout(() => {
      likeRevalidateTimerRef.current = null;
      void refreshCurrentView({
        includeSearch: true,
        includeDaily: true,
      });
    }, 1200);
  }, [refreshCurrentView]);

  const refreshLikedPlaylistsAndCache = useCallback(async (platform: 'netease' | 'qq') => {
    const refreshTargets = playlists.filter((item) => (
      item.type === 'liked' && (
        item.platform === platform
        || item.platform === 'merged'
      )
    ));

    if (refreshTargets.length === 0) {
      return;
    }

    const tasks = refreshTargets.map(async (playlist) => {
      try {
        const detail = await libraryService.loadPlaylistDetail(playlist, {
          neteaseUserId: users.netease?.userId,
          neteaseCookie: cookies.netease,
          neteaseLikedOrder: neteaseLikedOrder,
          qqUserId: users.qq?.userId,
          qqCookie: cookies.qq,
        });

        writePlaylistDetailCache(playlist, {
          neteaseLikedOrder: neteaseLikedOrder,
        }, {
          songs: detail.songs,
          warning: detail.warning,
          info: detail.info,
        });

        setPlaylists((prev) => prev.map((item) => (
          item.id === playlist.id
            ? { ...item, songCount: detail.songs.length }
            : item
        )));

        if (selectedPlaylistIdRef.current === playlist.id) {
          setPlaylistDetailSongs(detail.songs);
          const detailWarning = detail.warning || null;
          if (detailWarning && detail.songs.length > 0) {
            setPlaylistDetailError(null);
            setPlaylistDetailInfo(detail.info ? `${detail.info} 路 ${detailWarning}` : detailWarning);
          } else {
            setPlaylistDetailError(detailWarning);
            setPlaylistDetailInfo(detail.info || null);
          }
        }
      } catch {
        // Ignore background refresh errors to avoid blocking primary UX.
      }
    });

    await Promise.all(tasks);
  }, [
    cookies.netease,
    cookies.qq,
    neteaseLikedOrder,
    playlists,
    users.netease?.userId,
    users.qq?.userId,
  ]);

  const scheduleLikedPlaylistRefresh = useCallback((platform: 'netease' | 'qq') => {
    if (likedPlaylistRefreshTimerRef.current !== null) {
      window.clearTimeout(likedPlaylistRefreshTimerRef.current);
    }

    likedPlaylistRefreshTimerRef.current = window.setTimeout(() => {
      likedPlaylistRefreshTimerRef.current = null;
      void refreshLikedPlaylistsAndCache(platform);
    }, 900);
  }, [refreshLikedPlaylistsAndCache]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handler = (event: Event) => {
      const payload = (event as CustomEvent<{ platform?: string }>).detail;
      if (payload?.platform === 'netease' || payload?.platform === 'qq') {
        scheduleLikedPlaylistRefresh(payload.platform);
      }
    };

    window.addEventListener(SONG_LIKE_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(SONG_LIKE_CHANGED_EVENT, handler);
    };
  }, [scheduleLikedPlaylistRefresh]);

  // --- localApiReady refresh effect ---

  useEffect(() => {
    if (!mounted || !isAuthenticated || isInitialPlaylistBootstrapPending) {
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
  }, [isAuthenticated, isInitialPlaylistBootstrapPending, mounted, refreshCurrentView]);

  // --- Daily cache date rollover effect ---

  useEffect(() => {
    if (!mounted || !isAuthenticated || isInitialPlaylistBootstrapPending || !isLocalApiReady) {
      return;
    }

    let activeDate = getLocalDateKey();
    clearStaleDailyRecommendCache(activeDate);

    const timer = window.setInterval(() => {
      const nextDate = getLocalDateKey();
      if (nextDate === activeDate) {
        return;
      }

      activeDate = nextDate;
      clearStaleDailyRecommendCache(nextDate);
      void loadDailyRecommendations({ forceRefresh: true });
    }, 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    isAuthenticated,
    isInitialPlaylistBootstrapPending,
    isLocalApiReady,
    loadDailyRecommendations,
    mounted,
  ]);

  // --- Profile sync effect ---

  useEffect(() => {
    if (!mounted || !isAuthenticated || isInitialPlaylistBootstrapPending) {
      return;
    }

    let cancelled = false;
    const syncProfiles = async () => {
      const syncOne = async (
        platform: 'netease' | 'qq',
        cookie: string | null,
        currentUser: UnifiedUser | null,
      ) => {
        if (!cookie?.trim() || !currentUser) {
          return;
        }

        try {
          const latest = await authService.getUserInfo(platform, cookie);

          if (!latest || cancelled) {
            return;
          }

          const latestNickname = (latest.nickname || '').trim();
          const latestAvatar = latest.avatarUrl || '';
          const shouldUpdate = (
            latest.userId !== currentUser.userId
            || (latestNickname && latestNickname !== currentUser.nickname)
            || (latestAvatar && latestAvatar !== currentUser.avatarUrl)
          );
          if (!shouldUpdate) {
            return;
          }

          await setUser(
            platform,
            {
              ...latest,
              nickname: latestNickname || currentUser.nickname,
              avatarUrl: latestAvatar || currentUser.avatarUrl,
              isLoggedIn: true,
            },
            cookie,
          );
        } catch {
          // 蹇界暐鍚屾澶辫触锛岄伩鍏嶅奖鍝嶉〉闈富娴佺▼
        }
      };

      await Promise.all([
        syncOne('netease', cookies.netease, users.netease),
        syncOne('qq', cookies.qq, users.qq),
      ]);
    };

    void syncProfiles();
    const timer = window.setInterval(() => {
      void syncProfiles();
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    cookies.netease,
    cookies.qq,
    isAuthenticated,
    isInitialPlaylistBootstrapPending,
    mounted,
    setUser,
    users.netease,
    users.qq,
  ]);

  // --- handleLikeSong ---

  const handleLikeSong = useCallback(
    async (song: UnifiedSong) => {
      const songKey = getSongLikeKey(song);
      if (likingSongIds[songKey] || likePendingByKey[songKey]) {
        return;
      }

      const targetLike = !resolveLiked(song);
      setLikeActionMessage(null);
      setLikeActionError(null);
      setLikingSongIds((prev) => ({ ...prev, [songKey]: true }));

      try {
        const result = await toggleSongLike(song, {
          targetLike,
          onOptimistic: (nextLiked) => {
            patchSongLikeInHomeState(song, nextLiked);
          },
          onRollback: (previousLiked) => {
            patchSongLikeInHomeState(song, previousLiked);
          },
        });

        if (!result.success) {
          setLikeActionError(result.warning || 'Operation failed. Please try again.');
          patchSongLikeInHomeState(song, result.previousLiked);
          return;
        }

        const platformName = platformNameMap[song.platform];
        const actionLabel = targetLike ? '宸插姞鍏ユ垜鍠滄' : '宸插彇娑堟垜鍠滄';
        setLikeActionMessage(
          result.warning
            ? `${platformName}${actionLabel}: ${result.warning}`
            : `${platformName}${actionLabel}`,
        );

        if (result.needsRevalidate) {
          scheduleLikeStateRevalidate();
        }
      } catch (error) {
        patchSongLikeInHomeState(song, !targetLike);
        setLikeActionError(error instanceof Error ? error.message : 'Operation failed. Please try again.');
      } finally {
        setLikingSongIds((prev) => {
          const next = { ...prev };
          delete next[songKey];
          return next;
        });
      }
    },
    [
      likePendingByKey,
      likingSongIds,
      patchSongLikeInHomeState,
      resolveLiked,
      scheduleLikeStateRevalidate,
      toggleSongLike,
    ],
  );

  // --- Computed values ---

  const isNeteaseLikedPlaylistSelected = Boolean(
    selectedPlaylist
    && selectedPlaylist.platform === 'netease'
    && selectedPlaylist.type === 'liked',
  );
  const isDetailBusy = isDetailLoading || isDetailRefreshing;

  return {
    // Store values
    users,
    cookies,
    isAuthenticated,
    isLoading,
    removeUser,
    setUser,
    pushAlert,
    pushToast,
    playingSongId,
    playerQueue,
    playerCurrentIndex,
    isPlayerPlaying,
    playerHistory,
    setPlayerQueue,
    setPlayerIsPlaying,
    togglePlayerPlay,
    clearPlayerHistory,

    // State values
    mounted,
    isMobileRuntime,
    panelTab,
    setPanelTab,
    dailySourceTab,
    setDailySourceTab,
    playlists,
    setPlaylists,
    playlistWarnings,
    playlistError,
    isPlaylistLoading,
    isInitialPlaylistBootstrapPending,
    initialPlaylistBootstrapMessage,
    isLocalApiReady,
    keyword,
    setKeyword,
    isSearchDropdownOpen,
    setIsSearchDropdownOpen,
    searchHistory,
    setSearchHistory,
    searchResults,
    searchPlatformFilter,
    setSearchPlatformFilter,
    searchWarnings,
    searchError,
    isSearching,
    dailySongs,
    dailyWarnings,
    dailyError,
    isDailyLoading,
    likingSongIds,
    likeActionMessage,
    setLikeActionMessage,
    likeActionError,
    setLikeActionError,
    selectedSongKey,
    setSelectedSongKey,
    doublePlayCueSongKey,
    setDoublePlayCueSongKey,
    selectedPlaylist,
    setSelectedPlaylist,
    playlistDetailSongs,
    playlistDetailError,
    playlistDetailInfo,
    isDetailLoading,
    isDetailRefreshing,
    neteaseLikedOrder,
    setNeteaseLikedOrder,

    // Refs
    selectedPlaylistIdRef,
    detailRequestSeqRef,
    searchRequestSeqRef,
    dailyRequestSeqRef,
    searchDropdownRef,
    searchDebounceTimerRef,
    doublePlayCueTimerRef,
    localApiReadyRefreshAtRef,

    // Virtual list results - playlist detail
    playlistDetailContainerRef,
    playlistDetailMeasureRef,
    playlistDetailVirtualStart,
    playlistDetailVirtualEnd,
    playlistDetailVirtualTotalHeight,
    playlistDetailVirtualItemHeight,

    // Virtual list results - search
    searchResultContainerRef,
    searchResultMeasureRef,
    searchVirtualStart,
    searchVirtualEnd,
    searchVirtualTotalHeight,
    searchVirtualItemHeight,

    // Virtual list results - daily
    dailySongContainerRef,
    dailySongMeasureRef,
    dailyVirtualStart,
    dailyVirtualEnd,
    dailyVirtualTotalHeight,
    dailyVirtualItemHeight,

    // Virtual list results - history
    historySongContainerRef,
    historySongMeasureRef,
    historyVirtualStart,
    historyVirtualEnd,
    historyVirtualTotalHeight,
    historyVirtualItemHeight,

    // Computed values
    expectedPlaylistPlatforms,
    expectedPlaylistPlatformLabel,
    filteredSearchResults,
    searchSuggestions,
    dailyNeteaseSongs,
    dailyQQSongs,
    activeDailySongs,
    virtualSearchResults,
    virtualDailySongs,
    virtualHistorySongs,
    virtualPlaylistDetailSongs,
    neteaseDisplayNickname,
    qqDisplayNickname,
    isNeteaseLikedPlaylistSelected,
    isDetailBusy,

    // Data loading callbacks
    loadPlaylists,
    loadDailyRecommendations,
    loadPlaylistDetail,
    executeSearch,
    refreshCurrentView,
    handleLikeSong,
    notifyAlert,
  };
}

