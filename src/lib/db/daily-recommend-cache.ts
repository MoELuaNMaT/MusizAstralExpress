import type { UnifiedSong } from '@/types';

const DAILY_RECOMMEND_CACHE_KEY = 'allmusic_daily_recommend_cache_v1';
const DAILY_RECOMMEND_CACHE_LIMIT = 12;

export interface DailyRecommendCacheScope {
  neteaseUserId?: string | null;
  neteaseCookie?: string | null;
  qqUserId?: string | null;
  qqCookie?: string | null;
}

export interface DailyRecommendCacheData {
  songs: UnifiedSong[];
  warnings: string[];
  cacheDate: string;
  updatedAt: number;
}

type DailyRecommendCacheStore = Record<string, DailyRecommendCacheData>;

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function stableHashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeScopePart(raw: string | null | undefined): string {
  return (raw || '').trim();
}

function hasScope(scope: DailyRecommendCacheScope): boolean {
  return Boolean(
    normalizeScopePart(scope.neteaseUserId)
    || normalizeScopePart(scope.qqUserId)
    || normalizeScopePart(scope.neteaseCookie)
    || normalizeScopePart(scope.qqCookie),
  );
}

function buildScopeFingerprint(scope: DailyRecommendCacheScope): string {
  const neteaseUserId = normalizeScopePart(scope.neteaseUserId);
  const qqUserId = normalizeScopePart(scope.qqUserId);
  const neteaseCookieHash = stableHashString(normalizeScopePart(scope.neteaseCookie));
  const qqCookieHash = stableHashString(normalizeScopePart(scope.qqCookie));
  return `${neteaseUserId}|${qqUserId}|${neteaseCookieHash}|${qqCookieHash}`;
}

function buildCacheKey(scope: DailyRecommendCacheScope, dateKey: string): string {
  return `${buildScopeFingerprint(scope)}:${dateKey}`;
}

function readCacheStore(): DailyRecommendCacheStore {
  if (!canUseLocalStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(DAILY_RECOMMEND_CACHE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as DailyRecommendCacheStore;
  } catch {
    return {};
  }
}

function writeCacheStore(store: DailyRecommendCacheStore): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(DAILY_RECOMMEND_CACHE_KEY, JSON.stringify(store));
  } catch {
    // Ignore local cache write failures to keep runtime flow stable.
  }
}

function normalizeCacheItem(raw: DailyRecommendCacheData | undefined): DailyRecommendCacheData | null {
  if (!raw || !Array.isArray(raw.songs)) {
    return null;
  }

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((item): item is string => typeof item === 'string')
    : [];
  const cacheDate = typeof raw.cacheDate === 'string' ? raw.cacheDate : '';

  return {
    songs: raw.songs,
    warnings,
    cacheDate,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function clearStaleDailyRecommendCache(dateKey = getLocalDateKey()): void {
  const store = readCacheStore();
  const nextEntries = Object.entries(store)
    .map(([key, value]) => [key, normalizeCacheItem(value)] as const)
    .filter(([, value]) => Boolean(value && value.cacheDate === dateKey))
    .sort((a, b) => ((b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)))
    .slice(0, DAILY_RECOMMEND_CACHE_LIMIT)
    .map(([key, value]) => [key, value!] as const);

  const nextStore: DailyRecommendCacheStore = Object.fromEntries(nextEntries);
  if (Object.keys(nextStore).length === Object.keys(store).length) {
    return;
  }
  writeCacheStore(nextStore);
}

export function readDailyRecommendCache(
  scope: DailyRecommendCacheScope,
  dateKey = getLocalDateKey(),
): DailyRecommendCacheData | null {
  if (!hasScope(scope)) {
    return null;
  }

  const cacheKey = buildCacheKey(scope, dateKey);
  const store = readCacheStore();
  const cached = normalizeCacheItem(store[cacheKey]);
  if (!cached) {
    return null;
  }

  if (cached.cacheDate !== dateKey) {
    delete store[cacheKey];
    writeCacheStore(store);
    return null;
  }

  return cached;
}

export function writeDailyRecommendCache(
  scope: DailyRecommendCacheScope,
  value: {
    songs: UnifiedSong[];
    warnings: string[];
  },
  dateKey = getLocalDateKey(),
): void {
  if (!hasScope(scope)) {
    return;
  }

  const cacheKey = buildCacheKey(scope, dateKey);
  const store = readCacheStore();
  store[cacheKey] = {
    songs: value.songs,
    warnings: value.warnings.filter((item): item is string => typeof item === 'string'),
    cacheDate: dateKey,
    updatedAt: Date.now(),
  };

  const nextEntries = Object.entries(store)
    .map(([key, item]) => [key, normalizeCacheItem(item)] as const)
    .filter(([, item]) => Boolean(item && item.cacheDate === dateKey))
    .sort((a, b) => ((b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)))
    .slice(0, DAILY_RECOMMEND_CACHE_LIMIT)
    .map(([key, item]) => [key, item!] as const);

  const nextStore: DailyRecommendCacheStore = Object.fromEntries(nextEntries);
  writeCacheStore(nextStore);
}

export function clearAllDailyRecommendCache(): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(DAILY_RECOMMEND_CACHE_KEY);
  } catch {
    // Ignore local cache remove failures to keep runtime flow stable.
  }
}
