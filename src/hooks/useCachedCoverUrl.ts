import { useEffect, useState } from 'react';
import { resolveCachedCoverUrl } from '@/lib/db/cover-cache';
import { normalizeImageUrl } from '@/lib/image-url';

export function useCachedCoverUrl(coverUrl: string | null | undefined, fallbackUrl: string): string {
  // 确保传入的 URL 已经是 HTTPS
  const normalizedCoverUrl = normalizeImageUrl(coverUrl);
  const normalizedFallback = normalizeImageUrl(fallbackUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string>(() => normalizedCoverUrl || normalizedFallback);

  useEffect(() => {
    let active = true;
    const directUrl = normalizedCoverUrl || normalizedFallback;
    setResolvedUrl(directUrl);

    if (!normalizedCoverUrl) {
      return () => {
        active = false;
      };
    }

    void resolveCachedCoverUrl(normalizedCoverUrl).then((cachedUrl) => {
      if (!active) {
        return;
      }
      setResolvedUrl(cachedUrl || normalizedFallback);
    });

    return () => {
      active = false;
    };
  }, [normalizedCoverUrl, normalizedFallback]);

  return resolvedUrl;
}
