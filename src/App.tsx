import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAlertStore, useAuthStore, usePlayerStore, useThemeStore } from '@/stores';
import { canUseTauriInvoke, isDevLiteMode, isLikelyTauriMobileRuntime, isMobile } from '@/lib/runtime';
import { captureUiSwitchPlaybackSnapshot, restoreUiSwitchPlaybackSnapshot } from '@/lib/ui-switch-snapshot';
import { buildAuthFingerprint, bridgeCacheStore, bridgeInFlightStore } from '@/bridge/cache';
import {
  resolvePlaylistsWithBridgeCache as resolvePlaylistsCached,
  resolvePlaylistDetailWithBridgeCache as resolveDetailCached,
  resolveDailyRecommendationsWithBridgeCache as resolveDailyCached,
} from '@/bridge/cache-resolvers';
import { useBridgeApi } from '@/bridge/api-implementation';
import { useLocalApiBootstrap } from '@/hooks/useLocalApiBootstrap';
import { useAppEventListeners } from '@/hooks/useAppEventListeners';
import { useThumbnailToolbar } from '@/hooks/useThumbnailToolbar';
import { BridgeAudioEngine } from '@/components/bridge/bridge-audio-engine';
import { LocalApiOverlay } from '@/components/local-api/local-api-overlay';
import { HomePage } from '@/pages/Home';
import { LoginPage } from '@/pages/Login';
import { UiVersionSwitcher } from '@/components/theme/ui-version-switcher';
import { GlobalAlertModal } from '@/components/ui/alert-modal';
import { TopToastViewport } from '@/components/ui/top-toast';
import {
  APP_THEME_CLASS_MAP,
  BRIDGE_CACHE_UPDATED_EVENT,
  LOCAL_API_READY_EVENT,
  OPEN_UI_SWITCHER_EVENT,
  UI_FRAME_SRC_MAP,
  UI_FRAME_TITLE_MAP,
} from '@/constants/app.constants';
import type { LoginResult, UnifiedPlaylist } from '@/types';
import type { BridgeCacheUpdatePayload, BridgeDailyResult, BridgeLoadOptions, BridgePlaylistDetailResult, BridgePlaylistResult } from '@/types/bridge.types';
import { UI_VERSION_SWITCH_ENABLED, type UiVersion } from '@/stores/theme.store';

declare global {
  interface Window {
    __ALLMUSIC_BRIDGE__?: unknown;
    __ALLMUSIC_LOCAL_API_READY__?: boolean;
  }
}

function isTransientPlayerStartupError(message: string): boolean {
  return /本地播放服务未启动或端口不可达|failed to fetch|fetch failed|err_connection_refused|network error/i.test(
    message,
  );
}

const NOOP_SEEK = () => undefined;
const NOOP_RETRY = () => undefined;
const UI_SWITCH_RESTORE_INITIAL_DELAY_MS = 120;
const UI_SWITCH_RESTORE_RETRY_DELAY_MS = 180;
const UI_SWITCH_RESTORE_MAX_ATTEMPTS = 8;

