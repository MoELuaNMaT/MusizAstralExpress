/**
 * QQ Music API Adapter (legacy placeholder)
 *
 * @deprecated
 * This adapter is not used by current runtime flow.
 * Active implementation lives in `src/services/auth.service.ts`
 * and `src/services/library.service.ts`.
 */

import { BaseApiAdapter } from '../base';
import type { ApiResponse, UnifiedPlaylist, UnifiedSong, UnifiedUser } from '@/types';

export class QQMusicAdapter extends BaseApiAdapter {
  constructor() {
    super('qq', 'http://localhost:3001'); // Default QQ Music API port
  }

  async login(_email: string, _password: string): Promise<ApiResponse<{ cookie: string; userId: string }>> {
    // TODO: Implement QQ Music login
    // QQ Music login requires special handling for QQ union login
    return { success: false, error: 'Not implemented yet' };
  }

  async loginByQRCode(): Promise<ApiResponse<{ cookie: string; userId: string }>> {
    // TODO: Implement QR code login
    return { success: false, error: 'Not implemented yet' };
  }

  async logout(): Promise<ApiResponse<void>> {
    // TODO: Implement logout
    return { success: false, error: 'Not implemented yet' };
  }

  async verifyLogin(cookie: string): Promise<ApiResponse<boolean>> {
    this.setCookie(cookie);
    // TODO: Implement login verification
    return { success: false, error: 'Not implemented yet' };
  }

  async getUserInfo(): Promise<ApiResponse<UnifiedUser>> {
    // TODO: Implement via user info API
    return { success: false, error: 'Not implemented yet' };
  }

  async getUserPlaylists(_userId: string): Promise<ApiResponse<UnifiedPlaylist[]>> {
    // TODO: Implement via songlist API
    return { success: false, error: 'Not implemented yet' };
  }

  async getPlaylistDetail(_playlistId: string): Promise<ApiResponse<UnifiedPlaylist>> {
    // TODO: Implement via songlist detail API
    return { success: false, error: 'Not implemented yet' };
  }

  async likeSong(_songId: string, _like: boolean): Promise<ApiResponse<void>> {
    // TODO: Implement via like/dislike API
    return { success: false, error: 'Not implemented yet' };
  }

  async getSongUrl(_songId: string, _quality = '320'): Promise<ApiResponse<string>> {
    // TODO: Implement via song URL API
    // QQ Music requires guid parameter for song URL
    return { success: false, error: 'Not implemented yet' };
  }

  async searchSongs(_keyword: string, _limit = 30): Promise<ApiResponse<UnifiedSong[]>> {
    // TODO: Implement via search API
    return { success: false, error: 'Not implemented yet' };
  }

  async getDailyRecommend(): Promise<ApiResponse<UnifiedSong[]>> {
    // TODO: Implement via recommend API
    return { success: false, error: 'Not implemented yet' };
  }
}

// Singleton instance
export const qqMusicAdapter = new QQMusicAdapter();
