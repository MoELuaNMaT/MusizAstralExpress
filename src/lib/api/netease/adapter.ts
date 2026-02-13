/**
 * NetEase Cloud Music API Adapter (legacy placeholder)
 *
 * @deprecated
 * This adapter is not used by current runtime flow.
 * Active implementation lives in `src/services/auth.service.ts`
 * and `src/services/library.service.ts`.
 */

import { BaseApiAdapter } from '../base';
import type { ApiResponse, UnifiedPlaylist, UnifiedSong, UnifiedUser } from '@/types';

export class NeteaseAdapter extends BaseApiAdapter {
  constructor() {
    super('netease', 'http://localhost:3000'); // Default NeteaseCloudMusicApi port
  }

  async login(email: string, password: string): Promise<ApiResponse<{ cookie: string; userId: string }>> {
    // TODO: Implement login via /login/cellphone or /login
    return this.request<{ cookie: string; userId: string }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async loginByQRCode(): Promise<ApiResponse<{ cookie: string; userId: string }>> {
    // TODO: Implement QR code login via /login/qr/create and /login/qr/check
    return this.request<{ cookie: string; userId: string }>('/login/qr/key', {
      method: 'POST',
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    return this.request<void>('/logout', { method: 'POST' });
  }

  async verifyLogin(cookie: string): Promise<ApiResponse<boolean>> {
    this.setCookie(cookie);
    return this.request<boolean>('/login/status');
  }

  async getUserInfo(): Promise<ApiResponse<UnifiedUser>> {
    // TODO: Implement via /user/account
    return this.request<any>('/user/account');
  }

  async getUserPlaylists(userId: string): Promise<ApiResponse<UnifiedPlaylist[]>> {
    // TODO: Implement via /user/playlist
    const response = await this.request<any>(`/user/playlist?uid=${userId}`);
    if (response.success && response.data) {
      // Normalize playlists
      const playlists = response.data.map((p: any) => this.normalizePlaylist(p));
      return { success: true, data: playlists };
    }
    return response as ApiResponse<UnifiedPlaylist[]>;
  }

  async getPlaylistDetail(playlistId: string): Promise<ApiResponse<UnifiedPlaylist>> {
    // TODO: Implement via /playlist/detail
    return this.request<any>(`/playlist/detail?id=${playlistId}`);
  }

  async likeSong(songId: string, like: boolean): Promise<ApiResponse<void>> {
    // TODO: Implement via /like
    return this.request<void>(`/like?id=${songId}&like=${like}`, {
      method: 'POST',
    });
  }

  async getSongUrl(songId: string, quality = '320'): Promise<ApiResponse<string>> {
    // TODO: Implement via /song/url
    const response = await this.request<any>(`/song/url?id=${songId}&br=${quality}`);
    if (response.success && response.data?.[0]?.url) {
      return { success: true, data: response.data[0].url };
    }
    return { success: false, error: 'Failed to get song URL' };
  }

  async searchSongs(keyword: string, limit = 30): Promise<ApiResponse<UnifiedSong[]>> {
    // TODO: Implement via /search
    const response = await this.request<any>(`/search?keywords=${keyword}&limit=${limit}`);
    if (response.success && response.data) {
      const songs = response.data.songs.map((s: any) => this.normalizeSong(s));
      return { success: true, data: songs };
    }
    return { success: false, error: 'Search failed' };
  }

  async getDailyRecommend(): Promise<ApiResponse<UnifiedSong[]>> {
    // TODO: Implement via /recommend/songs
    const response = await this.request<any>('/recommend/songs');
    if (response.success && response.data) {
      const songs = response.data.map((s: any) => this.normalizeSong(s));
      return { success: true, data: songs };
    }
    return { success: false, error: 'Failed to get daily recommend' };
  }
}

// Singleton instance
export const neteaseAdapter = new NeteaseAdapter();
