import type { ThemeId } from '@/stores/theme.store';
import type { BridgeCacheResource } from '@/types/bridge.types';

// -- Custom event names --

export const LOCAL_API_READY_EVENT = 'allmusic:local-api-ready';
export const LOCAL_API_ENV_ERROR_PREFIX = 'LOCAL_API_ENVIRONMENT_MISSING::';
export const MEDIA_CONTROL_EVENT = 'allmusic:media-control';
export const BRIDGE_CACHE_UPDATED_EVENT = 'allmusic:bridge-cache-updated';
// -- Storage keys --

export const UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY = 'allmusic_ui_switch_playback_snapshot_v1';

// -- Bridge cache --

export const BRIDGE_CACHE_MAX_ENTRIES = 120;

export const BRIDGE_CACHE_POLICY: Record<BridgeCacheResource, { ttlMs: number; maxStaleMs: number }> = {
  playlists: { ttlMs: 60_000, maxStaleMs: 300_000 },
  'playlist-detail': { ttlMs: 30_000, maxStaleMs: 120_000 },
  'daily-recommend': { ttlMs: 120_000, maxStaleMs: 600_000 },
};

// -- Theme / UI version maps --

export const APP_THEME_CLASS_MAP: Record<ThemeId, string> = {
  night: 'am-theme-night',
  day: 'am-theme-day',
  clay: 'am-theme-clay',
  fallout: 'am-theme-fallout',
};