function App() {
  const { users, cookies, loadStoredCredentials } = useAuthStore();
  const playerError = usePlayerStore((state) => state.error);
  const setPlayerError = usePlayerStore((state) => state.setError);
  const pushAlert = useAlertStore((state) => state.pushAlert);
  const theme = useThemeStore((state) => state.theme);
  const uiVersion = useThemeStore((state) => state.uiVersion);
  const setUiVersion = useThemeStore((state) => state.setUiVersion);
  const [mounted, setMounted] = useState(false);
  const [uiSwitching, setUiSwitching] = useState(false);
  const [isUiFrameLoading, setIsUiFrameLoading] = useState(uiVersion !== 'current');
  const [uiSwitcherOpen, setUiSwitcherOpen] = useState(false);

  const seekRef = useRef<(ms: number) => void>(NOOP_SEEK);
  const retryRef = useRef<() => void>(NOOP_RETRY);
  const latestPlayerErrorRef = useRef<string | null>(null);
  const uiSwitchRecoveryTimerRef = useRef<number | null>(null);
  const uiFrameRef = useRef<HTMLIFrameElement | null>(null);
  const authFingerprintRef = useRef<string>(buildAuthFingerprint(useAuthStore.getState()));

  // -- Thin glue callbacks that reference local refs / iframe --

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

  const emitBridgeCacheUpdated = useCallback((payload: Omit<BridgeCacheUpdatePayload, 'type'>) => {
    if (typeof window === 'undefined') return;
    const eventPayload: BridgeCacheUpdatePayload = { type: BRIDGE_CACHE_UPDATED_EVENT, ...payload };
    window.dispatchEvent(new CustomEvent(BRIDGE_CACHE_UPDATED_EVENT, { detail: eventPayload }));
    if (uiFrameRef.current?.contentWindow) {
      uiFrameRef.current.contentWindow.postMessage(eventPayload, window.location.origin);
    }
  }, []);

  const notifyLocalApiReady = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.__ALLMUSIC_LOCAL_API_READY__ = true;
    window.dispatchEvent(new CustomEvent(LOCAL_API_READY_EVENT));
    if (uiFrameRef.current?.contentWindow) {
      uiFrameRef.current.contentWindow.postMessage({ type: LOCAL_API_READY_EVENT }, window.location.origin);
    }
  }, []);

  const resolvePlaylistsWithBridgeCache = useCallback(
    (options?: BridgeLoadOptions): Promise<BridgePlaylistResult> =>
      resolvePlaylistsCached(options, emitBridgeCacheUpdated, pushAlert),
    [emitBridgeCacheUpdated, pushAlert],
  );

  const resolvePlaylistDetailWithBridgeCache = useCallback(
    (playlist: UnifiedPlaylist, options?: BridgeLoadOptions): Promise<BridgePlaylistDetailResult> =>
      resolveDetailCached(playlist, options, emitBridgeCacheUpdated, pushAlert),
    [emitBridgeCacheUpdated, pushAlert],
  );

  const resolveDailyRecommendationsWithBridgeCache = useCallback(
    (options?: (BridgeLoadOptions & { limit?: number }) | number): Promise<BridgeDailyResult> =>
      resolveDailyCached(options, emitBridgeCacheUpdated, pushAlert),
    [emitBridgeCacheUpdated, pushAlert],
  );

  // -- Extracted hooks --

  const {
    localApiProgress,
    setLocalApiProgress,
    isAutoFixingLocalApi,
    bootstrapLocalApis,
    handleRetryBootstrap,
    handleAutoFixLocalApi,
    localApiOverlayHideTimerRef,
  } = useLocalApiBootstrap({ pushAlert, notifyLocalApiReady });

  useAppEventListeners({
    pushAlert,
    notifyLocalApiReady,
    setLocalApiProgress,
    localApiOverlayHideTimerRef,
  });

  // 初始化 Windows 缩略图工具栏同步
  useThumbnailToolbar();

  useBridgeApi({
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
  });

  // -- Remaining lifecycle effects --

  useEffect(() => {
    void loadStoredCredentials().then(() => setMounted(true));
  }, [loadStoredCredentials]);

  useEffect(() => {
    const nextFingerprint = buildAuthFingerprint(useAuthStore.getState());
    if (authFingerprintRef.current === nextFingerprint) return;
    authFingerprintRef.current = nextFingerprint;
    bridgeCacheStore.clear();
    bridgeInFlightStore.clear();
  }, [cookies.netease, cookies.qq, users.netease?.userId, users.qq?.userId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    for (const cls of Object.values(APP_THEME_CLASS_MAP)) body.classList.remove(cls);
    body.classList.add(APP_THEME_CLASS_MAP[theme]);
  }, [theme]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const mobile = isMobile();
    document.body.classList.toggle('is-mobile', mobile);
    return () => { document.body.classList.remove('is-mobile'); };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const enabled = isDevLiteMode();
    document.body.classList.toggle('am-dev-lite', enabled);
    return () => { document.body.classList.remove('am-dev-lite'); };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void bootstrapLocalApis();
  }, [bootstrapLocalApis, mounted]);

  useEffect(() => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) return;
    return () => { void invoke('shutdown_local_api_services').catch(() => undefined); };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('am-ui-v4', uiVersion === 'v4-glam');
  }, [uiVersion]);

  useEffect(() => {
    if (uiVersion === 'current') setIsUiFrameLoading(false);
    if (uiSwitchRecoveryTimerRef.current !== null) {
      window.clearTimeout(uiSwitchRecoveryTimerRef.current);
      uiSwitchRecoveryTimerRef.current = null;
    }
    if (!uiSwitching) return;

    let attempts = 0;
    const attemptRestore = () => {
      attempts += 1;
      const result = restoreUiSwitchPlaybackSnapshot(seekRef.current);

      // Stop immediately if no snapshot or invalid/expired/song_mismatch
      if (!result.success && ['no_snapshot', 'invalid_snapshot', 'expired', 'song_mismatch'].includes(result.reason)) {
        setUiSwitching(false);
        uiSwitchRecoveryTimerRef.current = null;
        return;
      }

      // Retry only for restore_failed
      if (result.success || attempts >= UI_SWITCH_RESTORE_MAX_ATTEMPTS) {
        setUiSwitching(false);
        uiSwitchRecoveryTimerRef.current = null;
        return;
      }

      uiSwitchRecoveryTimerRef.current = window.setTimeout(
        attemptRestore,
        UI_SWITCH_RESTORE_RETRY_DELAY_MS,
      );
    };

    uiSwitchRecoveryTimerRef.current = window.setTimeout(
      attemptRestore,
      UI_SWITCH_RESTORE_INITIAL_DELAY_MS,
    );
  }, [uiSwitching, uiVersion]);

  useEffect(() => () => {
    if (uiSwitchRecoveryTimerRef.current !== null) {
      window.clearTimeout(uiSwitchRecoveryTimerRef.current);
      uiSwitchRecoveryTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (localApiOverlayHideTimerRef.current !== null) {
      window.clearTimeout(localApiOverlayHideTimerRef.current);
      localApiOverlayHideTimerRef.current = null;
    }
  }, [localApiOverlayHideTimerRef]);

  useEffect(() => {
    if (!UI_VERSION_SWITCH_ENABLED) { setUiSwitcherOpen(false); return; }
    const handleOpen = () => setUiSwitcherOpen(true);
    const onMessage = (event: MessageEvent<unknown>) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      const frameWindow = uiFrameRef.current?.contentWindow;
      if (frameWindow && event.source !== frameWindow) return;
      if ((payload as { type?: string }).type === OPEN_UI_SWITCHER_EVENT) handleOpen();
    };
    window.addEventListener('message', onMessage);
    window.addEventListener(OPEN_UI_SWITCHER_EVENT, handleOpen);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener(OPEN_UI_SWITCHER_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    if (!playerError) { latestPlayerErrorRef.current = null; return; }
    const isBootstrapping = localApiProgress.visible && !localApiProgress.failed && localApiProgress.percent < 100;
    if (isBootstrapping && isTransientPlayerStartupError(playerError)) {
      setPlayerError(null);
      latestPlayerErrorRef.current = null;
      return;
    }
    if (latestPlayerErrorRef.current === playerError) return;
    latestPlayerErrorRef.current = playerError;
    pushAlert({
      level: 'error',
      title: '播放异常',
      message: playerError,
      source: 'player.engine',
      actionLabel: '重试当前歌曲',
      onAction: () => { retryRef.current(); },
      dedupeKey: `player-error:${playerError}`,
    });
  }, [localApiProgress.failed, localApiProgress.percent, localApiProgress.visible, playerError, pushAlert, setPlayerError]);

  const handleUiFrameLoad = useCallback(() => {
    setIsUiFrameLoading(false);
    const result = restoreUiSwitchPlaybackSnapshot(seekRef.current);
    if (result.success) {
      setUiSwitching(false);
    }
    notifyLocalApiReady();
  }, [notifyLocalApiReady]);

  // -- Render --

  if (!mounted) {
    return (
      <div className="am-screen min-h-screen flex items-center justify-center px-4">
        <div className="am-panel rounded-xl border px-5 py-3 text-slate-200">Loading ALLMusic...</div>
      </div>
    );
  }

  const hasConnectedAllPlatforms = Boolean(users.netease && users.qq);
  const appView = hasConnectedAllPlatforms ? <HomePage /> : <LoginPage />;
  const isIframeUi = uiVersion !== 'current';
  const iframeUiVersion = isIframeUi ? uiVersion as Exclude<UiVersion, 'current'> : null;
  const iframeSrc = iframeUiVersion ? UI_FRAME_SRC_MAP[iframeUiVersion] : null;
  const iframeTitle = iframeUiVersion ? UI_FRAME_TITLE_MAP[iframeUiVersion] : 'ALLMusic UI Frame';

  return (
    <>
      {(isIframeUi || uiSwitching) && (
        <BridgeAudioEngine onSeekReady={handleSeekReady} onRetryReady={handleRetryReady} />
      )}
      {isIframeUi ? (
        <>
          <iframe
            ref={uiFrameRef}
            title={iframeTitle}
            src={iframeSrc || undefined}
            onLoad={handleUiFrameLoad}
            className="h-screen w-screen border-0 bg-transparent"
          />
          {(uiSwitching || isUiFrameLoading) && (
            <div className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/85 px-4 py-3 text-sm text-slate-100 shadow-2xl">
                正在切换 UI 版本...
              </div>
            </div>
          )}
        </>
      ) : appView}
      {isIframeUi && UI_VERSION_SWITCH_ENABLED && (
        <div className="am-global-ui-switcher-wrap">
          <UiVersionSwitcher
            align="right"
            open={uiSwitcherOpen}
            onOpenChange={setUiSwitcherOpen}
            triggerLabel="切换主题"
          />
        </div>
      )}
      <LocalApiOverlay
        {...localApiProgress}
        isAutoFixing={isAutoFixingLocalApi}
        onAutoFix={handleAutoFixLocalApi}
        onRetry={handleRetryBootstrap}
      />
      <TopToastViewport />
      <GlobalAlertModal />
    </>
  );
}

export default App;
