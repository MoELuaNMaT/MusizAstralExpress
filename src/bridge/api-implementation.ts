/**
 * useBridgeApi -- sets up window.__ALLMUSIC_BRIDGE__ so that legacy
 * iframe-based UIs can call back into the React host.
 *
 * Extracted from App.tsx to keep the root component lean.
 */

import { useEffect } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { authService } from '@/services/auth.service';
import { libraryService } from '@/services/library.service';
import { buildLibraryContext } from '@/bridge/cache';
import type { LoginResult, PreferredQuality, UnifiedPlaylist } from '@/types';
import type {
  BridgeApi,
  BridgeDailyResult,
  BridgeLoadOptions,
  BridgePlaylistDetailResult,
  BridgePlaylistResult,
} from '@/types/bridge.types';

type BridgeWindow = Window & {
  __ALLMUSIC_BRIDGE__?: BridgeApi;
};

// ---------------------------------------------------------------------------
// Hook params
// ---------------------------------------------------------------------------

export interface UseBridgeApiParams {
  seekRef: React.MutableRefObject<(ms: number) => void>;
  retryRef: React.MutableRefObject<() => void>;
  persistLoginResult: (result: LoginResult) => LoginResult | Promise<LoginResult>;
  resolvePlaylistsWithBridgeCache: (options?: BridgeLoadOptions) => Promise<BridgePlaylistResult>;
  resolvePlaylistDetailWithBridgeCache: (
    playlist: UnifiedPlaylist,
    options?: BridgeLoadOptions,
  ) => Promise<BridgePlaylistDetailResult>;
  resolveDailyRecommendationsWithBridgeCache: (
    options?: (BridgeLoadOptions & { limit?: number }) | number,
  ) => Promise<BridgeDailyResult>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBridgeApi({
  seekRef,
  retryRef,
  persistLoginResult,
  resolvePlaylistsWithBridgeCache,
  resolvePlaylistDetailWithBridgeCache,
  resolveDailyRecommendationsWithBridgeCache,
}: UseBridgeApiParams): void {
  useEffect(() => {
// All bridge methods return Promise to satisfy the BridgeApi contract —
// iframe consumers always `await` the result across the postMessage boundary.
// Methods that are synchronous internally still use `async` for this reason.
    const runtimeWindow = window as BridgeWindow;
    runtimeWindow.__ALLMUSIC_BRIDGE__ = {
      getAuthState: async () => {
        const auth = useAuthStore.getState();
        return {
          users: auth.users,
          cookies: auth.cookies,
          isAuthenticated: Boolean(auth.users.netease || auth.users.qq),
          hasConnectedAllPlatforms: Boolean(auth.users.netease && auth.users.qq),
        };
      },
      neteaseQRCodeLogin: async (onQRCodeUrl, onStatusChange, signal) => {
        const result = await authService.neteaseQRCodeLogin(onQRCodeUrl, onStatusChange, signal);
        return persistLoginResult(result);
      },
      qqQRCodeLogin: async (onQRCodeUrl, onStatusChange, signal) => {
        const result = await authService.qqQRCodeLogin(onQRCodeUrl, onStatusChange, signal);
        return persistLoginResult(result);
      },
      verifyLogin: async (platform, cookie) => authService.verifyLogin(platform, cookie),
      logoutPlatform: async (platform) => {
        await useAuthStore.getState().removeUser(platform);
      },
      loadPlaylists: async (options) => resolvePlaylistsWithBridgeCache(options),
      loadPlaylistDetail: async (playlist, options) =>
        resolvePlaylistDetailWithBridgeCache(playlist, options),
      searchSongs: async (keyword, limit = 30) =>
        libraryService.searchUnifiedSongs(keyword, buildLibraryContext(), limit),
      loadDailyRecommendations: async (options) =>
        resolveDailyRecommendationsWithBridgeCache(options),
      loadSongLyrics: async (song) => libraryService.loadSongLyrics(song, buildLibraryContext()),
      likeSong: async (song, like = true) =>
        libraryService.likeSong(song, buildLibraryContext(), like),
      playSongs: async (songs, startIndex = 0) => {
        const player = usePlayerStore.getState();
        player.setQueue(songs, startIndex);
        player.setIsPlaying(true);
      },
      playAt: async (index) => {
        usePlayerStore.getState().playAt(index);
      },
      togglePlay: async () => {
        usePlayerStore.getState().togglePlay();
      },
      playNext: async () => {
        usePlayerStore.getState().playNext();
      },
      playPrevious: async () => {
        usePlayerStore.getState().playPrevious();
      },
      setVolume: async (volumePercent) => {
        const next = Math.max(0, Math.min(100, Number(volumePercent) || 0));
        usePlayerStore.getState().setVolume(next / 100);
      },
      setQuality: async (quality) => {
        const next: PreferredQuality =
          quality === 'flac' ? 'flac' : quality === '128' ? '128' : '320';
        usePlayerStore.getState().setPreferredQuality(next);
        return next;
      },
      seekTo: async (ms) => {
        seekRef.current(Math.max(0, Number(ms) || 0));
      },
      retryCurrent: async () => {
        retryRef.current();
      },
      getPlayerState: async () => {
        const player = usePlayerStore.getState();
        return {
          currentSong: player.currentSong,
          queue: player.queue,
          currentIndex: player.currentIndex,
          isPlaying: player.isPlaying,
          playMode: player.playMode,
          volume: player.volume,
          currentTime: player.currentTime,
          duration: player.duration,
          isLoading: player.isLoading,
          error: player.error,
          preferredQuality: player.preferredQuality,
        };
      },
    } satisfies BridgeApi;

    return () => {
      delete runtimeWindow.__ALLMUSIC_BRIDGE__;
    };
  }, [
    persistLoginResult,
    resolvePlaylistDetailWithBridgeCache,
    resolvePlaylistsWithBridgeCache,
    resolveDailyRecommendationsWithBridgeCache,
    seekRef,
    retryRef,
  ]);
}
