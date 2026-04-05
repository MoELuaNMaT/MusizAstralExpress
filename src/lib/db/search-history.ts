const SEARCH_HISTORY_STORAGE_KEY = 'allmusic_search_history_v1';
const SEARCH_HISTORY_LIMIT = 30;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim();
}

export function readSearchHistory(): string[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === 'string' ? normalizeKeyword(item) : ''))
      .filter(Boolean)
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeSearchHistory(history: string[]): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, SEARCH_HISTORY_LIMIT)));
  } catch {
    // Ignore storage write failures to avoid interrupting search flow.
  }
}

export function addSearchHistoryKeyword(keyword: string): string[] {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) {
    return readSearchHistory();
  }

  const current = readSearchHistory();
  const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, SEARCH_HISTORY_LIMIT);
  writeSearchHistory(next);
  return next;
}

export function clearSearchHistory(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
}

export function buildSearchSuggestions(keyword: string, history: string[], maxCount = 8): string[] {
  const normalizedKeyword = normalizeKeyword(keyword).toLowerCase();
  if (!normalizedKeyword) {
    return history.slice(0, maxCount);
  }

  const startsWithMatches = history.filter((item) => item.toLowerCase().startsWith(normalizedKeyword));
  const fuzzyMatches = history.filter(
    (item) => item.toLowerCase().includes(normalizedKeyword) && !item.toLowerCase().startsWith(normalizedKeyword),
  );

  return [...startsWithMatches, ...fuzzyMatches].slice(0, maxCount);
}
