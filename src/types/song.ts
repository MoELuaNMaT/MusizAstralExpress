/**
 * Unified song model across platforms
 */
export interface UnifiedSong {
  /** Unique ID: `${platform}_${originalId}` */
  id: string;
  /** Source platform */
  platform: MusicPlatform;
  /** Original platform song ID */
  originalId: string;
  /** QQ numeric song id (if available) */
  qqSongId?: string;
  /** QQ song mid (if available) */
  qqSongMid?: string;
  /** Song name */
  name: string;
  /** Artist name(s), separated by / if multiple */
  artist: string;
  /** Album name */
  album: string;
  /** Duration in milliseconds */
  duration: number;
  /** Cover image URL */
  coverUrl: string;
  /** Playable audio URL (lazy loaded) */
  playUrl?: string;
  /** Audio quality */
  quality?: AudioQuality;
  /** Whether user liked this song */
  isLiked?: boolean;
}

/**
 * Music platforms
 */
export type MusicPlatform = 'netease' | 'qq';

/**
 * Audio quality options
 */
export type AudioQuality = '128' | '320' | 'flac' | 'hires';

/**
 * Platform-specific song data (raw from API)
 */
export interface PlatformSong {
  id: string;
  name?: string;
  songname?: string; // QQ Music uses 'songname'
  ar?: Array<{ name: string }>;
  singer?: Array<{ name: string }>; // QQ Music uses 'singer'
  al?: { name: string };
  album?: { name: string }; // QQ Music uses 'album'
  dt?: number;
  interval?: number; // QQ Music uses 'interval' in seconds
  picUrl?: string;
  picurl?: string; // QQ Music uses 'picurl'
}

/**
 * Song search request
 */
export interface SongSearchRequest {
  keyword: string;
  limit?: number;
  offset?: number;
  quality?: AudioQuality;
}

/**
 * Song search response
 */
export interface SongSearchResponse {
  songs: UnifiedSong[];
  total: number;
  hasMore: boolean;
}
