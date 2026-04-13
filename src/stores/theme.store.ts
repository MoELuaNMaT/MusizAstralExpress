import { create } from 'zustand';

export type ThemeId = 'night' | 'day' | 'clay' | 'fallout';

export const THEME_STORAGE_KEY = 'allmusic_theme_id_v2';
export const LEGACY_THEME_MODE_STORAGE_KEY = 'allmusic_theme_mode_v1';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  icon: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'night', label: '夜间霓虹', description: 'Deck 主界面的深色风格', icon: '🌙' },
  { id: 'day', label: '白天清新', description: 'Deck 主界面的浅色风格', icon: '☀️' },
];

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  cycleTheme: () => void;
}

function isThemeId(value: string | null): value is ThemeId {
  return value === 'night' || value === 'day' || value === 'clay' || value === 'fallout';
}

function normalizeTheme(theme: ThemeId | null): ThemeId {
  if (theme === 'day') {
    return 'day';
  }
  return 'night';
}

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') {
    return 'night';
  }

  const storedThemeRaw = window.localStorage.getItem(THEME_STORAGE_KEY);
  const storedTheme = isThemeId(storedThemeRaw) ? storedThemeRaw : null;
  const legacyTheme = window.localStorage.getItem(LEGACY_THEME_MODE_STORAGE_KEY);
  const themeFromLegacy: ThemeId | null = legacyTheme === 'day' ? 'day' : null;
  return normalizeTheme(storedTheme || themeFromLegacy);
}

function persistTheme(theme: ThemeId): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.localStorage.setItem(LEGACY_THEME_MODE_STORAGE_KEY, theme === 'day' ? 'day' : 'night');
}

const initialTheme = readInitialTheme();

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    const normalized = normalizeTheme(theme);
    persistTheme(normalized);
    set({ theme: normalized });
  },
  cycleTheme: () => {
    const current = get().theme;
    const list = THEME_OPTIONS.map((option) => option.id);
    const currentIndex = list.indexOf(current);
    const next = list[(currentIndex + 1) % list.length];
    persistTheme(next);
    set({ theme: next });
  },
}));
