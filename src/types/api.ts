import type { UnifiedSong, UnifiedPlaylist, UnifiedUser } from './index';

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
  cookie?: string;
}

/**
 * API adapter interface
 * All platform adapters must implement this interface
 */
export interface MusicApiAdapter {
  // Authentication
  login(email: string, password: string): Promise<ApiResponse<{ cookie: string; userId: string }>>;
  loginByQRCode(): Promise<ApiResponse<{ cookie: string; userId: string }>>;
  logout(): Promise<ApiResponse<void>>;
  verifyLogin(cookie: string): Promise<ApiResponse<boolean>>;

  // User
  getUserInfo(): Promise<ApiResponse<UnifiedUser>>;
  getUserPlaylists(userId: string): Promise<ApiResponse<UnifiedPlaylist[]>>;

  // Playlist
  getPlaylistDetail(playlistId: string): Promise<ApiResponse<UnifiedPlaylist>>;
  likeSong(songId: string, like: boolean): Promise<ApiResponse<void>>;

  // Song
  getSongUrl(songId: string, quality?: string): Promise<ApiResponse<string>>;
  searchSongs(keyword: string, limit?: number): Promise<ApiResponse<UnifiedSong[]>>;
  getDailyRecommend(): Promise<ApiResponse<UnifiedSong[]>>;
}

/**
 * Platform configuration
 */
export interface PlatformConfig {
  name: string;
  baseUrl: string;
  apiVersion?: string;
}
