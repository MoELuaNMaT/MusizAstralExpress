import type { UnifiedSong } from '@/types';
import { getNeteaseApiBaseUrl, getQQApiBaseUrl, resolveRuntimeTarget } from '@/config/platform.config';

const NETEASE_API_BASE_URL = getNeteaseApiBaseUrl();
const QQ_API_BASE_URL = getQQApiBaseUrl();

interface ResolvePlayUrlContext {
  neteaseCookie?: string | null;
  qqCookie?: string | null;
  quality?: '128' | '320' | 'flac';
  forceRefresh?: boolean;
}

interface ResolvePlayUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

interface NeteaseUrlItem {
  url?: string | null;
  code?: number;
  fee?: number;
  freeTrialInfo?: unknown;
  level?: string;
}

interface NeteaseUrlResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: NeteaseUrlItem[];
}

interface QQUrlResponse {
  code?: number;
  data?: {
    url?: string;
    data?: { url?: string };
  };
  url?: string;
}

class PlayerService {
  private getConnectionIssueMessage(): string {
    if (resolveRuntimeTarget() === 'tauri-mobile') {
      return '\u68C0\u6D4B\u5230 Android \u7AEF\u672C\u5730\u64AD\u653E\u670D\u52A1\u4E0D\u53EF\u8FBE\uFF1A\u8BF7\u5148\u5728\u5BBF\u4E3B\u673A\u8FD0\u884C `npm run dev:services`\uFF08\u6216 `npm run android:dev`\uFF09\uFF0C\u5E76\u786E\u4FDD 10.0.2.2:3000/3001 \u53EF\u8BBF\u95EE\u3002';
    }

    return '\u672C\u5730\u64AD\u653E\u670D\u52A1\u672A\u542F\u52A8\u6216\u7AEF\u53E3\u4E0D\u53EF\u8FBE\u3002';
  }

  async resolveSongPlayUrl(song: UnifiedSong, context: ResolvePlayUrlContext): Promise<ResolvePlayUrlResult> {
    if (song.playUrl && !context.forceRefresh) {
      return { success: true, url: song.playUrl };
    }

    if (song.platform === 'netease') {
      return this.resolveNeteaseSongUrl(song, context.neteaseCookie, context.quality || '320');
    }

    if (song.platform === 'qq') {
      return this.resolveQQSongUrl(song, context.qqCookie, context.quality || '320');
    }

    return {
      success: false,
      error: '暂不支持该平台播放。',
    };
  }

  private async resolveNeteaseSongUrl(
    song: UnifiedSong,
    cookie: string | null | undefined,
    quality: '128' | '320' | 'flac',
  ): Promise<ResolvePlayUrlResult> {
    const qualityFallbacks = this.buildNeteaseQualityFallbacks(quality);
    const neteaseHeaders = this.buildNeteaseAuthHeaders(cookie);
    let latestError = '';

    for (const fallback of qualityFallbacks) {
      const endpointV1 = this.buildNeteaseUrl(
        '/song/url/v1',
        {
          id: song.originalId,
          level: fallback.level,
          timestamp: String(Date.now()),
        },
        cookie,
      );

      const v1Response = await this.fetchJson<NeteaseUrlResponse>(endpointV1, { headers: neteaseHeaders, cache: 'no-store' });
      const v1Url = this.extractNeteaseSongUrl(v1Response.data);
      if (v1Response.ok && v1Url) {
        return { success: true, url: v1Url };
      }
      latestError = v1Response.error
        || this.describeNeteaseUrlFailure(v1Response.data)
        || latestError;

      const endpointLegacy = this.buildNeteaseUrl(
        '/song/url',
        {
          id: song.originalId,
          br: fallback.br,
          timestamp: String(Date.now()),
        },
        cookie,
      );

      const legacyResponse = await this.fetchJson<NeteaseUrlResponse>(endpointLegacy, { headers: neteaseHeaders, cache: 'no-store' });
      const legacyUrl = this.extractNeteaseSongUrl(legacyResponse.data);
      if (legacyResponse.ok && legacyUrl) {
        return { success: true, url: legacyUrl };
      }
      latestError = legacyResponse.error
        || this.describeNeteaseUrlFailure(legacyResponse.data)
        || latestError;
    }

    return {
      success: false,
      error: latestError || '网易云未返回可播放链接。',
    };
  }

  private describeNeteaseUrlFailure(payload: NeteaseUrlResponse | undefined): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    // Some responses return a non-200 top-level code (e.g. login expired).
    if (typeof payload.code === 'number' && payload.code !== 200) {
      if (payload.code === 301) {
        return '网易云登录状态已失效，请重新登录。';
      }
      const message = this.extractErrorMessage(payload);
      return message ? `网易云接口返回异常（code=${payload.code}）：${message}` : `网易云接口返回异常（code=${payload.code}）。`;
    }

    const list = Array.isArray(payload.data) ? payload.data : [];
    const first = list[0];
    if (!first || typeof first !== 'object') {
      return '';
    }

    const itemCode = typeof first.code === 'number' ? first.code : undefined;
    const fee = typeof first.fee === 'number' ? first.fee : undefined;

    // NetEase uses per-item code when url is null.
    if (itemCode === 404) {
      return '网易云未提供可播放链接：该歌曲可能无版权或已下架。';
    }
    if (itemCode === 403) {
      return '网易云未提供可播放链接：该歌曲可能需要会员/购买或无权限播放。';
    }

    if (fee && fee > 0) {
      if (first.freeTrialInfo) {
        return '网易云未提供可播放链接：该歌曲可能仅提供试听，完整播放可能需要会员/购买。';
      }
      return '网易云未提供可播放链接：该歌曲可能需要会员/购买后才能播放。';
    }

    return '';
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
      const response = await this.fetchJson<QQUrlResponse>(endpoint, {
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

  private buildNeteaseAuthHeaders(cookie?: string | null): Record<string, string> {
    if (!cookie?.trim()) {
      return {};
    }
    return { Cookie: cookie.trim() };
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

  private buildNeteaseQualityFallbacks(
    preferred: '128' | '320' | 'flac',
  ): Array<{ level: 'standard' | 'exhigh' | 'lossless'; br: string }> {
    if (preferred === 'flac') {
      return [
        { level: 'lossless', br: '999000' },
        { level: 'exhigh', br: '320000' },
        { level: 'standard', br: '128000' },
      ];
    }
    if (preferred === '320') {
      return [
        { level: 'exhigh', br: '320000' },
        { level: 'standard', br: '128000' },
      ];
    }
    return [{ level: 'standard', br: '128000' }];
  }

  private extractNeteaseSongUrl(payload: NeteaseUrlResponse | undefined): string {
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const first = list[0] || {};
    return this.normalizePlayableUrl(this.toText(first.url));
  }

  private normalizePlayableUrl(url: string): string {
    if (!url || !/^http:\/\//i.test(url)) {
      return url;
    }

    // Keep local debugging endpoints unchanged; only upgrade external media links.
    if (/^http:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?\//i.test(url)) {
      return url;
    }

    return url.replace(/^http:\/\//i, 'https://');
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? controller.signal,
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
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      const isConnectionIssue = /failed to fetch|networkerror|err_connection_refused|fetch failed/i.test(message);
      return {
        ok: false,
        error: isAbort ? '请求超时（15s），请检查本地 API 状态。' : (isConnectionIssue ? this.getConnectionIssueMessage() : message),
      };
    } finally {
      clearTimeout(timeoutId);
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
