import { canUseTauriInvoke, isMobile } from '@/lib/runtime';

export type ApiPlatform = 'netease' | 'qq';
export type RuntimeTarget = 'web' | 'tauri-desktop' | 'tauri-mobile';

export const API_BASE_OVERRIDE_STORAGE_KEY = 'allmusic_api_base_overrides_v1';

type ApiBaseOverrides = Partial<Record<ApiPlatform, string>>;

const DEFAULT_API_PORTS: Record<ApiPlatform, number> = {
  netease: 3000,
  qq: 3001,
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

function readApiBaseOverrides(): ApiBaseOverrides {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(API_BASE_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as ApiBaseOverrides;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

export function resolveRuntimeTarget(): RuntimeTarget {
  if (!canUseTauriInvoke()) {
    return 'web';
  }

  return isMobile() ? 'tauri-mobile' : 'tauri-desktop';
}

function resolveDefaultApiHost(runtimeTarget: RuntimeTarget): string {
  if (runtimeTarget === 'tauri-mobile') {
    // Android emulator uses 10.0.2.2 to reach host machine services.
    return 'http://10.0.2.2';
  }

  return 'http://localhost';
}

function resolveEnvBaseUrl(platform: ApiPlatform, runtimeTarget: RuntimeTarget): string | null {
  if (platform === 'netease') {
    if (runtimeTarget === 'tauri-mobile') {
      return normalizeBaseUrl(import.meta.env.VITE_MOBILE_NETEASE_API_BASE_URL)
        || normalizeBaseUrl(import.meta.env.VITE_NETEASE_API_BASE_URL);
    }

    return normalizeBaseUrl(import.meta.env.VITE_NETEASE_API_BASE_URL);
  }

  if (runtimeTarget === 'tauri-mobile') {
    return normalizeBaseUrl(import.meta.env.VITE_MOBILE_QQ_API_BASE_URL)
      || normalizeBaseUrl(import.meta.env.VITE_QQ_API_BASE_URL);
  }

  return normalizeBaseUrl(import.meta.env.VITE_QQ_API_BASE_URL);
}

export function resolveApiBaseUrlByPlatform(platform: ApiPlatform): string {
  const runtimeTarget = resolveRuntimeTarget();
  const envUrl = resolveEnvBaseUrl(platform, runtimeTarget);
  if (envUrl) {
    return envUrl;
  }

  const overrides = readApiBaseOverrides();
  const overrideUrl = normalizeBaseUrl(overrides[platform]);
  if (overrideUrl) {
    return overrideUrl;
  }

  const host = resolveDefaultApiHost(runtimeTarget);
  return `${host}:${DEFAULT_API_PORTS[platform]}`;
}

export function getNeteaseApiBaseUrl(): string {
  return resolveApiBaseUrlByPlatform('netease');
}

export function getQQApiBaseUrl(): string {
  return resolveApiBaseUrlByPlatform('qq');
}
