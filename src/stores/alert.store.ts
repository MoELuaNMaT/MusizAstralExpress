import { create } from 'zustand';

export type AlertLevel = 'error' | 'warning' | 'info' | 'success';

export interface AlertItem {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  source?: string;
  detail?: string;
  createdAt: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface AlertInput {
  level?: AlertLevel;
  title?: string;
  message: string;
  source?: string;
  detail?: string;
  dedupeKey?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface AlertState {
  queue: AlertItem[];
  pushAlert: (input: AlertInput) => AlertItem | null;
  dismissCurrent: () => void;
  clearAlerts: () => void;
}

const ALERT_DEDUPE_WINDOW_MS = 5000;
const MAX_RECENT_MAP_SIZE = 200;
const recentAlertMap = new Map<string, number>();

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim();
}

function cleanupRecentAlerts(now: number): void {
  for (const [key, timestamp] of recentAlertMap.entries()) {
    if (now - timestamp > ALERT_DEDUPE_WINDOW_MS) {
      recentAlertMap.delete(key);
    }
  }
}

function buildDedupeKey(input: AlertInput): string {
  const level = input.level || 'error';
  const source = normalizeText(input.source) || 'unknown';
  const title = normalizeText(input.title) || '系统提示';
  const message = normalizeText(input.message);
  return normalizeText(input.dedupeKey) || `${level}|${source}|${title}|${message}`;
}

function buildAlertId(now: number): string {
  return `alert-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAlertStore = create<AlertState>()((set) => ({
  queue: [],
  pushAlert: (input) => {
    const message = normalizeText(input.message);
    if (!message) {
      return null;
    }

    const now = Date.now();
    cleanupRecentAlerts(now);

    const dedupeKey = buildDedupeKey({
      ...input,
      message,
    });
    const previousTimestamp = recentAlertMap.get(dedupeKey);
    if (typeof previousTimestamp === 'number' && now - previousTimestamp < ALERT_DEDUPE_WINDOW_MS) {
      return null;
    }
    recentAlertMap.set(dedupeKey, now);
    if (recentAlertMap.size > MAX_RECENT_MAP_SIZE) {
      const oldest = recentAlertMap.keys().next().value;
      if (oldest !== undefined) recentAlertMap.delete(oldest);
    }

    const item: AlertItem = {
      id: buildAlertId(now),
      level: input.level || 'error',
      title: normalizeText(input.title) || '系统提示',
      message,
      source: normalizeText(input.source) || undefined,
      detail: normalizeText(input.detail) || undefined,
      createdAt: now,
      actionLabel: normalizeText(input.actionLabel) || undefined,
      onAction: input.onAction,
    };

    set((state) => ({
      queue: [...state.queue, item],
    }));

    return item;
  },
  dismissCurrent: () => {
    set((state) => ({
      queue: state.queue.slice(1),
    }));
  },
  clearAlerts: () => {
    set({ queue: [] });
  },
}));
