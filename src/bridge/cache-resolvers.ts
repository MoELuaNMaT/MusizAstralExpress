import { useAuthStore } from '@/stores';
import { libraryService } from '@/services/library.service';
import {
  buildAuthFingerprint,
  buildLibraryContext,
  buildPlaylistDetailCacheKey,
  buildPlaylistsCacheKey,
  fetchWithBridgeDedup,
  readBridgeCache,
  writeBridgeCache,
} from '@/bridge/cache';
import {
  readDailyRecommendCache,
  writeDailyRecommendCache,
  clearStaleDailyRecommendCache,
} from '@/lib/db/daily-recommend-cache';
import { normalizeUnknownErrorMessage } from '@/lib/local-api-errors';
import type {
  BridgeCacheUpdatePayload,
  BridgeDailyResult,
  BridgeLoadOptions,
  BridgePlaylistDetailResult,
  BridgePlaylistResult,
} from '@/types/bridge.types';
import type { UnifiedPlaylist } from '@/types';

import type { AlertInput } from '@/stores/alert.store';

type CacheUpdateEmitter = (payload: Omit<BridgeCacheUpdatePayload, 'type'>) => void;
type AlertPusher = (input: AlertInput) => unknown;

// ---------------------------------------------------------------------------
// Playlists resolver
// ---------------------------------------------------------------------------

export async function resolvePlaylistsWithBridgeCache(
  options: BridgeLoadOptions | undefined,
  emitCacheUpdate: CacheUpdateEmitter,
  pushAlert: AlertPusher,
): Promise<BridgePlaylistResult> {
  const silent = Boolean(options?.silent);
  const forceRefresh = Boolean(options?.forceRefresh);
  const authFingerprint = buildAuthFingerprint(useAuthStore.getState());
  const cacheKey = buildPlaylistsCacheKey(authFingerprint);
  const cached = readBridgeCache<BridgePlaylistResult>('playlists', cacheKey);

  const loadFromNetwork = async (notifyUpdate: boolean): Promise<BridgePlaylistResult> => {
    const result = await libraryService.loadUnifiedPlaylists(buildLibraryContext());
    const writeResult = writeBridgeCache('playlists', cacheKey, authFingerprint, result);
    if (notifyUpdate && writeResult.hasChanged) {
      emitCacheUpdate({
        resource: 'playlists',
        cacheKey,
        updatedAt: writeResult.entry.updatedAt,
        source: 'network',
      });
    }
    return result;
  };

  if (!forceRefresh && cached.fresh) {
    return cached.fresh;
  }

  if (!forceRefresh && cached.stale) {
    void fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(true)).catch((error) => {
      if (!silent) {
        console.warn('[ALLMusic][BridgeCache] playlists refresh failed:', error);
        pushAlert({
          level: 'warning',
          title: '歌单后台刷新失败',
          message: normalizeUnknownErrorMessage(error),
          source: 'bridge-cache.playlists',
          dedupeKey: `bridge-cache-playlists:${normalizeUnknownErrorMessage(error)}`,
        });
      }
    });
    return cached.stale;
  }

  return fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(false));
}

// ---------------------------------------------------------------------------
// Playlist detail resolver
// ---------------------------------------------------------------------------

