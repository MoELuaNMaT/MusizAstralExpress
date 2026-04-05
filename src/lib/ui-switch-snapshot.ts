import { usePlayerStore } from '@/stores';
import { UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY } from '@/constants/app.constants';
import type { UiSwitchPlaybackSnapshot } from '@/types/bridge.types';

export type RestoreResult =
  | { success: true }
  | { success: false; reason: 'no_snapshot' | 'invalid_snapshot' | 'expired' | 'song_mismatch' | 'restore_failed' };

/** Snapshot the current playback position so a UI switch can resume seamlessly. */
export function captureUiSwitchPlaybackSnapshot(): void {
  if (typeof window === 'undefined') return;

  const player = usePlayerStore.getState();
  const snapshot: UiSwitchPlaybackSnapshot = {
    songId: player.currentSong?.id || null,
    currentTime: Math.max(0, Math.floor(player.currentTime || 0)),
    isPlaying: Boolean(player.isPlaying),
    capturedAt: Date.now(),
  };
  window.localStorage.setItem(
    UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
}

/** Restore a previously captured snapshot — seeks and resumes if still valid (<15 s). */
export function restoreUiSwitchPlaybackSnapshot(
  seekFn: (ms: number) => void,
): RestoreResult {
  if (typeof window === 'undefined') return { success: false, reason: 'no_snapshot' };

  const raw = window.localStorage.getItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
  if (!raw) return { success: false, reason: 'no_snapshot' };

  let snapshot: UiSwitchPlaybackSnapshot | null = null;
  try {
    snapshot = JSON.parse(raw) as UiSwitchPlaybackSnapshot;
  } catch {
    window.localStorage.removeItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
    return { success: false, reason: 'invalid_snapshot' };
  }

  if (
    !snapshot
    || typeof snapshot.capturedAt !== 'number'
    || typeof snapshot.currentTime !== 'number'
    || !Number.isFinite(snapshot.currentTime)
  ) {
    window.localStorage.removeItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
    return { success: false, reason: 'invalid_snapshot' };
  }

  if (Date.now() - snapshot.capturedAt > 15_000 || !snapshot.songId) {
    window.localStorage.removeItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
    return { success: false, reason: 'expired' };
  }

  const player = usePlayerStore.getState();
  if (player.currentSong?.id !== snapshot.songId) {
    window.localStorage.removeItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
    return { success: false, reason: 'song_mismatch' };
  }

  const requiresSeek = Math.abs((player.currentTime || 0) - snapshot.currentTime) > 1200;
  if (requiresSeek) {
    seekFn(snapshot.currentTime);
  }

  const afterSeek = usePlayerStore.getState();
  const seekRestored = !requiresSeek || Math.abs((afterSeek.currentTime || 0) - snapshot.currentTime) <= 1200;

  if (snapshot.isPlaying !== afterSeek.isPlaying) {
    afterSeek.setIsPlaying(snapshot.isPlaying);
  }
  const playRestored = usePlayerStore.getState().isPlaying === snapshot.isPlaying;

  if (!seekRestored || !playRestored) {
    return { success: false, reason: 'restore_failed' };
  }
  window.localStorage.removeItem(UI_SWITCH_PLAYBACK_SNAPSHOT_STORAGE_KEY);
  return { success: true };
}
