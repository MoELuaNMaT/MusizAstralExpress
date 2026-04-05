import type { UnifiedPlaylist, UnifiedSong } from '@/types';

const PLAYLIST_DETAIL_CACHE_KEY = 'allmusic_playlist_detail_cache_v1';
const PLAYLIST_DETAIL_CACHE_LIMIT = 24;

type NeteaseLikedOrder = 'latest' | 'earliest' | 'api';

interface PlaylistDetailCacheKeyOptions {
  neteaseLikedOrder?: NeteaseLikedOrder;
}

export interface PlaylistDetailCacheData {
  songs: UnifiedSong[];
  warning?: string;
  info?: string;
  updatedAt: number;
}

type PlaylistDetailCacheStore = Record<string, PlaylistDetailCacheData>;

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function buildPlaylistDetailCacheKey(
  playlist: Pick<UnifiedPlaylist, 'id' | 'platform' | 'type'>,
  options: PlaylistDetailCacheKeyOptions = {},
): string {
  const neteaseLikedOrder = options.neteaseLikedOrder || 'latest';
  const modePart = playlist.platform === 'netease' && playlist.type === 'liked'
    ? `netease:${neteaseLikedOrder}`
    : playlist.platform === 'merged' && playlist.type === 'liked'
      ? 'merged'
      : 'default';
  return `${playlist.platform}:${playlist.id}:${modePart}`;
}

function readCacheStore(): PlaylistDetailCacheStore {
  if (!canUseLocalStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PLAYLIST_DETAIL_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed as PlaylistDetailCacheStore;
  } catch {
    return {};
  }
}

function writeCacheStore(store: PlaylistDetailCacheStore): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(PLAYLIST_DETAIL_CACHE_KEY, JSON.stringify(store));
  } catch {
    // Ignore local cache write errors to keep runtime flow stable.
  }
}

export function readPlaylistDetailCache(
  playlist: Pick<UnifiedPlaylist, 'id' | 'platform' | 'type'>,
  options: PlaylistDetailCacheKeyOptions = {},
): PlaylistDetailCacheData | null {
  const key = buildPlaylistDetailCacheKey(playlist, options);
  const store = readCacheStore();
  const cached = store[key];
  if (!cached || !Array.isArray(cached.songs)) {
    return null;
  }

  return {
    songs: cached.songs,
    warning: cached.warning,
    info: cached.info,
    updatedAt: Number(cached.updatedAt) || Date.now(),
  };
}

export function writePlaylistDetailCache(
  playlist: Pick<UnifiedPlaylist, 'id' | 'platform' | 'type'>,
  options: PlaylistDetailCacheKeyOptions = {},
  value: Omit<PlaylistDetailCacheData, 'updatedAt'>,
): void {
  const key = buildPlaylistDetailCacheKey(playlist, options);
  const store = readCacheStore();

  store[key] = {
    songs: value.songs,
    warning: value.warning,
    info: value.info,
    updatedAt: Date.now(),
  };

  const entries = Object.entries(store)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, PLAYLIST_DETAIL_CACHE_LIMIT);

  const nextStore: PlaylistDetailCacheStore = Object.fromEntries(entries);
  writeCacheStore(nextStore);
}
