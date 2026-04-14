import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAlertStore, useAuthStore, useLocalApiStatusStore, usePlayerStore, useThemeStore } from '@/stores';
import { authService } from '@/services/auth.service';
import { canUseTauriInvoke, isDevLiteMode, isLikelyTauriMobileRuntime, isMobile } from '@/lib/runtime';
import { useLocalApiBootstrap } from '@/hooks/useLocalApiBootstrap';
import { useAppEventListeners } from '@/hooks/useAppEventListeners';
import { LocalApiOverlay } from '@/components/local-api/local-api-overlay';
import { RetroShell } from '@/components/retro/retro-shell';
import { GlobalAlertModal } from '@/components/ui/alert-modal';
import { TopToastViewport } from '@/components/ui/top-toast';
import { APP_THEME_CLASS_MAP, LOCAL_API_READY_EVENT } from '@/constants/app.constants';

function isTransientPlayerStartupError(message: string): boolean {
  return /本地播放服务未启动或端口不可达|failed to fetch|fetch failed|err_connection_refused|network error/i.test(
    message,
  );
}

const AUTH_INVALIDATED_EVENT = 'allmusic:auth-invalidated';
const AUTH_CHECK_INTERVAL_MS = 60_000;
const LOCAL_API_HEALTH_CHECK_INTERVAL_MS = 15_000;
const LOCAL_API_HEALTH_CHECK_TIMEOUT_MS = 2_500;
const LOCAL_API_HEALTH_ENDPOINTS = {
  netease: 'http://127.0.0.1:3000/login/status',
  qq: 'http://127.0.0.1:3001/health',
} as const;

