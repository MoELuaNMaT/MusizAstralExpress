import type { UnifiedSong } from './song';

/**
 * Unified playlist model across platforms
 */
export interface UnifiedPlaylist {
  /** Unique ID: `${platform}_${originalId}` or `merged_liked` */
  id: string;
  /** Source platform or 'merged' for combined playlists */
  platform: MusicPlatform | 'merged';
  /** Original platform playlist ID */
  originalId: string;
  /** Playlist type */
  type: PlaylistType;
  /** Playlist name */
  name: string;
  /** Cover image URL */
  coverUrl: string;
  /** Total song count */
  songCount: number;
  /** Creator/owner name */
  creator: string;
  /** Description */
  description?: string;
  /** Songs (lazy loaded) */
  songs?: UnifiedSong[];
}

/**
 * Music platforms
 */
export type MusicPlatform = 'netease' | 'qq';

/**
 * Playlist types
 */
export type PlaylistType = 'liked' | 'created' | 'collected';

/**
 * Platform-specific playlist data (raw from API)
 */
export interface PlatformPlaylist {
  id: string;
  dirid?: string; // QQ Music uses 'dirid'
  name?: string;
  title?: string; // QQ Music uses 'title'
  coverImgUrl?: string;
  picurl?: string; // QQ Music uses 'picurl'
  trackCount?: number;
  songnum?: number; // QQ Music uses 'songnum'
  creator?: {
    nickname?: string;
    remark?: string;
  };
  description?: string;
  createTime?: number;
  createtime?: number; // QQ Music uses 'createtime'
}

/**
 * Playlist detail request
 */
export interface PlaylistDetailRequest {
  playlistId: string;
  platform: MusicPlatform;
}

/**
 * Like/Unlike song request
 */
export interface LikeSongRequest {
  songId: string;
  platform: MusicPlatform;
  like: boolean;
}
