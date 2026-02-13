import { canUseTauriInvoke, isMobileUserAgent } from '@/lib/runtime';

const API_BASE_OVERRIDE_STORAGE_KEY = 'allmusic_api_base_overrides_v1';

type ApiBaseOverrides = Partial<Record<'netease' | 'qq', string>>;

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

function getDefaultHost(): string {
  if (canUseTauriInvoke() && isMobileUserAgent()) {
    // Android emulator should use 10.0.2.2 to access host machine services.
    return 'http://10.0.2.2';
  }
  return 'http://localhost';
}

function resolveApiBaseUrl(
  envValue: string | undefined,
  overrideValue: string | undefined,
  port: number,
): string {
  const byEnv = normalizeBaseUrl(envValue);
  if (byEnv) {
    return byEnv;
  }

  const byOverride = normalizeBaseUrl(overrideValue);
  if (byOverride) {
    return byOverride;
  }

  return `${getDefaultHost()}:${port}`;
}

export function getNeteaseApiBaseUrl(): string {
  const overrides = readApiBaseOverrides();
  return resolveApiBaseUrl(import.meta.env.VITE_NETEASE_API_BASE_URL, overrides.netease, 3000);
}

export function getQQApiBaseUrl(): string {
  const overrides = readApiBaseOverrides();
  return resolveApiBaseUrl(import.meta.env.VITE_QQ_API_BASE_URL, overrides.qq, 3001);
}
