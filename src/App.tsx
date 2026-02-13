import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { authService } from '@/services/auth.service';
import { libraryService } from '@/services/library.service';
import { HomePage } from '@/pages/Home';
import { LoginPage } from '@/pages/Login';
import type { LoginResult, UnifiedPlaylist, UnifiedSong } from '@/types';

const THEME_MODE_STORAGE_KEY = 'allmusic_theme_mode_v1';
const UI_VERSION_STORAGE_KEY = 'allmusic_ui_version_v1';

type UiVersion = 'current' | 'v4-glam';
type AuthSnapshot = ReturnType<typeof useAuthStore.getState>;
type PlayerSnapshot = ReturnType<typeof usePlayerStore.getState>;

type BridgeAuthState = {
  users: AuthSnapshot['users'];
  cookies: AuthSnapshot['cookies'];
  isAuthenticated: AuthSnapshot['isAuthenticated'];
  hasConnectedAllPlatforms: boolean;
};

type BridgePlaylistResult = Awaited<ReturnType<typeof libraryService.loadUnifiedPlaylists>>;
type BridgePlaylistDetailResult = Awaited<ReturnType<typeof libraryService.loadPlaylistDetail>>;
type BridgeSearchResult = Awaited<ReturnType<typeof libraryService.searchUnifiedSongs>>;
type BridgeDailyResult = Awaited<ReturnType<typeof libraryService.loadDailyRecommendations>>;
type BridgeLyricResult = Awaited<ReturnType<typeof libraryService.loadSongLyrics>>;
type BridgeLikeResult = Awaited<ReturnType<typeof libraryService.likeSong>>;

type BridgePlayerState = Pick<
PlayerSnapshot,
| 'currentSong'
| 'queue'
| 'currentIndex'
| 'isPlaying'
| 'playMode'
| 'volume'
| 'currentTime'
| 'duration'
| 'isLoading'
| 'error'
>;

