import { create } from 'zustand';

export type ToastLevel = 'info' | 'warning' | 'error' | 'success';

export interface ToastItem {
  id: string;
  level: ToastLevel;
  title?: string;
  message: string;
  source?: string;
  createdAt: number;
  durationMs: number;
}

export interface ToastInput {
  level?: ToastLevel;
  title?: string;
  message: string;
  source?: string;
  dedupeKey?: string;
  durationMs?: number;
}

interface ToastState {
  queue: ToastItem[];
  pushToast: (input: ToastInput) => ToastItem | null;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_TOASTS = 3;
const DEFAULT_TOAST_DURATION_MS = 2600;
const MIN_TOAST_DURATION_MS = 1200;
const MAX_TOAST_DURATION_MS = 7000;
const TOAST_DEDUPE_WINDOW_MS = 2500;
const MAX_RECENT_MAP_SIZE = 200;

const recentToastMap = new Map<string, number>();
const toastTimerMap = new Map<string, number>();

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim();
}

function cleanupRecentToasts(now: number): void {
  for (const [key, timestamp] of recentToastMap.entries()) {
    if (now - timestamp > TOAST_DEDUPE_WINDOW_MS) {
      recentToastMap.delete(key);
    }
  }
}

function cleanupToastTimer(id: string): void {
  const timer = toastTimerMap.get(id);
  if (typeof timer === 'number' && typeof window !== 'undefined') {
    window.clearTimeout(timer);
  }
  toastTimerMap.delete(id);
}

function resolveToastDuration(inputDuration: number | undefined): number {
  const value = Number(inputDuration || DEFAULT_TOAST_DURATION_MS);
  if (!Number.isFinite(value)) {
    return DEFAULT_TOAST_DURATION_MS;
  }
  return Math.max(MIN_TOAST_DURATION_MS, Math.min(MAX_TOAST_DURATION_MS, Math.floor(value)));
}

function buildDedupeKey(input: ToastInput): string {
  const level = input.level || 'info';
  const title = normalizeText(input.title);
  const message = normalizeText(input.message);
  const source = normalizeText(input.source);
  return normalizeText(input.dedupeKey) || `${level}|${source}|${title}|${message}`;
}

function buildToastId(now: number): string {
  return `toast-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  queue: [],
  pushToast: (input) => {
    const message = normalizeText(input.message);
    if (!message) {
      return null;
    }

    const now = Date.now();
    cleanupRecentToasts(now);

    const dedupeKey = buildDedupeKey({
      ...input,
      message,
    });
    const previousTimestamp = recentToastMap.get(dedupeKey);
    if (typeof previousTimestamp === 'number' && now - previousTimestamp < TOAST_DEDUPE_WINDOW_MS) {
      return null;
    }
    recentToastMap.set(dedupeKey, now);
    if (recentToastMap.size > MAX_RECENT_MAP_SIZE) {
      const oldest = recentToastMap.keys().next().value;
      if (oldest !== undefined) recentToastMap.delete(oldest);
    }

    const item: ToastItem = {
      id: buildToastId(now),
      level: input.level || 'info',
      title: normalizeText(input.title) || undefined,
      message,
      source: normalizeText(input.source) || undefined,
      createdAt: now,
      durationMs: resolveToastDuration(input.durationMs),
    };

    set((state) => {
      const nextQueue = [...state.queue, item];
      if (nextQueue.length <= MAX_TOASTS) {
        return { queue: nextQueue };
      }

      const dropped = nextQueue.slice(0, nextQueue.length - MAX_TOASTS);
      dropped.forEach((toast) => cleanupToastTimer(toast.id));
      return { queue: nextQueue.slice(-MAX_TOASTS) };
    });

    if (typeof window !== 'undefined') {
      const timer = window.setTimeout(() => {
        get().removeToast(item.id);
      }, item.durationMs);
      toastTimerMap.set(item.id, timer);
    }

    return item;
  },
  removeToast: (id) => {
    cleanupToastTimer(id);
    set((state) => ({
      queue: state.queue.filter((item) => item.id !== id),
    }));
  },
  clearToasts: () => {
    for (const id of toastTimerMap.keys()) {
      cleanupToastTimer(id);
    }
    set({ queue: [] });
  },
}));
