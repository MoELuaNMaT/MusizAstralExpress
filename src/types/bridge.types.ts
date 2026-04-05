/**
 * Bridge / LocalApi type definitions extracted from App.tsx.
 *
 * These types describe the contract between the React "current" UI and
 * legacy iframe-based UI versions that communicate via window.__ALLMUSIC_BRIDGE__.
 */

import type { useAuthStore, usePlayerStore } from '@/stores';
import type { libraryService } from '@/services/library.service';
import type { LoginResult, PreferredQuality, UnifiedPlaylist, UnifiedSong } from '@/types';
import type { UiVersion } from '@/stores/theme.store';

// ---------------------------------------------------------------------------
// Store snapshots
// ---------------------------------------------------------------------------

export type AuthSnapshot = ReturnType<typeof useAuthStore.getState>;
export type PlayerSnapshot = ReturnType<typeof usePlayerStore.getState>;

// ---------------------------------------------------------------------------
// Bridge auth / library result types
// ---------------------------------------------------------------------------

export type BridgeAuthState = {
  users: AuthSnapshot['users'];
  cookies: AuthSnapshot['cookies'];
  isAuthenticated: boolean;
  hasConnectedAllPlatforms: boolean;
};

export type BridgePlaylistResult = Awaited<ReturnType<typeof libraryService.loadUnifiedPlaylists>>;
export type BridgePlaylistDetailResult = Awaited<ReturnType<typeof libraryService.loadPlaylistDetail>>;
export type BridgeSearchResult = Awaited<ReturnType<typeof libraryService.searchUnifiedSongs>>;
export type BridgeDailyResult = Awaited<ReturnType<typeof libraryService.loadDailyRecommendations>>;
export type BridgeLyricResult = Awaited<ReturnType<typeof libraryService.loadSongLyrics>>;
export type BridgeLikeResult = Awaited<ReturnType<typeof libraryService.likeSong>>;

// ---------------------------------------------------------------------------
// Bridge player state
// ---------------------------------------------------------------------------

export type BridgePlayerState = Pick<
  PlayerSnapshot,
  | 'currentSong'
  | 'queue'
  | 'currentIndex'
  | 'isPlaying'
  | 'playMode'
  | 'volume'
  | 'currentTime'
  | 'duration'
  | 'isLoading'
  | 'error'
  | 'preferredQuality'
>;

// ---------------------------------------------------------------------------
// UI switch playback snapshot (persisted to localStorage)
// ---------------------------------------------------------------------------

export type UiSwitchPlaybackSnapshot = {
  songId: string | null;
  currentTime: number;
  isPlaying: boolean;
  capturedAt: number;
};

// ---------------------------------------------------------------------------
// Local API lifecycle types
// ---------------------------------------------------------------------------

export type LocalApiServiceState = 'pending' | 'starting' | 'installing' | 'ready' | 'error';

export type LocalApiProgressPayload = {
  stage: string;
  service?: 'netease' | 'qq';
  message: string;
  percent: number;
  level?: 'info' | 'warn' | 'error';
  timestamp?: number;
};

export type LocalApiMissingRequirement = {
  key: string;
  title: string;
  detail: string;
  install_url?: string | null;
};

export type LocalApiRuntimeStatus = {
  name: string;
  command: string;
  available: boolean;
  version?: string | null;
  hint?: string | null;
  install_url: string;
};

export type LocalApiEnvironmentCheckResult = {
  ok: boolean;
  summary: string;
  project_root?: string | null;
  node_modules_ready: boolean;
  node: LocalApiRuntimeStatus;
  python: LocalApiRuntimeStatus;
  missing: LocalApiMissingRequirement[];
};

export type LocalApiAutoFixResult = {
  ok: boolean;
  summary: string;
  attempted: string[];
  check: LocalApiEnvironmentCheckResult;
};

export type LocalApiErrorType = 'runtime' | 'dependency' | 'timeout' | 'startup' | 'unknown';

// ---------------------------------------------------------------------------
// Media control
// ---------------------------------------------------------------------------

export type MediaControlEventPayload = {
  action?: 'toggle' | 'next' | 'previous';
  source?: 'global-shortcut' | 'tray';
  timestamp?: number;
};

// ---------------------------------------------------------------------------
// Bridge cache types
// ---------------------------------------------------------------------------

export type BridgeCacheResource = 'playlists' | 'playlist-detail' | 'daily-recommend';

export type BridgeLoadOptions = {
  forceRefresh?: boolean;
  silent?: boolean;
};

export type BridgeCacheUpdatePayload = {
  /** String literal instead of referencing the runtime constant */
  type: 'allmusic:bridge-cache-updated';
  resource: BridgeCacheResource;
  cacheKey: string;
  updatedAt: number;
  source: 'network';
};

export type BridgeCacheEntry<T> = {
  value: T;
  resource: BridgeCacheResource;
  authFingerprint: string;
  signature: string;
  updatedAt: number;
};

export type BridgeCacheWriteResult<T> = {
  entry: BridgeCacheEntry<T>;
  hasChanged: boolean;
};

// ---------------------------------------------------------------------------
// Bridge API surface exposed to iframe UIs
// ---------------------------------------------------------------------------

export type BridgeApi = {
  getAuthState: () => Promise<BridgeAuthState>;
  neteaseQRCodeLogin: (
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal,
  ) => Promise<LoginResult>;
  qqQRCodeLogin: (
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal,
  ) => Promise<LoginResult>;
  neteaseCellphoneLogin: (phone: string, password: string, countryCode?: string) => Promise<LoginResult>;
  qqCookieLogin: (cookie: string, nickname?: string) => Promise<LoginResult>;
  verifyLogin: (platform: 'netease' | 'qq', cookie: string) => Promise<boolean>;
  logoutPlatform: (platform: 'netease' | 'qq') => Promise<void>;
  loadPlaylists: (options?: BridgeLoadOptions) => Promise<BridgePlaylistResult>;
  loadPlaylistDetail: (playlist: UnifiedPlaylist, options?: BridgeLoadOptions) => Promise<BridgePlaylistDetailResult>;
  searchSongs: (keyword: string, limit?: number) => Promise<BridgeSearchResult>;
  loadDailyRecommendations: (options?: BridgeLoadOptions & { limit?: number } | number) => Promise<BridgeDailyResult>;
  loadSongLyrics: (song: UnifiedSong) => Promise<BridgeLyricResult>;
  likeSong: (song: UnifiedSong, like?: boolean) => Promise<BridgeLikeResult>;
  playSongs: (songs: UnifiedSong[], startIndex?: number) => Promise<void>;
  playAt: (index: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  setVolume: (volumePercent: number) => Promise<void>;
  setQuality: (quality: PreferredQuality) => Promise<PreferredQuality>;
  seekTo: (ms: number) => Promise<void>;
  retryCurrent: () => Promise<void>;
  getPlayerState: () => Promise<BridgePlayerState>;
  switchUiVersion: (next: UiVersion) => Promise<void>;
  getUiVersion: () => Promise<UiVersion>;
  openUiSwitcher: () => Promise<void>;
};
