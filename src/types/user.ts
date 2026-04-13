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
}

/**
 * Login methods
 */
export type LoginMethod = 'qrcode';

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  user?: UnifiedUser;
  cookie?: string;
  error?: string;
}

/**
 * Login session health check result
 */
export interface AuthSessionHealthResult {
  /** Current session state after verification / recovery attempt */
  status: 'valid' | 'recovered' | 'invalid';
  /** Latest usable cookie when available */
  cookie?: string;
  /** Latest resolved user info when available */
  user?: UnifiedUser;
}
