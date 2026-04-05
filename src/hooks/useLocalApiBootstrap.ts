import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { canUseTauriInvoke, isLikelyTauriMobileRuntime } from '@/lib/runtime';
import {
  localApiErrorHeadline,
  parseEnvironmentCheckFromErrorMessage,
  resolveLocalApiErrorType,
  resolveServiceStateByMissingRequirements,
} from '@/lib/local-api-errors';
import type {
  LocalApiAutoFixResult,
  LocalApiEnvironmentCheckResult,
  LocalApiErrorType,
  LocalApiMissingRequirement,
  LocalApiServiceState,
} from '@/types/bridge.types';
import type { AlertInput } from '@/stores/alert.store';

export interface LocalApiProgressState {
  visible: boolean;
  percent: number;
  message: string;
  logs: string[];
  failed: boolean;
  errorType: LocalApiErrorType | null;
  missingRequirements: LocalApiMissingRequirement[];
  serviceState: Record<'netease' | 'qq', LocalApiServiceState>;
}

const INITIAL_PROGRESS: LocalApiProgressState = {
  visible: false,
  percent: 0,
  message: '准备启动本地 API...',
  logs: [],
  failed: false,
  errorType: null,
  missingRequirements: [],
  serviceState: {
    netease: 'pending',
    qq: 'pending',
  },
};

interface UseLocalApiBootstrapParams {
  pushAlert: (input: AlertInput) => void;
  notifyLocalApiReady: () => void;
}

