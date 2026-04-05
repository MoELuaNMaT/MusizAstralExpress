import { useCallback } from 'react';
import type { UnifiedSong } from '@/types';
import { libraryService } from '@/services/library.service';
import { useAuthStore, usePlayerStore, useSongLikeStore } from '@/stores';
import { getSongLikeKey } from '@/utils/home.utils';

const SONG_LIKE_CHANGED_EVENT = 'allmusic:song-like-changed';

function emitSongLikeChanged(platform: UnifiedSong['platform']) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(SONG_LIKE_CHANGED_EVENT, {
    detail: {
      platform,
      at: Date.now(),
    },
  }));
}

export interface ToggleSongLikeOptions {
  targetLike?: boolean;
  onOptimistic?: (nextLiked: boolean, previousLiked: boolean) => void;
  onRollback?: (previousLiked: boolean) => void;
}

export interface ToggleSongLikeResult {
  success: boolean;
  liked: boolean;
  previousLiked: boolean;
  warning?: string;
  error?: string;
  needsRevalidate: boolean;
}

export function useSongLikeAction() {
  const cookies = useAuthStore((state) => state.cookies);
  const updateSongLikedByKey = usePlayerStore((state) => state.updateSongLikedByKey);
  const setLiked = useSongLikeStore((state) => state.setLiked);
  const setPending = useSongLikeStore((state) => state.setPending);

  const toggleSongLike = useCallback(
    async (song: UnifiedSong, options?: ToggleSongLikeOptions): Promise<ToggleSongLikeResult> => {
      const likeKey = getSongLikeKey(song);
      const store = useSongLikeStore.getState();

      const previousLiked = typeof store.likedByKey[likeKey] === 'boolean'
        ? store.likedByKey[likeKey]
        : store.resolveLiked(song);
      const nextLiked = typeof options?.targetLike === 'boolean' ? options.targetLike : !previousLiked;

      if (store.pendingByKey[likeKey]) {
        return {
          success: false,
          liked: previousLiked,
          previousLiked,
          warning: '当前歌曲喜欢状态正在同步中，请稍后重试。',
          needsRevalidate: false,
        };
      }

      setPending(likeKey, true);
      setLiked(likeKey, nextLiked);
      updateSongLikedByKey(song, nextLiked);
      options?.onOptimistic?.(nextLiked, previousLiked);

      try {
        const result = await libraryService.likeSong(song, {
          neteaseCookie: cookies.netease,
          qqCookie: cookies.qq,
        }, nextLiked);

        if (!result.success) {
          setLiked(likeKey, previousLiked);
          updateSongLikedByKey(song, previousLiked);
          options?.onRollback?.(previousLiked);
          return {
            success: false,
            liked: previousLiked,
            previousLiked,
            warning: result.warning || '喜欢状态更新失败，请稍后重试。',
            needsRevalidate: false,
          };
        }

        emitSongLikeChanged(song.platform);

        return {
          success: true,
          liked: nextLiked,
          previousLiked,
          warning: result.warning,
          needsRevalidate: song.platform === 'qq' && Boolean(result.warning),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : '喜欢状态更新失败，请稍后重试。';
        setLiked(likeKey, previousLiked);
        updateSongLikedByKey(song, previousLiked);
        options?.onRollback?.(previousLiked);
        return {
          success: false,
          liked: previousLiked,
          previousLiked,
          warning: message,
          error: message,
          needsRevalidate: false,
        };
      } finally {
        setPending(likeKey, false);
      }
    },
    [
      cookies.netease,
      cookies.qq,
      setLiked,
      setPending,
      updateSongLikedByKey,
    ],
  );

  return {
    toggleSongLike,
  };
}