async function probeLocalApiEndpoint(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), LOCAL_API_HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function App() {
  const { users, cookies, loadStoredCredentials, removeUser, setUser } = useAuthStore();
  const playerError = usePlayerStore((state) => state.error);
  const setPlayerError = usePlayerStore((state) => state.setError);
  const pushAlert = useAlertStore((state) => state.pushAlert);
  const setLocalApiServiceState = useLocalApiStatusStore((state) => state.setServiceState);
  const theme = useThemeStore((state) => state.theme);
  const [mounted, setMounted] = useState(false);

  const latestPlayerErrorRef = useRef<string | null>(null);
  const authCheckInFlightRef = useRef(false);
  const localApiRecoveryInFlightRef = useRef(false);

  const notifyLocalApiReady = useCallback(() => {
    if (typeof window === 'undefined') return;
    const runtimeWindow = window as Window & { __ALLMUSIC_LOCAL_API_READY__?: boolean };
    runtimeWindow.__ALLMUSIC_LOCAL_API_READY__ = true;
    window.dispatchEvent(new CustomEvent(LOCAL_API_READY_EVENT));
  }, []);

  const notifyAuthInvalidated = useCallback((platform: 'netease' | 'qq') => {
    if (typeof window === 'undefined') return;
    const payload = { type: AUTH_INVALIDATED_EVENT, platform };
    window.dispatchEvent(new CustomEvent(AUTH_INVALIDATED_EVENT, { detail: payload }));
  }, []);

  const {
    localApiProgress,
    setLocalApiProgress,
    isAutoFixingLocalApi,
    bootstrapLocalApis,
    handleRetryBootstrap,
    handleAutoFixLocalApi,
    localApiOverlayHideTimerRef,
  } = useLocalApiBootstrap({ pushAlert });

  useAppEventListeners({
    pushAlert,
    notifyLocalApiReady,
    setLocalApiProgress,
    localApiOverlayHideTimerRef,
  });

  const isLocalApiReady = localApiProgress.serviceState.netease === 'ready'
    && localApiProgress.serviceState.qq === 'ready'
    && !localApiProgress.failed;

  useEffect(() => {
    void loadStoredCredentials().then(() => setMounted(true));
  }, [loadStoredCredentials]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    for (const cls of Object.values(APP_THEME_CLASS_MAP)) body.classList.remove(cls);
    body.classList.add(APP_THEME_CLASS_MAP[theme]);
  }, [theme]);

  useEffect(() => {
    setLocalApiServiceState(localApiProgress.serviceState);
  }, [localApiProgress.serviceState, setLocalApiServiceState]);

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
    if (!mounted || !canUseTauriInvoke() || isLikelyTauriMobileRuntime()) {
      return;
    }

    let cancelled = false;

    const ensureLocalApisHealthy = async () => {
      if (localApiRecoveryInFlightRef.current) {
        return;
      }

      const serviceStates = Object.values(localApiProgress.serviceState);
      const isBootstrapping = serviceStates.some((state) =>
        state === 'pending' || state === 'starting' || state === 'installing',
      );
      if (isBootstrapping) {
        return;
      }

      const [neteaseOk, qqOk] = await Promise.all([
        probeLocalApiEndpoint(LOCAL_API_HEALTH_ENDPOINTS.netease),
        probeLocalApiEndpoint(LOCAL_API_HEALTH_ENDPOINTS.qq),
      ]);

      if (cancelled || (neteaseOk && qqOk)) {
        return;
      }

      if (typeof window !== 'undefined') {
        const runtimeWindow = window as Window & { __ALLMUSIC_LOCAL_API_READY__?: boolean };
        runtimeWindow.__ALLMUSIC_LOCAL_API_READY__ = false;
      }

      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        failed: false,
        percent: Math.min(prev.percent, 18),
        message: '检测到本地 API 已断开，正在尝试恢复...',
        logs: [...prev.logs, '检测到本地 API 掉线，开始自动重启。'].slice(-10),
        serviceState: {
          netease: neteaseOk ? prev.serviceState.netease : 'error',
          qq: qqOk ? prev.serviceState.qq : 'error',
        },
      }));

      localApiRecoveryInFlightRef.current = true;
      try {
        await invoke('ensure_local_api_services');
      } catch (error) {
        if (!cancelled) {
          console.warn('[ALLMusic] failed to recover local APIs:', error);
        }
      } finally {
        localApiRecoveryInFlightRef.current = false;
      }
    };

    void ensureLocalApisHealthy();
    const timer = window.setInterval(() => {
      void ensureLocalApisHealthy();
    }, LOCAL_API_HEALTH_CHECK_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void ensureLocalApisHealthy();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [
    localApiProgress.serviceState,
    mounted,
    setLocalApiProgress,
  ]);

  useEffect(() => {
    if (!mounted || !isLocalApiReady) {
      return;
    }

    const platforms = (['netease', 'qq'] as const).filter((platform) =>
      Boolean(users[platform] && cookies[platform]?.trim()),
    );
    if (platforms.length === 0) {
      return;
    }

    let cancelled = false;

    const checkAuthState = async () => {
      if (authCheckInFlightRef.current) {
        return;
      }
      authCheckInFlightRef.current = true;

      try {
        const expiredPlatforms: Array<'netease' | 'qq'> = [];

        await Promise.all(platforms.map(async (platform) => {
          const latestState = useAuthStore.getState();
          const cookie = latestState.cookies[platform];
          const currentUser = latestState.users[platform];
          if (!cookie?.trim() || !currentUser) {
            return;
          }

          const result = await authService.renewLogin(platform, cookie);
          if (cancelled || result.status === 'invalid') {
            if (result.status === 'invalid') {
              expiredPlatforms.push(platform);
            }
            return;
          }

          const nextCookie = result.cookie?.trim() || cookie.trim();
          const nextUser = result.user;
          const shouldPersist = result.status === 'recovered'
            || nextCookie !== cookie.trim()
            || Boolean(
              nextUser
              && (
                nextUser.userId !== currentUser.userId
                || nextUser.nickname !== currentUser.nickname
                || nextUser.avatarUrl !== currentUser.avatarUrl
              )
            );

          if (!shouldPersist) {
            return;
          }

          await setUser(
            platform,
            {
              platform,
              userId: nextUser?.userId || currentUser.userId,
              nickname: nextUser?.nickname || currentUser.nickname,
              avatarUrl: nextUser?.avatarUrl || currentUser.avatarUrl,
              isLoggedIn: true,
            },
            nextCookie,
          );
        }));

        if (cancelled || expiredPlatforms.length === 0) {
          return;
        }

        for (const platform of expiredPlatforms) {
          const platformLabel = platform === 'netease' ? '网易云音乐' : 'QQ 音乐';
          await removeUser(platform);
          notifyAuthInvalidated(platform);
          pushAlert({
            level: 'error',
            title: `${platformLabel}登录已失效`,
            message: `${platformLabel}登录状态已失效，自动重连失败，请重新扫码登录。`,
            source: `auth.invalidated.${platform}`,
            dedupeKey: `auth-invalidated:${platform}`,
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[ALLMusic] failed to verify auth status:', error);
        }
      } finally {
        authCheckInFlightRef.current = false;
      }
    };

    void checkAuthState();
    const timer = window.setInterval(() => {
      void checkAuthState();
    }, AUTH_CHECK_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkAuthState();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [
    cookies.netease,
    cookies.qq,
    isLocalApiReady,
    mounted,
    notifyAuthInvalidated,
    pushAlert,
    removeUser,
    setUser,
    users.netease,
    users.qq,
  ]);

  useEffect(() => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) return;
    return () => { void invoke('shutdown_local_api_services').catch(() => undefined); };
  }, []);

  useEffect(() => () => {
    if (localApiOverlayHideTimerRef.current !== null) {
      window.clearTimeout(localApiOverlayHideTimerRef.current);
      localApiOverlayHideTimerRef.current = null;
    }
  }, [localApiOverlayHideTimerRef]);

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
      dedupeKey: `player-error:${playerError}`,
    });
  }, [localApiProgress.failed, localApiProgress.percent, localApiProgress.visible, playerError, pushAlert, setPlayerError]);

  if (!mounted) {
    return (
      <div className="am-screen min-h-screen flex items-center justify-center px-4">
        <div className="am-panel rounded-xl border px-5 py-3 text-slate-200">Loading ALLMusic...</div>
      </div>
    );
  }

  return (
    <>
      <RetroShell />
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
