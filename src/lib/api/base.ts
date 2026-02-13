import type {
  ApiResponse,
  MusicApiAdapter,
  PlatformSong,
  PlatformPlaylist,
  UnifiedSong,
  UnifiedPlaylist,
  UnifiedUser,
  MusicPlatform,
} from '@/types';
import { generateSongId } from '@/lib/utils';

/**
 * Base API adapter with common functionality
 */
export abstract class BaseApiAdapter implements MusicApiAdapter {
  protected platform: MusicPlatform;
  protected baseUrl: string;
  protected cookie: string | null = null;

  constructor(platform: MusicPlatform, baseUrl: string) {
    this.platform = platform;
    this.baseUrl = baseUrl;
  }

  /**
   * Set authentication cookie
   */
  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  /**
   * Get authentication cookie
   */
  getCookie(): string | null {
    return this.cookie;
  }

  /**
   * Make API request
   */
  protected async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookie && { Cookie: this.cookie }),
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.message || 'Request failed',
          code: response.status,
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Normalize platform song to unified song
   */
  protected normalizeSong(song: PlatformSong): UnifiedSong {
    // Extract common fields with platform-specific mapping
    const name = song.name || song.songname || '';
    const artistData = song.ar || song.singer || [];
    const artist = artistData.map((a: { name: string }) => a.name).join('/') || '';
    const albumData = song.al || song.album;
    const album = albumData?.name || '';
    const cover = song.picUrl || song.picurl || '';
    const duration = song.dt || (song.interval ? song.interval * 1000 : 0);

    return {
      id: generateSongId(this.platform, song.id),
      platform: this.platform,
      originalId: song.id,
      name,
      artist,
      album,
      duration,
      coverUrl: cover,
    };
  }

  /**
   * Normalize platform playlist to unified playlist
   */
  protected normalizePlaylist(playlist: PlatformPlaylist): UnifiedPlaylist {
    const id = playlist.id || playlist.dirid || '';
    const name = playlist.name || playlist.title || '';
    const cover = playlist.coverImgUrl || playlist.picurl || '';
    const songCount = playlist.trackCount || playlist.songnum || 0;
    const creator = playlist.creator?.nickname || playlist.creator?.remark || '';

    return {
      id: generateSongId(this.platform, id),
      platform: this.platform,
      originalId: id,
      type: 'created',
      name,
      coverUrl: cover,
      songCount,
      creator,
      description: playlist.description,
    };
  }

  // Abstract methods - must be implemented by platform-specific adapters
  abstract login(email: string, password: string): Promise<ApiResponse<{ cookie: string; userId: string }>>;
  abstract loginByQRCode(): Promise<ApiResponse<{ cookie: string; userId: string }>>;
  abstract logout(): Promise<ApiResponse<void>>;
  abstract verifyLogin(cookie: string): Promise<ApiResponse<boolean>>;
  abstract getUserInfo(): Promise<ApiResponse<UnifiedUser>>;
  abstract getUserPlaylists(userId: string): Promise<ApiResponse<UnifiedPlaylist[]>>;
  abstract getPlaylistDetail(playlistId: string): Promise<ApiResponse<UnifiedPlaylist>>;
  abstract likeSong(songId: string, like: boolean): Promise<ApiResponse<void>>;
  abstract getSongUrl(songId: string, quality?: string): Promise<ApiResponse<string>>;
  abstract searchSongs(keyword: string, limit?: number): Promise<ApiResponse<UnifiedSong[]>>;
  abstract getDailyRecommend(): Promise<ApiResponse<UnifiedSong[]>>;
}