type BridgeApi = {
  getAuthState: () => Promise<BridgeAuthState>;
  neteaseQRCodeLogin: (
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal,
  ) => Promise<LoginResult>;
  qqQRCodeLogin: (
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal,
  ) => Promise<LoginResult>;
  neteaseCellphoneLogin: (phone: string, password: string, countryCode?: string) => Promise<LoginResult>;
  qqCookieLogin: (cookie: string, nickname?: string) => Promise<LoginResult>;
  verifyLogin: (platform: 'netease' | 'qq', cookie: string) => Promise<boolean>;
  logoutPlatform: (platform: 'netease' | 'qq') => Promise<void>;
  loadPlaylists: () => Promise<BridgePlaylistResult>;
  loadPlaylistDetail: (playlist: UnifiedPlaylist) => Promise<BridgePlaylistDetailResult>;
  searchSongs: (keyword: string, limit?: number) => Promise<BridgeSearchResult>;
  loadDailyRecommendations: (limit?: number) => Promise<BridgeDailyResult>;
  loadSongLyrics: (song: UnifiedSong) => Promise<BridgeLyricResult>;
  likeSong: (song: UnifiedSong, like?: boolean) => Promise<BridgeLikeResult>;
  playSongs: (songs: UnifiedSong[], startIndex?: number) => Promise<void>;
  playAt: (index: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  setVolume: (volumePercent: number) => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  retryCurrent: () => Promise<void>;
  getPlayerState: () => Promise<BridgePlayerState>;
  switchUiVersion: (next: UiVersion) => Promise<void>;
  getUiVersion: () => Promise<UiVersion>;
};

declare global {
  interface Window {
    __ALLMUSIC_BRIDGE__?: BridgeApi;
  }
}

function buildLibraryContext() {
  const auth = useAuthStore.getState();
  return {
    neteaseUserId: auth.users.netease?.userId,
    neteaseCookie: auth.cookies.netease,
    qqUserId: auth.users.qq?.userId,
    qqCookie: auth.cookies.qq,
  };
}

function V4AudioEngine({
  onSeekReady,
  onRetryReady,
}: {
  onSeekReady: (fn: (ms: number) => void) => void;
  onRetryReady: (fn: () => void) => void;
}) {
  const { seekTo, retryCurrent } = useAudioPlayer();

  useEffect(() => {
    onSeekReady(seekTo);
    onRetryReady(retryCurrent);

    return () => {
      onSeekReady(() => undefined);
      onRetryReady(() => undefined);
    };
  }, [onRetryReady, onSeekReady, retryCurrent, seekTo]);

  return null;
}

function App() {
  const { users, loadStoredCredentials } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [uiVersion, setUiVersion] = useState<UiVersion>(() => {
    if (typeof window === 'undefined') {
      return 'current';
    }
    return window.localStorage.getItem(UI_VERSION_STORAGE_KEY) === 'v4-glam' ? 'v4-glam' : 'current';
  });

  const seekRef = useRef<(ms: number) => void>(() => undefined);
  const retryRef = useRef<() => void>(() => undefined);

  const handleSeekReady = useCallback((fn: (ms: number) => void) => {
    seekRef.current = fn;
  }, []);

  const handleRetryReady = useCallback((fn: () => void) => {
    retryRef.current = fn;
  }, []);

  const persistLoginResult = useCallback(async (result: LoginResult): Promise<LoginResult> => {
    if (result.success && result.user && result.cookie) {
      await useAuthStore.getState().setUser(result.user.platform, result.user, result.cookie);
    }
    return result;
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadStoredCredentials();
      if (window.localStorage.getItem(THEME_MODE_STORAGE_KEY) === 'day') {
        document.body.classList.add('am-theme-day');
      } else {
        document.body.classList.remove('am-theme-day');
      }
      setMounted(true);
    };

    void init();
  }, [loadStoredCredentials]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, uiVersion);
    document.body.classList.toggle('am-ui-v4', uiVersion === 'v4-glam');
  }, [uiVersion]);

  useEffect(() => {
    window.__ALLMUSIC_BRIDGE__ = {
      getAuthState: async () => {
        const auth = useAuthStore.getState();
        return {
          users: auth.users,
          cookies: auth.cookies,
          isAuthenticated: auth.isAuthenticated,
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
      loadPlaylists: async () => libraryService.loadUnifiedPlaylists(buildLibraryContext()),
      loadPlaylistDetail: async (playlist) => libraryService.loadPlaylistDetail(playlist, buildLibraryContext()),
      searchSongs: async (keyword, limit = 30) => libraryService.searchUnifiedSongs(keyword, buildLibraryContext(), limit),
      loadDailyRecommendations: async (limit = 30) => libraryService.loadDailyRecommendations(buildLibraryContext(), limit),
      loadSongLyrics: async (song) => libraryService.loadSongLyrics(song, buildLibraryContext()),
      likeSong: async (song, like = true) => libraryService.likeSong(song, buildLibraryContext(), like),
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
        };
      },
      switchUiVersion: async (next) => {
        setUiVersion(next);
      },
      getUiVersion: async () => uiVersion,
    };

    return () => {
      delete window.__ALLMUSIC_BRIDGE__;
    };
  }, [persistLoginResult, uiVersion]);

  if (!mounted) {
    return (
      <div className="am-screen min-h-screen flex items-center justify-center px-4">
        <div className="am-panel rounded-xl border px-5 py-3 text-slate-200">Loading ALLMusic...</div>
      </div>
    );
  }

  const hasConnectedAllPlatforms = Boolean(users.netease && users.qq);
  const appView = hasConnectedAllPlatforms ? <HomePage /> : <LoginPage />;
  const isV4Glam = uiVersion === 'v4-glam';

  return (
    <>
      {isV4Glam ? (
        <>
          <V4AudioEngine onSeekReady={handleSeekReady} onRetryReady={handleRetryReady} />
          <iframe
            title="ALLMusic V4 Gemini Fusion UX Glam"
            src="/v4-glam/index.html"
            className="h-screen w-screen border-0 bg-transparent"
          />
        </>
      ) : appView}
    </>
  );
}

export default App;
