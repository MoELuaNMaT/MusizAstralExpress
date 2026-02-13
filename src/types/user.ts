import type { MusicPlatform } from './song';

/**
 * Unified user model
 */
export interface UnifiedUser {
  /** Source platform */
  platform: MusicPlatform;
  /** User ID on the platform */
  userId: string;
  /** User nickname */
  nickname: string;
  /** Avatar URL */
  avatarUrl: string;
  /** Login status */
  isLoggedIn: boolean;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  platform: MusicPlatform;
  method: LoginMethod;
  email?: string;
  phone?: string;
  password?: string;
}

/**
 * Login methods
 */
export type LoginMethod = 'email' | 'phone' | 'qrcode' | 'cookie';

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  user?: UnifiedUser;
  cookie?: string;
  error?: string;
}