export function useLocalApiBootstrap({
  pushAlert,
  notifyLocalApiReady,
}: UseLocalApiBootstrapParams) {
  const [localApiProgress, setLocalApiProgress] = useState<LocalApiProgressState>(INITIAL_PROGRESS);
  const [isAutoFixingLocalApi, setIsAutoFixingLocalApi] = useState(false);
  const localApiBootstrappedRef = useRef(false);
  const localApiOverlayHideTimerRef = useRef<number | null>(null);

  const bootstrapLocalApis = useCallback(async () => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime() || localApiBootstrappedRef.current) {
      return;
    }

    localApiBootstrappedRef.current = true;
    if (typeof window !== 'undefined') {
      window.__ALLMUSIC_LOCAL_API_READY__ = false;
    }
    setLocalApiProgress({
      visible: true,
      percent: 5,
      message: '正在检查并启动本地 API...',
      logs: [],
      failed: false,
      errorType: null,
      missingRequirements: [],
      serviceState: {
        netease: 'pending',
        qq: 'pending',
      },
    });

    try {
      const environmentCheck = await invoke<LocalApiEnvironmentCheckResult>('check_local_api_environment');
      if (!environmentCheck.ok) {
        const missingKeys = new Set(environmentCheck.missing.map((item) => item.key));
        const sharedFailure = missingKeys.has('project_root') || missingKeys.has('node_modules');
        const envLogs = environmentCheck.missing.map((item) => `${item.title}：${item.detail}`);
        setLocalApiProgress((prev) => ({
          ...prev,
          visible: true,
          failed: true,
          percent: 100,
          errorType: 'runtime',
          message: environmentCheck.summary,
          missingRequirements: environmentCheck.missing,
          serviceState: {
            netease: sharedFailure || missingKeys.has('node') ? 'error' : prev.serviceState.netease,
            qq: sharedFailure || missingKeys.has('python') ? 'error' : prev.serviceState.qq,
          },
          logs: [...prev.logs, ...envLogs].slice(-10),
        }));
        pushAlert({
          level: 'error',
          title: localApiErrorHeadline('runtime'),
          message: environmentCheck.summary,
          source: 'local-api.bootstrap',
          detail: environmentCheck.missing
            .map((item) => `${item.title}: ${item.detail}`)
            .join('\n'),
          dedupeKey: `local-api-env:${environmentCheck.summary}`,
        });
        if (typeof window !== 'undefined') {
          window.__ALLMUSIC_LOCAL_API_READY__ = false;
        }
        localApiBootstrappedRef.current = false;
        return;
      }

      setLocalApiProgress((prev) => ({
        ...prev,
        percent: Math.max(prev.percent, 12),
        message: '运行环境检查通过，正在启动本地 API...',
        logs: [
          ...prev.logs,
          `Node.js: ${environmentCheck.node.version || 'unknown'}`,
          `Python: ${environmentCheck.python.version || 'unknown'}`,
        ].slice(-10),
      }));

      const status = await invoke<string>('ensure_local_api_services');
      console.info(`[ALLMusic] ${status}`);
      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        percent: 100,
        failed: false,
        errorType: null,
        message: '本地 API 已就绪',
        missingRequirements: [],
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
      const rawMessage = error instanceof Error ? error.message : String(error);
      const parsedEnvironmentError = parseEnvironmentCheckFromErrorMessage(rawMessage);
      const errorType = parsedEnvironmentError ? 'runtime' : resolveLocalApiErrorType(rawMessage);
      const errorHeadline = localApiErrorHeadline(errorType);
      const displayMessage = parsedEnvironmentError?.summary || `${errorHeadline}：${rawMessage}`;
      const requirements = parsedEnvironmentError?.missing || [];
      console.error('[ALLMusic] 本地 API 启动失败:', rawMessage);
      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        failed: true,
        errorType,
        percent: Math.max(prev.percent, 100),
        message: displayMessage,
        missingRequirements: requirements,
        logs: parsedEnvironmentError
          ? [...prev.logs, ...requirements.map((item) => `${item.title}：${item.detail}`)].slice(-10)
          : [...prev.logs, rawMessage].slice(-10),
        serviceState: {
          netease: prev.serviceState.netease === 'ready' ? 'ready' : 'error',
          qq: prev.serviceState.qq === 'ready' ? 'ready' : 'error',
        },
      }));
      pushAlert({
        level: 'error',
        title: errorHeadline,
        message: displayMessage,
        source: 'local-api.bootstrap',
        detail: requirements.length > 0
          ? requirements.map((item) => `${item.title}: ${item.detail}`).join('\n')
          : rawMessage,
        dedupeKey: `local-api-catch:${errorType}:${rawMessage}`,
      });
      if (typeof window !== 'undefined') {
        window.__ALLMUSIC_LOCAL_API_READY__ = false;
      }
      localApiBootstrappedRef.current = false;
    }
  }, [notifyLocalApiReady, pushAlert]);

  const handleRetryBootstrap = useCallback(() => {
    localApiBootstrappedRef.current = false;
    void bootstrapLocalApis();
  }, [bootstrapLocalApis]);

  const handleAutoFixLocalApi = useCallback(async () => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime() || isAutoFixingLocalApi) {
      return;
    }

    const missingItems = localApiProgress.missingRequirements;
    if (missingItems.length === 0) {
      return;
    }

    // User already confirmed by clicking the auto-fix button in the overlay,
    // so we skip the old window.confirm dialog and proceed directly.

    setIsAutoFixingLocalApi(true);
    setLocalApiProgress((prev) => ({
      ...prev,
      visible: true,
      failed: false,
      percent: Math.max(10, Math.min(prev.percent, 20)),
      message: '正在自动修复本地依赖（国内镜像优先）...',
      logs: [...prev.logs, '已确认自动修复，开始执行...'].slice(-10),
    }));

    try {
      const result = await invoke<LocalApiAutoFixResult>('install_local_api_requirements');
      const nextCheck = result.check;
      if (!result.ok || !nextCheck.ok) {
        const requirements = nextCheck.missing || [];
        setLocalApiProgress((prev) => ({
          ...prev,
          visible: true,
          failed: true,
          errorType: 'runtime',
          percent: 100,
          message: nextCheck.summary || result.summary || '自动修复未完成，请按提示手动处理。',
          missingRequirements: requirements,
          serviceState: resolveServiceStateByMissingRequirements(requirements),
          logs: [
            ...prev.logs,
            result.summary || '自动修复未完成。',
          ].slice(-10),
        }));
        pushAlert({
          level: 'warning',
          title: '自动修复未完成',
          message: nextCheck.summary || result.summary || '仍有环境问题需要手动处理。',
          source: 'local-api.autofix',
          detail: requirements.map((item) => `${item.title}: ${item.detail}`).join('\n'),
          dedupeKey: `local-api-autofix-incomplete:${nextCheck.summary || result.summary}`,
        });
        localApiBootstrappedRef.current = false;
        return;
      }

      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        failed: false,
        errorType: null,
        percent: 100,
        message: '自动修复完成，正在重新启动本地 API...',
        missingRequirements: [],
        serviceState: {
          netease: 'pending',
          qq: 'pending',
        },
        logs: [...prev.logs, result.summary || '自动修复完成。'].slice(-10),
      }));
      localApiBootstrappedRef.current = false;
      await bootstrapLocalApis();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalApiProgress((prev) => ({
        ...prev,
        visible: true,
        failed: true,
        errorType: 'runtime',
        percent: 100,
        message: `自动修复失败：${message}`,
        logs: [...prev.logs, `自动修复失败：${message}`].slice(-10),
      }));
      pushAlert({
        level: 'error',
        title: '自动修复失败',
        message,
        source: 'local-api.autofix',
        dedupeKey: `local-api-autofix-error:${message}`,
      });
      localApiBootstrappedRef.current = false;
    } finally {
      setIsAutoFixingLocalApi(false);
    }
  }, [
    bootstrapLocalApis,
    isAutoFixingLocalApi,
    localApiProgress.missingRequirements,
    pushAlert,
  ]);

  return {
    localApiProgress,
    setLocalApiProgress,
    isAutoFixingLocalApi,
    bootstrapLocalApis,
    handleRetryBootstrap,
    handleAutoFixLocalApi,
    localApiOverlayHideTimerRef,
  };
}