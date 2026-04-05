import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '@/stores/player.store';
import type { ThumbnailState } from '@/types/thumbnail';

export function useThumbnailToolbar() {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);

  const syncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // 防抖：避免频繁调用 Rust 命令
    if (syncTimeoutRef.current !== null) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = window.setTimeout(() => {
      const state: ThumbnailState = {
        songId: currentSong?.id || null,
        title: currentSong?.name || 'ALLMusic',
        artist: currentSong?.artist || '未知歌手',
        isPlaying,
        canPrevious: currentIndex > 0,
        canNext: currentIndex < queue.length - 1,
        coverUrl: currentSong?.coverUrl || null,
      };

      invoke('sync_windows_thumbnail_state', { state }).catch((error) => {
        console.error('[ThumbnailToolbar] Failed to sync state:', error);
      });
    }, 100);

    return () => {
      if (syncTimeoutRef.current !== null) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [currentSong?.id, currentSong?.name, currentSong?.artist, currentSong?.coverUrl, isPlaying, currentIndex, queue.length]);
}
