import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { usePlayerStore } from '@/stores';
import { canUseTauriInvoke, isLikelyTauriMobileRuntime } from '@/lib/runtime';
import { normalizeUnknownErrorMessage } from '@/lib/local-api-errors';
import { MEDIA_CONTROL_EVENT } from '@/constants/app.constants';
import type { LocalApiProgressPayload, MediaControlEventPayload } from '@/types/bridge.types';
import type { LocalApiProgressState } from '@/hooks/useLocalApiBootstrap';
import type { AlertInput, AlertItem } from '@/stores/alert.store';

interface UseAppEventListenersParams {
  pushAlert: (input: AlertInput) => AlertItem | null;
  notifyLocalApiReady: () => void;
  setLocalApiProgress: React.Dispatch<React.SetStateAction<LocalApiProgressState>>;
  localApiOverlayHideTimerRef: React.MutableRefObject<number | null>;
}

export function useAppEventListeners({
  pushAlert,
  notifyLocalApiReady,
  setLocalApiProgress,
  localApiOverlayHideTimerRef,
}: UseAppEventListenersParams): void {
  const lastProgressStageRef = useRef('');
  const lastProgressPercentRef = useRef(0);
  const lastProgressAtRef = useRef(0);

  // Local API progress listener (Tauri desktop only)
  useEffect(() => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void listen<LocalApiProgressPayload>('local-api-progress', (event) => {
      const payload = event.payload;
      const stage = payload.stage || '';
      const nextPercent = Number.isFinite(payload.percent) ? payload.percent : 0;
      const nextMessage = payload.message || '正在启动本地 API...';
      const isError = payload.level === 'error' || stage.endsWith('_error') || stage === 'error';
      const isServiceReadyStage = stage.endsWith('_ready');
      const isReadyStage = stage === 'ready';
      const isNoisyLogStage = stage.endsWith('_log') || stage === 'log_warning';
      const isCriticalStage = isError || isReadyStage || isServiceReadyStage;

      if (isNoisyLogStage && !isError) {
        return;
      }

      const now = Date.now();
      if (!isCriticalStage) {
        const sameStage = stage === lastProgressStageRef.current;
        const withinThrottleWindow = now - lastProgressAtRef.current < 450;
        const percentDelta = Math.abs(nextPercent - lastProgressPercentRef.current);
        if (sameStage && withinThrottleWindow && percentDelta < 8) {
          return;
        }
      }

      lastProgressStageRef.current = stage;
      lastProgressPercentRef.current = nextPercent;
      lastProgressAtRef.current = now;

      const nextLog = payload.service ? `[${payload.service}] ${nextMessage}` : nextMessage;

      setLocalApiProgress((prev) => {
        let nextServiceState = prev.serviceState;
        if (payload.service) {
          let nextState = nextServiceState[payload.service];
          if (isServiceReadyStage) {
            nextState = 'ready';
          } else if (isError) {
            nextState = 'error';
          } else if (stage.includes('install')) {
            nextState = 'installing';
          } else if (stage.includes('start') || stage.includes('wait') || stage.includes('log')) {
            nextState = 'starting';
          }

          if (nextState !== nextServiceState[payload.service]) {
            nextServiceState = { ...nextServiceState, [payload.service]: nextState };
          }
        }

        const nextVisible = isError || prev.failed || prev.visible || prev.percent < 100;
        const nextFailed = prev.failed || isError;
        const nextBoundedPercent = Math.max(prev.percent, Math.min(100, Math.max(0, nextPercent)));
        const nextLogs = prev.logs[prev.logs.length - 1] === nextLog
          ? prev.logs
          : [...prev.logs, nextLog].slice(-6);

        if (
          prev.visible === nextVisible
          && prev.failed === nextFailed
          && prev.percent === nextBoundedPercent
          && prev.message === nextMessage
          && prev.serviceState === nextServiceState
          && prev.logs === nextLogs
        ) {
          return prev;
        }

        return {
          ...prev,
          // 启动完成并自动隐藏后，不再被普通日志事件重新拉起遮罩。
          visible: nextVisible,
          failed: nextFailed,
          percent: nextBoundedPercent,
          message: nextMessage,
          serviceState: nextServiceState,
          logs: nextLogs,
        };
      });

      if (isError) {
        pushAlert({
          level: 'error',
          title: '本地 API 服务异常',
          message: nextMessage,
          source: payload.service ? `local-api.${payload.service}` : 'local-api.progress',
          dedupeKey: `local-api-progress:${payload.service || 'shared'}:${stage}:${nextMessage}`,
        });
        // 延迟5秒自动关闭阻塞 overlay，保留 toast 提醒
        if (localApiOverlayHideTimerRef.current !== null) {
          window.clearTimeout(localApiOverlayHideTimerRef.current);
        }
        localApiOverlayHideTimerRef.current = window.setTimeout(() => {
          setLocalApiProgress((prev) => ({ ...prev, visible: false }));
          localApiOverlayHideTimerRef.current = null;
        }, 5000);
      }

      if (isReadyStage && !isError) {
        notifyLocalApiReady();
        if (localApiOverlayHideTimerRef.current !== null) {
          window.clearTimeout(localApiOverlayHideTimerRef.current);
        }
        localApiOverlayHideTimerRef.current = window.setTimeout(() => {
          setLocalApiProgress((prev) => (prev.failed ? prev : { ...prev, visible: false }));
          localApiOverlayHideTimerRef.current = null;
        }, 650);
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((error) => {
      console.warn('[ALLMusic] failed to listen local-api-progress event:', error);
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [localApiOverlayHideTimerRef, notifyLocalApiReady, pushAlert, setLocalApiProgress]);

  // Media control listener (Tauri desktop only)
  useEffect(() => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void listen<MediaControlEventPayload>(MEDIA_CONTROL_EVENT, (event) => {
      const action = event.payload?.action;
      const player = usePlayerStore.getState();

      if (action === 'toggle') {
        if (!player.currentSong && player.queue.length === 0) {
          return;
        }
        player.togglePlay();
        return;
      }

      if (action === 'next') {
        player.playNext();
        return;
      }

      if (action === 'previous') {
        player.playPrevious();
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((error) => {
      console.warn('[ALLMusic] failed to listen media control event:', error);
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Auth store probe (Tauri mobile only)
  useEffect(() => {
    if (!canUseTauriInvoke() || !isLikelyTauriMobileRuntime()) {
      return;
    }

    let cancelled = false;

    void invoke<{
      app_data_dir: string;
      store_file: string;
      store_file_exists: boolean;
      roundtrip_ok: boolean;
      previous_probe_found: boolean;
    }>('probe_auth_store')
      .then((result) => {
        if (cancelled) {
          return;
        }
        console.info(
          `[ALLMusic][AuthStoreProbe] roundtrip=${result.roundtrip_ok} previous=${result.previous_probe_found} store=${result.store_file}`,
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error('[ALLMusic][AuthStoreProbe] probe failed:', error);
        pushAlert({
          level: 'warning',
          title: '本地存储检查失败',
          message: normalizeUnknownErrorMessage(error),
          source: 'auth.store-probe',
          dedupeKey: `auth-store-probe:${normalizeUnknownErrorMessage(error)}`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [pushAlert]);

  // Global error handler (window.error + unhandledrejection)
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const onError = (event: ErrorEvent) => {
      const message = normalizeUnknownErrorMessage(event.error ?? event.message);
      if (!message) {
        return;
      }

      const locationParts = [
        event.filename || '',
        typeof event.lineno === 'number' && event.lineno > 0 ? String(event.lineno) : '',
        typeof event.colno === 'number' && event.colno > 0 ? String(event.colno) : '',
      ].filter(Boolean);
      const detail = event.error instanceof Error
        ? (event.error.stack || undefined)
        : (locationParts.length > 0 ? `位置：${locationParts.join(':')}` : undefined);

      pushAlert({
        level: 'error',
        title: '运行时异常',
        message,
        source: 'window.error',
        detail,
        dedupeKey: `window-error:${message}`,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = normalizeUnknownErrorMessage(reason);
      if (!message) {
        return;
      }

      let detail: string | undefined;
      if (reason instanceof Error) {
        detail = reason.stack || undefined;
      } else if (typeof reason === 'object' && reason !== null) {
        try {
          detail = JSON.stringify(reason, null, 2);
        } catch {
          detail = String(reason);
        }
      }

      pushAlert({
        level: 'error',
        title: '异步任务异常',
        message,
        source: 'window.unhandledrejection',
        detail,
        dedupeKey: `window-unhandled:${message}`,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [pushAlert]);

  // Network status handler (offline / online)
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const onOffline = () => {
      pushAlert({
        level: 'warning',
        title: '网络连接已断开',
        message: '检测到当前设备离线，歌单加载、搜索和播放可能失败。',
        source: 'network.status',
        dedupeKey: 'network:offline',
      });
    };

    const onOnline = () => {
      pushAlert({
        level: 'info',
        title: '网络连接已恢复',
        message: '网络已恢复，可以重试刚才失败的操作。',
        source: 'network.status',
        dedupeKey: 'network:online',
      });
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [pushAlert]);
}
