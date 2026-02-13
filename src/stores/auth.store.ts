import { create } from 'zustand';
import type { UnifiedUser, MusicPlatform } from '@/types';
import { invoke } from '@tauri-apps/api/core';

const AUTH_FALLBACK_STORAGE_KEY = 'allmusic_auth_fallback_v1';

/**
 * Tauri-stored user credential structure
 */
interface StoredAuthUser {
  platform: string;
  user_id: string;
  nickname: string;
  avatar_url: string;
  is_logged_in: boolean;
}

interface StoredCredentials {
  user: StoredAuthUser;
  cookie: string;
}

/**
 * Auth store state
 */
interface AuthState {
  /** Logged in users */
  users: Record<MusicPlatform, UnifiedUser | null>;
  /** Cookies for each platform */
  cookies: Record<MusicPlatform, string | null>;
  /** Is any user logged in */
  isAuthenticated: boolean;
  /** Is loading from storage */
  isLoading: boolean;
}

/**
 * Auth store actions
 */
interface AuthActions {
  /** Load stored credentials on app start */
  loadStoredCredentials: () => Promise<void>;
  /** Set user login state */
  setUser: (platform: MusicPlatform, user: UnifiedUser, cookie: string) => Promise<void>;
  /** Remove user (logout) */
  removeUser: (platform: MusicPlatform) => Promise<void>;
  /** Update user cookie */
  updateCookie: (platform: MusicPlatform, cookie: string) => void;
  /** Clear all auth data */
  clearAll: () => Promise<void>;
  /** Check if platform is logged in */
  isPlatformLoggedIn: (platform: MusicPlatform) => boolean;
  /** Get all logged in platforms */
  getLoggedInPlatforms: () => MusicPlatform[];
}

function canUseTauriInvoke(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof tauriInternals?.invoke === 'function';
}

function isValidPlatform(platform: string): platform is MusicPlatform {
  return platform === 'netease' || platform === 'qq';
}

function readFallbackCredentials(): StoredCredentials[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(AUTH_FALLBACK_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredCredentials[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) =>
      Boolean(
        item
          && item.user
          && typeof item.cookie === 'string'
          && typeof item.user.platform === 'string'
          && isValidPlatform(item.user.platform)
      )
    );
  } catch {
    return [];
  }
}

function writeFallbackCredentials(credentials: StoredCredentials[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(AUTH_FALLBACK_STORAGE_KEY, JSON.stringify(credentials));
}

function toStoredAuthUser(platform: MusicPlatform, user: UnifiedUser): StoredAuthUser {
  return {
    platform,
    user_id: user.userId,
    nickname: user.nickname,
    avatar_url: user.avatarUrl,
    is_logged_in: true,
  };
}

/**
 * Convert stored user to unified user
 */
function toUnifiedUser(stored: StoredAuthUser): UnifiedUser {
  return {
    platform: stored.platform as MusicPlatform,
    userId: stored.user_id,
    nickname: stored.nickname,
    avatarUrl: stored.avatar_url,
    isLoggedIn: stored.is_logged_in,
  };
}

/**
 * Auth store
 */
export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  // State
  users: {
    netease: null,
    qq: null,
  },
  cookies: {
    netease: null,
    qq: null,
  },
  isAuthenticated: false,
  isLoading: true,

  // Actions
  loadStoredCredentials: async () => {
    try {
      const stored: StoredCredentials[] = canUseTauriInvoke()
        ? await invoke('get_all_auth')
        : readFallbackCredentials();

      const users: Record<MusicPlatform, UnifiedUser | null> = {
        netease: null,
        qq: null,
      };
      const cookies: Record<MusicPlatform, string | null> = {
        netease: null,
        qq: null,
      };

      for (const cred of stored) {
        const platform = cred.user.platform as MusicPlatform;
        if (platform === 'netease' || platform === 'qq') {
          users[platform] = toUnifiedUser(cred.user);
          cookies[platform] = cred.cookie;
        }
      }

      const isAuthenticated = Object.values(users).some((u) => u !== null);

      set({ users, cookies, isAuthenticated, isLoading: false });
    } catch (error) {
      console.error('Failed to load stored credentials:', error);
      set({ isLoading: false });
    }
  },

  setUser: async (platform, user, cookie) => {
    try {
      if (canUseTauriInvoke()) {
        await invoke('store_auth', {
          platform,
          userId: user.userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
          cookie,
        });
      } else {
        const current = readFallbackCredentials().filter((item) => item.user.platform !== platform);
        current.push({
          user: toStoredAuthUser(platform, user),
          cookie,
        });
        writeFallbackCredentials(current);
      }

      set((state) => ({
        users: { ...state.users, [platform]: user },
        cookies: { ...state.cookies, [platform]: cookie },
        isAuthenticated: true,
      }));
    } catch (error) {
      console.error('Failed to store auth:', error);
      throw error;
    }
  },

  removeUser: async (platform) => {
    try {
      if (canUseTauriInvoke()) {
        await invoke('remove_auth', { platform });
      } else {
        const current = readFallbackCredentials().filter((item) => item.user.platform !== platform);
        writeFallbackCredentials(current);
      }

      set((state) => {
        const newUsers = { ...state.users, [platform]: null };
        const newCookies = { ...state.cookies, [platform]: null };
        const hasLoggedIn = Object.values(newUsers).some((u) => u !== null);

        return {
          users: newUsers,
          cookies: newCookies,
          isAuthenticated: hasLoggedIn,
        };
      });
    } catch (error) {
      console.error('Failed to remove auth:', error);
      throw error;
    }
  },

  updateCookie: (platform, cookie) =>
    set((state) => ({
      cookies: { ...state.cookies, [platform]: cookie },
    })),

  clearAll: async () => {
    try {
      if (canUseTauriInvoke()) {
        await invoke('clear_all_auth');
      } else {
        writeFallbackCredentials([]);
      }

      set({
        users: { netease: null, qq: null },
        cookies: { netease: null, qq: null },
        isAuthenticated: false,
      });
    } catch (error) {
      console.error('Failed to clear auth:', error);
      throw error;
    }
  },

  isPlatformLoggedIn: (platform) => {
    const state = get();
    return state.users[platform] !== null;
  },

  getLoggedInPlatforms: () => {
    const state = get();
    return Object.entries(state.users)
      .filter(([_, user]) => user !== null)
      .map(([platform]) => platform as MusicPlatform);
  },
}));
