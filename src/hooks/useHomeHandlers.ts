import {
  type ChangeEvent,
  type FormEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
} from 'react';
import type { useHomeData } from './useHomeData';
import { getSongLikeKey, isNeteaseLikedOrder } from '@/utils/home.utils';
import { clearSearchHistory } from '@/lib/db/search-history';
import type { UnifiedSong } from '@/types';

export function useHomeHandlers(data: ReturnType<typeof useHomeData>) {
  const {
    keyword,
    setKeyword,
    setIsSearchDropdownOpen,
    searchDebounceTimerRef,
    executeSearch,
    setSearchHistory,
    filteredSearchResults,
    playlistDetailSongs,
    activeDailySongs,
    playerCurrentIndex,
    playerQueue,
    playingSongId,
    setPlayerIsPlaying,
    setPlayerQueue,
    togglePlayerPlay,
    playerHistory,
    setSelectedSongKey,
    setDoublePlayCueSongKey,
    doublePlayCueTimerRef,
    refreshCurrentView,
    selectedPlaylist,
    loadPlaylistDetail,
    loadDailyRecommendations,
    neteaseLikedOrder,
    setNeteaseLikedOrder,
    handleLikeSong,
  } = data;

  const handlePlaySong = useCallback(
    (songs: UnifiedSong[], index: number, options?: { forcePlay?: boolean }) => {
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
    },
    [
      playerCurrentIndex,
      playerQueue,
      playingSongId,
      setPlayerIsPlaying,
      setPlayerQueue,
      togglePlayerPlay,
    ],
  );

  const handleSelectSong = useCallback((song: UnifiedSong) => {
    setSelectedSongKey(getSongLikeKey(song));
  }, [setSelectedSongKey]);

  const handleDoublePlaySong = useCallback(
    (songs: UnifiedSong[], index: number) => {
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
    },
    [doublePlayCueTimerRef, handlePlaySong, setDoublePlayCueSongKey, setSelectedSongKey],
  );

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSearchDropdownOpen(true);
    if (searchDebounceTimerRef.current !== null) {
      window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    await executeSearch(keyword, { recordHistory: true });
  };

  const handleApplySearchKeyword = useCallback((nextKeyword: string) => {
    setKeyword(nextKeyword);
    setIsSearchDropdownOpen(true);
    if (searchDebounceTimerRef.current !== null) {
      window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    void executeSearch(nextKeyword, { recordHistory: true });
  }, [executeSearch, searchDebounceTimerRef, setIsSearchDropdownOpen, setKeyword]);

  const handleClearSearchHistory = useCallback(() => {
    clearSearchHistory();
    setSearchHistory([]);
  }, [setSearchHistory]);

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

  const handleHistoryPlayAt = useCallback((index: number) => {
    handlePlaySong(playerHistory, index);
  }, [handlePlaySong, playerHistory]);

  const handleHistoryDoublePlayAt = useCallback((index: number) => {
    handleDoublePlaySong(playerHistory, index);
  }, [handleDoublePlaySong, playerHistory]);

  const handleRefresh = async () => {
    await refreshCurrentView({ includeDailyForceRefresh: true });
  };

  const handleRefreshDaily = async () => {
    await loadDailyRecommendations({ forceRefresh: true });
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

  const handleForceRefreshNeteaseWebOrder = async () => {
    if (!selectedPlaylist || selectedPlaylist.platform !== 'netease' || selectedPlaylist.type !== 'liked') {
      return;
    }

    await loadPlaylistDetail(selectedPlaylist, { forceRefreshNeteaseWebOrder: true });
  };

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

  return {
    handleSearch,
    handleApplySearchKeyword,
    handleClearSearchHistory,
    handlePlaySong,
    handleSelectSong,
    handleDoublePlaySong,
    handleLikeSongAction,
    handleSearchPlayAt,
    handleSearchDoublePlayAt,
    handleDetailPlayAt,
    handleDetailDoublePlayAt,
    handleDailyPlayAt,
    handleDailyDoublePlayAt,
    handleHistoryPlayAt,
    handleHistoryDoublePlayAt,
    handleRefresh,
    handleRefreshDaily,
    handleScrollableWheel,
    handleForceRefreshNeteaseWebOrder,
    handleNeteaseLikedOrderChange,
  };
}
