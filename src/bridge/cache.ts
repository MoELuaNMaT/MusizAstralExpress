import { useAuthStore } from '@/stores';
import { BRIDGE_CACHE_MAX_ENTRIES, BRIDGE_CACHE_POLICY } from '@/constants/app.constants';
import type { AuthSnapshot, BridgeCacheEntry, BridgeCacheResource, BridgeCacheWriteResult } from '@/types/bridge.types';
import type { UnifiedPlaylist } from '@/types';

// ---------------------------------------------------------------------------
// Module-level stores
// ---------------------------------------------------------------------------

export const bridgeCacheStore = new Map<string, BridgeCacheEntry<unknown>>();
export const bridgeInFlightStore = new Map<string, Promise<unknown>>();

// ---------------------------------------------------------------------------
// Library context helper
// ---------------------------------------------------------------------------

export function buildLibraryContext() {
  const auth = useAuthStore.getState();
  return {
    neteaseUserId: auth.users.netease?.userId,
    neteaseCookie: auth.cookies.netease,
    qqUserId: auth.users.qq?.userId,
    qqCookie: auth.cookies.qq,
  };
}

// ---------------------------------------------------------------------------
// Hashing / normalisation utilities
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash, returned as base-36 string. */
export function stableHashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Recursively normalise a value for stable JSON serialisation:
 * - Arrays are mapped element-wise
 * - Dates become ISO strings
 * - Plain objects get their keys sorted
 */
export function normalizeBridgeCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeBridgeCacheValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && Object.prototype.toString.call(value) === '[object Object]') {
    const normalized: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      normalized[key] = normalizeBridgeCacheValue(source[key]);
    }
    return normalized;
  }
  return value;
}

export function buildBridgeCacheSignature(value: unknown): string {
  try {
    const normalized = normalizeBridgeCacheValue(value);
    return stableHashString(JSON.stringify(normalized) ?? '');
  } catch {
    return stableHashString(String(value ?? ''));
  }
}

// ---------------------------------------------------------------------------
// Cache key builders
// ---------------------------------------------------------------------------

export function buildAuthFingerprint(auth: AuthSnapshot): string {
  const neteaseUserId = auth.users.netease?.userId || '';
  const qqUserId = auth.users.qq?.userId || '';
  const neteaseCookieHash = stableHashString(auth.cookies.netease || '');
  const qqCookieHash = stableHashString(auth.cookies.qq || '');
  return `${neteaseUserId}|${qqUserId}|${neteaseCookieHash}|${qqCookieHash}`;
}

export function buildPlaylistsCacheKey(authFingerprint: string): string {
  return `playlists:${authFingerprint}`;
}

export function buildPlaylistDetailCacheKey(authFingerprint: string, playlist: UnifiedPlaylist): string {
  return `playlist-detail:${authFingerprint}:${playlist.platform}:${playlist.id}:${playlist.originalId}`;
}

// ---------------------------------------------------------------------------
// Cache store operations
// ---------------------------------------------------------------------------

/** Evict oldest entries when the store exceeds `maxEntries`. */
export function pruneBridgeCacheStore(maxEntries = BRIDGE_CACHE_MAX_ENTRIES): void {
  if (bridgeCacheStore.size <= maxEntries) {
    return;
  }

  const sortedKeys = Array.from(bridgeCacheStore.entries())
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    .map(([cacheKey]) => cacheKey);

  const overflowCount = bridgeCacheStore.size - maxEntries;
  for (let index = 0; index < overflowCount; index += 1) {
    const key = sortedKeys[index];
    if (key) {
      bridgeCacheStore.delete(key);
    }
  }
}

export function readBridgeCache<T>(resource: BridgeCacheResource, cacheKey: string): {
  fresh: T | null;
  stale: T | null;
} {
  const cached = bridgeCacheStore.get(cacheKey) as BridgeCacheEntry<T> | undefined;
  if (!cached || cached.resource !== resource) {
    return { fresh: null, stale: null };
  }

  const policy = BRIDGE_CACHE_POLICY[resource];
  const age = Date.now() - cached.updatedAt;
  if (age <= policy.ttlMs) {
    return { fresh: cached.value, stale: cached.value };
  }
  if (age <= policy.maxStaleMs) {
    return { fresh: null, stale: cached.value };
  }
  return { fresh: null, stale: null };
}

export function writeBridgeCache<T>(
  resource: BridgeCacheResource,
  cacheKey: string,
  authFingerprint: string,
  value: T,
): BridgeCacheWriteResult<T> {
  const previous = bridgeCacheStore.get(cacheKey) as BridgeCacheEntry<T> | undefined;
  const signature = buildBridgeCacheSignature(value);
  const entry: BridgeCacheEntry<T> = {
    value,
    resource,
    authFingerprint,
    signature,
    updatedAt: Date.now(),
  };
  bridgeCacheStore.set(cacheKey, entry as BridgeCacheEntry<unknown>);
  pruneBridgeCacheStore();
  const hasChanged = !previous
    || previous.resource !== resource
    || previous.authFingerprint !== authFingerprint
    || previous.signature !== signature;
  return { entry, hasChanged };
}

// ---------------------------------------------------------------------------
// In-flight deduplication
// ---------------------------------------------------------------------------

export async function fetchWithBridgeDedup<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = bridgeInFlightStore.get(cacheKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const request = fetcher().finally(() => {
    bridgeInFlightStore.delete(cacheKey);
  });
  bridgeInFlightStore.set(cacheKey, request as Promise<unknown>);
  return request;
}