export async function resolvePlaylistDetailWithBridgeCache(
  playlist: UnifiedPlaylist,
  options: BridgeLoadOptions | undefined,
  emitCacheUpdate: CacheUpdateEmitter,
  pushAlert: AlertPusher,
): Promise<BridgePlaylistDetailResult> {
  const silent = Boolean(options?.silent);
  const forceRefresh = Boolean(options?.forceRefresh);
  const authFingerprint = buildAuthFingerprint(useAuthStore.getState());
  const cacheKey = buildPlaylistDetailCacheKey(authFingerprint, playlist);
  const cached = readBridgeCache<BridgePlaylistDetailResult>('playlist-detail', cacheKey);

  const loadFromNetwork = async (notifyUpdate: boolean): Promise<BridgePlaylistDetailResult> => {
    const result = await libraryService.loadPlaylistDetail(playlist, buildLibraryContext());
    const writeResult = writeBridgeCache('playlist-detail', cacheKey, authFingerprint, result);
    if (notifyUpdate && writeResult.hasChanged) {
      emitCacheUpdate({
        resource: 'playlist-detail',
        cacheKey,
        updatedAt: writeResult.entry.updatedAt,
        source: 'network',
      });
    }
    return result;
  };

  if (!forceRefresh && cached.fresh) {
    return cached.fresh;
  }

  if (!forceRefresh && cached.stale) {
    void fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(true)).catch((error) => {
      if (!silent) {
        console.warn('[ALLMusic][BridgeCache] playlist detail refresh failed:', error);
        pushAlert({
          level: 'warning',
          title: '歌单详情后台刷新失败',
          message: normalizeUnknownErrorMessage(error),
          source: 'bridge-cache.playlist-detail',
          dedupeKey: `bridge-cache-playlist-detail:${normalizeUnknownErrorMessage(error)}`,
        });
      }
    });
    return cached.stale;
  }

  return fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(false));
}

// ---------------------------------------------------------------------------
// Daily recommendations resolver
// ---------------------------------------------------------------------------

export async function resolveDailyRecommendationsWithBridgeCache(
  options: (BridgeLoadOptions & { limit?: number }) | number | undefined,
  emitCacheUpdate: CacheUpdateEmitter,
  pushAlert: AlertPusher,
): Promise<BridgeDailyResult> {
  const normalizedOptions = typeof options === 'number' ? { limit: options } : options;
  const limit = normalizedOptions?.limit ?? 30;
  const silent = Boolean(normalizedOptions?.silent);
  const forceRefresh = Boolean(normalizedOptions?.forceRefresh);

  const authFingerprint = buildAuthFingerprint(useAuthStore.getState());
  const cacheKey = `daily-recommend:${authFingerprint}`;
  const cached = readBridgeCache<BridgeDailyResult>('daily-recommend', cacheKey);
  const context = buildLibraryContext();

  const loadFromNetwork = async (notifyUpdate: boolean): Promise<BridgeDailyResult> => {
    const result = await libraryService.loadDailyRecommendations(context, limit);

    // 空结果不缓存——通常表示瞬态失败（如 QQ 适配器未就绪），
    // 缓存后后续请求会直接返回空数据导致日推永久加载不出来。
    const hasSongs = result.songs.length > 0;
    if (hasSongs) {
      const writeResult = writeBridgeCache('daily-recommend', cacheKey, authFingerprint, result);
      writeDailyRecommendCache(context, { songs: result.songs, warnings: result.warnings });

      if (notifyUpdate && writeResult.hasChanged) {
        emitCacheUpdate({
          resource: 'daily-recommend',
          cacheKey,
          updatedAt: writeResult.entry.updatedAt,
          source: 'network',
        });
      }
    } else if (!silent) {
      console.warn(
        '[ALLMusic][BridgeCache] daily recommend returned 0 songs, skipping cache write.',
        'Warnings:', result.warnings,
      );
    }

    return result;
  };

  if (!forceRefresh && !cached.fresh && !cached.stale) {
    clearStaleDailyRecommendCache();
    const persistent = readDailyRecommendCache(context);
    if (persistent) {
      writeBridgeCache('daily-recommend', cacheKey, authFingerprint, { songs: persistent.songs, warnings: persistent.warnings });
      return { songs: persistent.songs, warnings: persistent.warnings };
    }
  }

  if (!forceRefresh && cached.fresh) {
    return cached.fresh;
  }

  if (!forceRefresh && cached.stale) {
    void fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(true)).catch((error) => {
      if (!silent) {
        console.warn('[ALLMusic][BridgeCache] daily recommend refresh failed:', error);
        pushAlert({
          level: 'warning',
          title: '每日推荐后台刷新失败',
          message: normalizeUnknownErrorMessage(error),
          source: 'bridge-cache.daily-recommend',
          dedupeKey: `bridge-cache-daily-recommend:${normalizeUnknownErrorMessage(error)}`,
        });
      }
    });
    return cached.stale;
  }

  return fetchWithBridgeDedup(cacheKey, () => loadFromNetwork(false));
}
