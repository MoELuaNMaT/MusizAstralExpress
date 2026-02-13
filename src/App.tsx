import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore, usePlayerStore } from '@/stores';
import { stopSharedAudioPlayback, useAudioPlayer } from '@/hooks/useAudioPlayer';
import { authService } from '@/services/auth.service';
import { libraryService } from '@/services/library.service';
import { HomePage } from '@/pages/Home';
import { LoginPage } from '@/pages/Login';
import type { LoginResult, UnifiedPlaylist, UnifiedSong } from '@/types';

const THEME_MODE_STORAGE_KEY = 'allmusic_theme_mode_v1';
const UI_VERSION_STORAGE_KEY = 'allmusic_ui_version_v1';
const LOCAL_API_READY_EVENT = 'allmusic:local-api-ready';

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

type LocalApiServiceState = 'pending' | 'starting' | 'installing' | 'ready' | 'error';

type LocalApiProgressPayload = {
  stage: string;
  service?: 'netease' | 'qq';
  message: string;
  percent: number;
  level?: 'info' | 'warn' | 'error';
  timestamp?: number;
};

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

function canUseTauriInvoke(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof tauriInternals?.invoke === 'function';
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
  const localApiBootstrappedRef = useRef(false);
  const v4FrameRef = useRef<HTMLIFrameElement | null>(null);
  const [localApiProgress, setLocalApiProgress] = useState<{
    visible: boolean;
    percent: number;
    message: string;
    logs: string[];
    failed: boolean;
    serviceState: Record<'netease' | 'qq', LocalApiServiceState>;
  }>({
    visible: false,
    percent: 0,
    message: '准备启动本地 API...',
    logs: [],
    failed: false,
    serviceState: {
      netease: 'pending',
      qq: 'pending',
    },
  });

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

  const notifyLocalApiReady = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.dispatchEvent(new CustomEvent(LOCAL_API_READY_EVENT));
    if (v4FrameRef.current?.contentWindow) {
      v4FrameRef.current.contentWindow.postMessage({ type: LOCAL_API_READY_EVENT }, '*');
    }
  }, []);

  const bootstrapLocalApis = useCallback(async () => {
    if (!canUseTauriInvoke() || localApiBootstrappedRef.current) {
      return;
    }

    localApiBootstrappedRef.current = true;
    setLocalApiProgress({
      visible: true,
      percent: 5,
      message: '正在检查并启动本地 API...',
      logs: [],
      failed: false,
      serviceState: {
        netease: 'pending',
        qq: 'pending',
      },
    });

    try {
      const status = await invoke<string>('ensure_local_api_services');
      console.info(`[ALLMusic] ${status}`);
      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        percent: 100,
        failed: false,
        message: '本地 API 已就绪',
        serviceState: {
          netease: 'ready',
          qq: 'ready',
        },
        logs: [...prev.logs, status].slice(-10),
      }));
      notifyLocalApiReady();

      window.setTimeout(() => {
        setLocalApiProgress((prev) => ({ ...prev, visible: false }));
      }, 650);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ALLMusic] 本地 API 启动失败:', message);
      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        failed: true,
        percent: Math.max(prev.percent, 100),
        message: `本地 API 启动失败：${message}`,
        logs: [...prev.logs, message].slice(-10),
        serviceState: {
          netease: prev.serviceState.netease === 'ready' ? 'ready' : 'error',
          qq: prev.serviceState.qq === 'ready' ? 'ready' : 'error',
        },
      }));
      localApiBootstrappedRef.current = false;
    }
  }, [notifyLocalApiReady]);

  const handleRetryBootstrap = useCallback(() => {
    localApiBootstrappedRef.current = false;
    void bootstrapLocalApis();
  }, [bootstrapLocalApis]);

  useEffect(() => {
    if (!canUseTauriInvoke()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void listen<LocalApiProgressPayload>('local-api-progress', (event) => {
      const payload = event.payload;
      const stage = payload.stage || '';
      const nextPercent = Number.isFinite(payload.percent) ? payload.percent : 0;
      const nextMessage = payload.message || '正在启动本地 API...';
      const isError = payload.level === 'error' || stage.endsWith('_error') || stage === 'error';
      const nextLog = payload.service ? `[${payload.service}] ${nextMessage}` : nextMessage;

      setLocalApiProgress((prev) => {
        const nextServiceState = { ...prev.serviceState };
        if (payload.service) {
          if (stage.endsWith('_ready')) {
            nextServiceState[payload.service] = 'ready';
          } else if (isError) {
            nextServiceState[payload.service] = 'error';
          } else if (stage.includes('install')) {
            nextServiceState[payload.service] = 'installing';
          } else if (stage.includes('start') || stage.includes('wait') || stage.includes('log')) {
            nextServiceState[payload.service] = 'starting';
          }
        }

        return {
          ...prev,
          visible: true,
          failed: prev.failed || isError,
          percent: Math.max(prev.percent, Math.min(100, Math.max(0, nextPercent))),
          message: nextMessage,
          serviceState: nextServiceState,
          logs: [...prev.logs, nextLog].slice(-10),
        };
      });

      if (stage === 'ready' && !isError) {
        notifyLocalApiReady();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [notifyLocalApiReady]);

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
    if (!mounted) {
      return;
    }

    void bootstrapLocalApis();
  }, [bootstrapLocalApis, mounted]);

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
        if (next === uiVersion) {
          return;
        }

        // Prevent hidden UI audio from continuing after mode switch.
        const player = usePlayerStore.getState();
        player.setIsPlaying(false);
        player.setIsLoading(false);
        stopSharedAudioPlayback();
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
            ref={v4FrameRef}
            title="ALLMusic V4 Gemini Fusion UX Glam"
            src="/v4-glam/index.html"
            className="h-screen w-screen border-0 bg-transparent"
          />
        </>
      ) : appView}
      {localApiProgress.visible && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/20 bg-slate-900/95 p-5 text-slate-100 shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-medium">本地 API 启动中</span>
              <span className="text-xs text-slate-300">{localApiProgress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700/80">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  localApiProgress.failed ? 'bg-rose-500' : 'bg-cyan-400'
                }`}
                style={{ width: `${localApiProgress.percent}%` }}
              />
            </div>
            <p className={`mt-3 text-sm ${localApiProgress.failed ? 'text-rose-300' : 'text-slate-200'}`}>
              {localApiProgress.message}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {(['netease', 'qq'] as const).map((service) => {
                const state = localApiProgress.serviceState[service];
                const labelMap: Record<LocalApiServiceState, string> = {
                  pending: '等待中',
                  starting: '启动中',
                  installing: '安装依赖中',
                  ready: '已就绪',
                  error: '异常',
                };
                const colorMap: Record<LocalApiServiceState, string> = {
                  pending: 'text-slate-300',
                  starting: 'text-cyan-300',
                  installing: 'text-amber-300',
                  ready: 'text-emerald-300',
                  error: 'text-rose-300',
                };
                return (
                  <div key={service} className="rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2">
                    <div className="font-medium uppercase tracking-wide text-slate-200">{service}</div>
                    <div className={`mt-1 ${colorMap[state]}`}>{labelMap[state]}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
              {localApiProgress.logs.length === 0 ? (
                <div>等待日志输出...</div>
              ) : (
                localApiProgress.logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)
              )}
            </div>
            {localApiProgress.failed && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleRetryBootstrap}
                  className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                >
                  重试启动
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
