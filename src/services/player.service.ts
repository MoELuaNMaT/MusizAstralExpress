import type { UnifiedSong } from '@/types';

const NETEASE_API_BASE_URL = 'http://localhost:3000';
const QQ_API_BASE_URL = 'http://localhost:3001';

interface ResolvePlayUrlContext {
  neteaseCookie?: string | null;
  qqCookie?: string | null;
  quality?: '128' | '320' | 'flac';
}

interface ResolvePlayUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

class PlayerService {
  async resolveSongPlayUrl(song: UnifiedSong, context: ResolvePlayUrlContext): Promise<ResolvePlayUrlResult> {
    if (song.playUrl) {
      return { success: true, url: song.playUrl };
    }

    if (song.platform === 'netease') {
      return this.resolveNeteaseSongUrl(song, context.neteaseCookie);
    }

    if (song.platform === 'qq') {
      return this.resolveQQSongUrl(song, context.qqCookie, context.quality || '128');
    }

    return {
      success: false,
      error: '暂不支持该平台播放。',
    };
  }

  private async resolveNeteaseSongUrl(song: UnifiedSong, cookie?: string | null): Promise<ResolvePlayUrlResult> {
    const endpointV1 = this.buildNeteaseUrl(
      '/song/url/v1',
      {
        id: song.originalId,
        level: 'standard',
        timestamp: String(Date.now()),
      },
      cookie,
    );

    const v1Response = await this.fetchJson<any>(endpointV1, { cache: 'no-store' });
    const v1Url = this.extractNeteaseSongUrl(v1Response.data);
    if (v1Response.ok && v1Url) {
      return { success: true, url: v1Url };
    }

    const endpointLegacy = this.buildNeteaseUrl(
      '/song/url',
      {
        id: song.originalId,
        br: '320000',
        timestamp: String(Date.now()),
      },
      cookie,
    );

    const legacyResponse = await this.fetchJson<any>(endpointLegacy, { cache: 'no-store' });
    const legacyUrl = this.extractNeteaseSongUrl(legacyResponse.data);
    if (legacyResponse.ok && legacyUrl) {
      return { success: true, url: legacyUrl };
    }

    return {
      success: false,
      error: legacyResponse.error || v1Response.error || '网易云未返回可播放链接。',
    };
  }

  private async resolveQQSongUrl(
    song: UnifiedSong,
    cookie: string | null | undefined,
    quality: '128' | '320' | 'flac',
  ): Promise<ResolvePlayUrlResult> {
    const identity = this.resolveQQSongIdentity(song);
    if (!identity.songMid && !identity.songId) {
      return {
        success: false,
        error: 'QQ 歌曲缺少可用 ID，暂时无法播放。',
      };
    }

    const qualityFallbacks = this.buildQQQualityFallbacks(quality);
    let latestError = '';

    for (const fallbackQuality of qualityFallbacks) {
      const params = new URLSearchParams({
        quality: fallbackQuality,
        timestamp: String(Date.now()),
      });
      if (identity.songMid) {
        params.set('mid', identity.songMid);
      }
      if (identity.songId) {
        params.set('id', identity.songId);
      }

      const endpoint = `${QQ_API_BASE_URL}/song/url?${params.toString()}`;
      const response = await this.fetchJson<any>(endpoint, {
        headers: this.buildQQAuthHeaders(cookie),
        cache: 'no-store',
      });

      const url = this.toText(response.data?.data?.url ?? response.data?.url);
      if (response.ok && url) {
        return { success: true, url };
      }
      latestError = response.error || latestError;
    }

    return {
      success: false,
      error: latestError || 'QQ 音乐未返回可播放链接。',
    };
  }

  private buildNeteaseUrl(path: string, params: Record<string, string>, cookie?: string | null): string {
    const searchParams = new URLSearchParams(params);
    if (cookie?.trim()) {
      searchParams.set('cookie', cookie.trim());
    }
    return `${NETEASE_API_BASE_URL}${path}?${searchParams.toString()}`;
  }

  private buildQQAuthHeaders(cookie?: string | null): Record<string, string> {
    if (!cookie?.trim()) {
      return {};
    }

    const bearerToken = `Bearer ${cookie.trim()}`;
    return {
      token: bearerToken,
      Authorization: bearerToken,
    };
  }

  private resolveQQSongIdentity(song: UnifiedSong): { songMid: string; songId: string } {
    const explicitMid = this.toText(song.qqSongMid);
    const explicitSongId = this.toText(song.qqSongId);
    const originalId = this.toText(song.originalId);
    const isOriginalNumeric = /^\d+$/.test(originalId);

    return {
      songMid: explicitMid || (isOriginalNumeric ? '' : originalId),
      songId: explicitSongId || (isOriginalNumeric ? originalId : ''),
    };
  }

  private buildQQQualityFallbacks(preferred: '128' | '320' | 'flac'): Array<'128' | '320' | 'flac'> {
    if (preferred === 'flac') {
      return ['flac', '320', '128'];
    }
    if (preferred === '320') {
      return ['320', '128'];
    }
    return ['128'];
  }

  private extractNeteaseSongUrl(payload: any): string {
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const first = list[0] || {};
    return this.toText(first.url);
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });

      const data = (await response.json().catch(() => undefined)) as T | undefined;
      if (!response.ok) {
        const maybeMessage = this.extractErrorMessage(data);
        return {
          ok: false,
          error: maybeMessage || `Request failed (HTTP ${response.status})`,
        };
      }

      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      const isConnectionIssue = /failed to fetch|networkerror|err_connection_refused|fetch failed/i.test(message);
      return {
        ok: false,
        error: isConnectionIssue ? '本地播放服务未启动或端口不可达。' : message,
      };
    }
  }

  private extractErrorMessage(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const candidate = payload as { message?: unknown; error?: unknown; msg?: unknown; errMsg?: unknown };
    const message = candidate.message ?? candidate.error ?? candidate.msg ?? candidate.errMsg;
    return typeof message === 'string' && message.trim() ? message : undefined;
  }

  private toText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return '';
  }
}

export const playerService = new PlayerService();
