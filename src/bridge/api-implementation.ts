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
import { UI_VERSION_SWITCH_ENABLED, type UiVersion } from '@/stores/theme.store';
import type { LoginResult, PreferredQuality, UnifiedPlaylist } from '@/types';
import type {
  BridgeApi,
  BridgeDailyResult,
  BridgeLoadOptions,
  BridgePlaylistDetailResult,
  BridgePlaylistResult,
} from '@/types/bridge.types';

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
  captureUiSwitchPlaybackSnapshot: () => void;
  setUiVersion: (version: UiVersion) => void;
  setUiSwitcherOpen: (open: boolean) => void;
  setUiSwitching: (switching: boolean) => void;
  setIsUiFrameLoading: (loading: boolean) => void;
  uiVersion: UiVersion;
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
  captureUiSwitchPlaybackSnapshot,
  setUiVersion,
  setUiSwitcherOpen,
  setUiSwitching,
  setIsUiFrameLoading,
  uiVersion,
}: UseBridgeApiParams): void {
  useEffect(() => {
// All bridge methods return Promise to satisfy the BridgeApi contract —
// iframe consumers always `await` the result across the postMessage boundary.
// Methods that are synchronous internally still use `async` for this reason.
    window.__ALLMUSIC_BRIDGE__ = {
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
      neteaseCellphoneLogin: async (phone, password, countryCode = '86') => {
        const result = await authService.neteaseCellphoneLogin(phone, countryCode, password);
        return persistLoginResult(result);
      },
      qqCookieLogin: async (cookie, nickname) => {
        const result = await authService.qqMusicLogin(cookie, nickname);
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
      switchUiVersion: async (next) => {
        if (!UI_VERSION_SWITCH_ENABLED) {
          setUiVersion('current');
          setUiSwitcherOpen(false);
          return;
        }
        if (next === uiVersion) {
          setUiSwitcherOpen(false);
          return;
        }

        captureUiSwitchPlaybackSnapshot();
        setUiSwitching(true);
        setIsUiFrameLoading(next !== 'current');
        setUiSwitcherOpen(false);
        setUiVersion(next);
      },
      getUiVersion: async () => uiVersion,
      openUiSwitcher: async () => {
        if (!UI_VERSION_SWITCH_ENABLED) {
          return;
        }
        setUiSwitcherOpen(true);
      },
    } satisfies BridgeApi;

    return () => {
      delete window.__ALLMUSIC_BRIDGE__;
    };
  }, [
    captureUiSwitchPlaybackSnapshot,
    persistLoginResult,
    resolvePlaylistDetailWithBridgeCache,
    resolvePlaylistsWithBridgeCache,
    resolveDailyRecommendationsWithBridgeCache,
    seekRef,
    retryRef,
    setIsUiFrameLoading,
    setUiSwitcherOpen,
    setUiSwitching,
    setUiVersion,
    uiVersion,
  ]);
}
