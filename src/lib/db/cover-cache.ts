import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { canUseTauriInvoke, isLikelyTauriMobileRuntime } from '@/lib/runtime';

const REMOTE_COVER_URL_RE = /^https?:\/\//i;
const COVER_CACHE_MAX_ENTRIES = 600;

const cachedCoverUrlMap = new Map<string, string>();
const inflightCoverTasks = new Map<string, Promise<string>>();

function normalizeCoverUrl(rawCoverUrl: string): string {
  return rawCoverUrl.trim();
}

function canUseCoverDiskCache(coverUrl: string): boolean {
  return Boolean(coverUrl)
    && REMOTE_COVER_URL_RE.test(coverUrl)
    && canUseTauriInvoke()
    && !isLikelyTauriMobileRuntime();
}

function toTauriFileUrl(localPath: string): string {
  return convertFileSrc(localPath.replace(/\\/g, '/'));
}

function rememberCoverUrl(url: string, fileUrl: string): void {
  cachedCoverUrlMap.set(url, fileUrl);
  if (cachedCoverUrlMap.size <= COVER_CACHE_MAX_ENTRIES) {
    return;
  }

  const overflow = cachedCoverUrlMap.size - COVER_CACHE_MAX_ENTRIES;
  if (overflow <= 0) {
    return;
  }

  const oldestKeys = cachedCoverUrlMap.keys();
  for (let i = 0; i < overflow; i += 1) {
    const key = oldestKeys.next();
    if (key.done) {
      break;
    }
    cachedCoverUrlMap.delete(key.value);
  }
}

export async function resolveCachedCoverUrl(rawCoverUrl: string): Promise<string> {
  const coverUrl = normalizeCoverUrl(rawCoverUrl);
  if (!canUseCoverDiskCache(coverUrl)) {
    return coverUrl;
  }

  const memoryCached = cachedCoverUrlMap.get(coverUrl);
  if (memoryCached) {
    return memoryCached;
  }

  const pendingTask = inflightCoverTasks.get(coverUrl);
  if (pendingTask) {
    return pendingTask;
  }

  const task = invoke<string>('cache_cover_image', { url: coverUrl })
    .then((localPath) => {
      const normalizedPath = (localPath || '').trim();
      if (!normalizedPath) {
        return coverUrl;
      }
      const fileUrl = toTauriFileUrl(normalizedPath);
      rememberCoverUrl(coverUrl, fileUrl);
      return fileUrl;
    })
    .catch(() => coverUrl)
    .finally(() => {
      inflightCoverTasks.delete(coverUrl);
    });

  inflightCoverTasks.set(coverUrl, task);
  return task;
}
