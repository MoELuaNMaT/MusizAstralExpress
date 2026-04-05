import { create } from 'zustand';

export type ThemeId = 'night' | 'day' | 'clay' | 'fallout';
export type UiVersion = 'current' | 'v4-glam' | 'v8-clay' | 'v8-fallout' | 'y2k-af';

export const THEME_STORAGE_KEY = 'allmusic_theme_id_v2';
export const LEGACY_THEME_MODE_STORAGE_KEY = 'allmusic_theme_mode_v1';
export const UI_VERSION_STORAGE_KEY = 'allmusic_ui_version_v1';

const uiVersionSwitchEnvFlag = String(import.meta.env.VITE_ENABLE_UI_VERSION_SWITCH || '').trim().toLowerCase();
const uiVersionSwitchForcedOn = uiVersionSwitchEnvFlag === '1' || uiVersionSwitchEnvFlag === 'true' || uiVersionSwitchEnvFlag === 'on';
const uiVersionSwitchForcedOff = uiVersionSwitchEnvFlag === '0' || uiVersionSwitchEnvFlag === 'false' || uiVersionSwitchEnvFlag === 'off';

// Enable UI switching by default in both dev and packaged builds; allow explicit opt-out via env.
export const UI_VERSION_SWITCH_ENABLED = uiVersionSwitchForcedOn
  ? true
  : (uiVersionSwitchForcedOff ? false : true);

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  icon: string;
}

export interface UiVersionOption {
  id: UiVersion;
  label: string;
  description: string;
  icon: string;
}

// Keep current UI themes focused on day/night. clay/fallout are now independent UI versions.
export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'night', label: '夜间霓虹', description: '当前 UI 的深色风格', icon: '🌙' },
  { id: 'day', label: '白天清新', description: '当前 UI 的浅色风格', icon: '☀️' },
];

export const UI_VERSION_OPTIONS: UiVersionOption[] = [
  { id: 'current', label: '普通UI', description: '当前 React 主界面', icon: '🎵' },
  { id: 'v4-glam', label: '复古UI', description: 'Gemini Fusion UX 复古界面', icon: '✨' },
  { id: 'v8-clay', label: 'V8 Clay', description: 'Claymorphism 原样布局', icon: '🫧' },
  { id: 'v8-fallout', label: 'V8 Fallout', description: 'Fallout 终端原样布局', icon: '📟' },
  { id: 'y2k-af', label: 'Y2K AF', description: 'Y2K 路由化预览界面', icon: '💒' },
];

interface ThemeState {
  theme: ThemeId;
  uiVersion: UiVersion;
  setTheme: (theme: ThemeId) => void;
  cycleTheme: () => void;
  setUiVersion: (uiVersion: UiVersion) => void;
}

function isThemeId(value: string | null): value is ThemeId {
  return value === 'night' || value === 'day' || value === 'clay' || value === 'fallout';
}

function isUiVersion(value: string | null): value is UiVersion {
  return value === 'current' || value === 'v4-glam' || value === 'v8-clay' || value === 'v8-fallout' || value === 'y2k-af';
}

function migrateLegacyThemeToUiVersion(theme: ThemeId | null): UiVersion | null {
  if (theme === 'clay') {
    return 'v8-clay';
  }
  if (theme === 'fallout') {
    return 'v8-fallout';
  }
  return null;
}

function normalizeTheme(theme: ThemeId | null): ThemeId {
  if (theme === 'day') {
    return 'day';
  }
  // Default current UI palette to night; keep legacy values out of current UI switcher.
  return 'night';
}

function readInitialState(): Pick<ThemeState, 'theme' | 'uiVersion'> {
  if (typeof window === 'undefined') {
    return { theme: 'night', uiVersion: 'current' };
  }

  const storedThemeRaw = window.localStorage.getItem(THEME_STORAGE_KEY);
  const storedTheme = isThemeId(storedThemeRaw) ? storedThemeRaw : null;
  const legacyTheme = window.localStorage.getItem(LEGACY_THEME_MODE_STORAGE_KEY);

  const storedUiVersionRaw = window.localStorage.getItem(UI_VERSION_STORAGE_KEY);
  const storedUiVersion = isUiVersion(storedUiVersionRaw) ? storedUiVersionRaw : null;

  const migratedUiVersion = migrateLegacyThemeToUiVersion(storedTheme);
  const uiVersion = UI_VERSION_SWITCH_ENABLED
    ? (storedUiVersion || migratedUiVersion || 'current')
    : 'current';

  const themeFromLegacy: ThemeId | null = legacyTheme === 'day' ? 'day' : null;
  const theme = normalizeTheme(storedTheme || themeFromLegacy);

  if (!UI_VERSION_SWITCH_ENABLED && storedUiVersionRaw !== 'current') {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, 'current');
  }

  return { theme, uiVersion };
}

function persistTheme(theme: ThemeId): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  // Backward compatibility for old clients that only understand day/night.
  window.localStorage.setItem(LEGACY_THEME_MODE_STORAGE_KEY, theme === 'day' ? 'day' : 'night');
}

function persistUiVersion(uiVersion: UiVersion): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(UI_VERSION_STORAGE_KEY, uiVersion);
}

const initialState = readInitialState();

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialState.theme,
  uiVersion: initialState.uiVersion,

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

  setUiVersion: (uiVersion) => {
    if (!UI_VERSION_SWITCH_ENABLED) {
      persistUiVersion('current');
      set({ uiVersion: 'current' });
      return;
    }
    persistUiVersion(uiVersion);
    set({ uiVersion });
  },
}));

