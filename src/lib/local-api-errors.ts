import { LOCAL_API_ENV_ERROR_PREFIX } from '@/constants/app.constants';
import type {
  LocalApiEnvironmentCheckResult,
  LocalApiErrorType,
  LocalApiMissingRequirement,
  LocalApiServiceState,
} from '@/types/bridge.types';

export function parseEnvironmentCheckFromErrorMessage(message: string): LocalApiEnvironmentCheckResult | null {
  if (!message.startsWith(LOCAL_API_ENV_ERROR_PREFIX)) {
    return null;
  }

  try {
    const payload = message.slice(LOCAL_API_ENV_ERROR_PREFIX.length);
    if (!payload) {
      return null;
    }
    return JSON.parse(payload) as LocalApiEnvironmentCheckResult;
  } catch {
    return null;
  }
}

export function resolveLocalApiErrorType(message: string): LocalApiErrorType {
  const hint = message.toLowerCase();
  if (message.startsWith(LOCAL_API_ENV_ERROR_PREFIX) || hint.includes('environment') || hint.includes('node') || hint.includes('python')) {
    return 'runtime';
  }
  if (hint.includes('node_modules') || hint.includes('dependencies')) {
    return 'dependency';
  }
  if (hint.includes('failed to become ready in time') || hint.includes('timeout')) {
    return 'timeout';
  }
  if (hint.includes('spawn') || hint.includes('start')) {
    return 'startup';
  }
  return 'unknown';
}

export function localApiErrorHeadline(type: LocalApiErrorType): string {
  if (type === 'runtime') {
    return '运行环境未就绪';
  }
  if (type === 'dependency') {
    return '本地依赖不完整';
  }
  if (type === 'timeout') {
    return '本地 API 启动超时';
  }
  if (type === 'startup') {
    return '本地 API 启动失败';
  }
  return '本地 API 异常';
}

export function resolveServiceStateByMissingRequirements(
  missing: LocalApiMissingRequirement[],
): Record<'netease' | 'qq', LocalApiServiceState> {
  const missingKeys = new Set(missing.map((item) => item.key));
  const sharedFailure = missingKeys.has('project_root') || missingKeys.has('node_modules');
  return {
    netease: sharedFailure || missingKeys.has('node') ? 'error' : 'ready',
    qq: sharedFailure || missingKeys.has('python') ? 'error' : 'ready',
  };
}

export function normalizeUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || '未知错误';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? '未知错误');
  }
}

export function isTransientPlayerStartupError(message: string): boolean {
  return /本地播放服务未启动或端口不可达|failed to fetch|fetch failed|err_connection_refused|network error/i.test(
    message,
  );
}
