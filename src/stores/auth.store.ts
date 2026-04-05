import { create } from 'zustand';
import type { UnifiedUser, MusicPlatform } from '@/types';
import { invoke } from '@tauri-apps/api/core';
import { canUseTauriInvoke } from '@/lib/runtime';

const AUTH_FALLBACK_STORAGE_KEY = 'allmusic_auth_fallback_v1';

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

interface AuthState {
  users: Record<MusicPlatform, UnifiedUser | null>;
  cookies: Record<MusicPlatform, string | null>;
  isLoading: boolean;
}

interface AuthActions {
  loadStoredCredentials: () => Promise<void>;
  setUser: (platform: MusicPlatform, user: UnifiedUser, cookie: string) => Promise<void>;
  removeUser: (platform: MusicPlatform) => Promise<void>;
  updateCookie: (platform: MusicPlatform, cookie: string) => void;
  clearAll: () => Promise<void>;
  isPlatformLoggedIn: (platform: MusicPlatform) => boolean;
  getLoggedInPlatforms: () => MusicPlatform[];
}

function isValidPlatform(platform: string): platform is MusicPlatform {
  return platform === 'netease' || platform === 'qq';
}

const OBFUSCATION_KEY = 'ALLMusic_v1';

function xorObfuscate(input: string, key: string): string {
  const chars: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    chars.push(String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length)));
  }
  return chars.join('');
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

    let json: string;
    try {
      json = xorObfuscate(atob(raw), OBFUSCATION_KEY);
    } catch {
      // Fallback: try reading as plain JSON for migration from old format
      json = raw;
    }

    const parsed = JSON.parse(json) as StoredCredentials[];
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

  const json = JSON.stringify(credentials);
  localStorage.setItem(AUTH_FALLBACK_STORAGE_KEY, btoa(xorObfuscate(json, OBFUSCATION_KEY)));
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

function upsertFallbackCredential(platform: MusicPlatform, user: UnifiedUser, cookie: string): void {
  const current = readFallbackCredentials().filter((item) => item.user.platform !== platform);
  current.push({
    user: toStoredAuthUser(platform, user),
    cookie,
  });
  writeFallbackCredentials(current);
}

function removeFallbackCredential(platform: MusicPlatform): void {
  const current = readFallbackCredentials().filter((item) => item.user.platform !== platform);
  writeFallbackCredentials(current);
}

function toUnifiedUser(stored: StoredAuthUser): UnifiedUser {
  return {
    platform: stored.platform as MusicPlatform,
    userId: stored.user_id,
    nickname: stored.nickname,
    avatarUrl: stored.avatar_url,
    isLoggedIn: stored.is_logged_in,
  };
}

export const selectIsAuthenticated = (state: AuthState) =>
  Boolean(state.users.netease || state.users.qq);

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
  isLoading: true,

  // Actions
  loadStoredCredentials: async () => {
    try {
      let stored: StoredCredentials[] = readFallbackCredentials();

      if (canUseTauriInvoke()) {
        try {
          stored = await invoke<StoredCredentials[]>('get_all_auth');
        } catch (error) {
          console.warn('Failed to read Tauri auth store, fallback to local storage:', error);
        }
      }

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

      set({ users, cookies, isLoading: false });
    } catch (error) {
      console.error('Failed to load stored credentials:', error);
      set({ isLoading: false });
    }
  },

  setUser: async (platform, user, cookie) => {
    try {
      let shouldPersistFallback = !canUseTauriInvoke();

      if (canUseTauriInvoke()) {
        try {
          await invoke('store_auth', {
            platform,
            userId: user.userId,
            nickname: user.nickname,
            avatarUrl: user.avatarUrl,
            cookie,
          });
        } catch (error) {
          console.warn('Failed to persist auth to Tauri store, fallback to local storage:', error);
          shouldPersistFallback = true;
        }
      }

      if (shouldPersistFallback) {
        upsertFallbackCredential(platform, user, cookie);
      }

      set((state) => ({
        users: { ...state.users, [platform]: user },
        cookies: { ...state.cookies, [platform]: cookie },
      }));
    } catch (error) {
      console.error('Failed to store auth:', error);
      throw error;
    }
  },

  removeUser: async (platform) => {
    try {
      if (canUseTauriInvoke()) {
        try {
          await invoke('remove_auth', { platform });
        } catch (error) {
          console.warn('Failed to remove auth from Tauri store, fallback to local storage:', error);
        }
      }
      removeFallbackCredential(platform);

      set((state) => ({
          users: { ...state.users, [platform]: null },
          cookies: { ...state.cookies, [platform]: null },
        }));
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
        try {
          await invoke('clear_all_auth');
        } catch (error) {
          console.warn('Failed to clear Tauri auth store, fallback to local storage:', error);
        }
      }
      writeFallbackCredentials([]);

      set({
        users: { netease: null, qq: null },
        cookies: { netease: null, qq: null },
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
