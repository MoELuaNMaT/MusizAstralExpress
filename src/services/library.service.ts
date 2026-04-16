import type { UnifiedPlaylist, UnifiedSong, PlaylistType } from '@/types';
import { invoke } from '@tauri-apps/api/core';
import { getNeteaseApiBaseUrl, getQQApiBaseUrl, resolveRuntimeTarget } from '@/config/platform.config';
import { canUseTauriInvoke } from '@/lib/runtime';
import { normalizeImageUrl } from '@/lib/image-url';

const DEFAULT_COVER = 'https://p.qlogo.cn/gh/0/0/100';
const NETEASE_WEB_ORDER_CACHE_KEY = 'allmusic_netease_web_order_cache_v1';
const NETEASE_WEB_ORDER_CACHE_LIMIT = 5000;
const LIBRARY_REQUEST_TIMEOUT_MS = 12_000;
const LIKED_STATE_CACHE_TTL_MS = 30_000;
const QQ_USER_ID_CACHE_TTL_MS = 5 * 60_000;

export interface LibraryContext {
  neteaseUserId?: string | null;
  neteaseCookie?: string | null;
  neteaseLikedOrder?: 'latest' | 'earliest' | 'api';
  forceRefreshNeteaseWebOrder?: boolean;
  qqUserId?: string | null;
  qqCookie?: string | null;
}

interface PlaylistResult {
  playlists: UnifiedPlaylist[];
  warnings: string[];
}

interface SearchResult {
  songs: UnifiedSong[];
  warnings: string[];
}

export interface DailyRecommendResult {
  songs: UnifiedSong[];
  warnings: string[];
}

export interface SongLyricResult {
  lyric: string;
  translatedLyric: string;
  warning?: string;
}

interface PlaylistDetailResult {
  songs: UnifiedSong[];
  warning?: string;
  info?: string;
}

interface NeteaseWebOrderResolution {
  songIds: string[];
  source: 'cache' | 'web' | 'cache_fallback' | 'none';
  message?: string;
}

interface NeteaseWebOrderFetchResult {
  songIds: string[];
  error?: string;
}

interface LikeActionResult {
  success: boolean;
  warning?: string;
}

type QQPlaylist = UnifiedPlaylist & {
  qqDirId?: string;
  qqSonglistId?: string;
};

interface LikedStateCacheSnapshot {
  expiresAt: number;
  neteaseCookie: string;
  qqCookie: string;
  neteaseLikedIds: string[];
  qqLikedSongIds: string[];
  qqLikedSongMids: string[];
}

interface QQUserIdCacheSnapshot {
  expiresAt: number;
  cookie: string;
  userId: string;
}

class LibraryService {
  private likedStateCache: LikedStateCacheSnapshot | null = null;
  private qqUserIdCache: QQUserIdCacheSnapshot | null = null;
  private getConnectionIssueMessage(): string {
    if (resolveRuntimeTarget() === 'tauri-mobile') {
      return '\u68C0\u6D4B\u5230 Android \u7AEF\u672C\u5730 API \u4E0D\u53EF\u8FBE\uFF1A\u8BF7\u5148\u5728\u5BBF\u4E3B\u673A\u8FD0\u884C `npm run dev:services`\uFF08\u6216 `npm run android:dev`\uFF09\uFF0C\u5E76\u786E\u4FDD 10.0.2.2:3000/3001 \u53EF\u8BBF\u95EE\u3002';
    }

    return '\u672C\u5730 API \u670D\u52A1\u672A\u542F\u52A8\u6216\u7AEF\u53E3\u4E0D\u53EF\u8FBE\u3002';
  }

  async loadUnifiedPlaylists(context: LibraryContext): Promise<PlaylistResult> {
    const requests: Array<{
      platform: 'netease' | 'qq';
      task: Promise<{ platform: 'netease' | 'qq'; playlists: UnifiedPlaylist[]; warning?: string }>;
    }> = [];

    if (context.neteaseCookie) {
      requests.push({
        platform: 'netease',
        task: this.fetchNeteasePlaylists(context.neteaseUserId || undefined, context.neteaseCookie),
      });
    }

    if (context.qqCookie) {
      requests.push({
        platform: 'qq',
        task: this.fetchQQPlaylists(context.qqCookie, context.qqUserId || undefined),
      });
    }

    if (requests.length === 0) {
      return {
        playlists: [],
        warnings: ['未检测到可用登录状态，请先连接音乐平台。'],
      };
    }

    const settled = await this.settlePlatformTasks(requests, 'playlists');
    const warnings = [...settled.warnings, ...settled.results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item))];
    const results = settled.results;

    const likedPlaylists = results
      .flatMap((item) => item.playlists)
      .filter((item) => item.type === 'liked')
      .sort((a, b) => {
        if (a.platform === b.platform) {
          return a.name.localeCompare(b.name, 'zh-CN');
        }
        return a.platform === 'netease' ? -1 : 1;
      });

    const hasNeteaseLiked = likedPlaylists.some((item) => item.platform === 'netease');
    const hasQQLiked = likedPlaylists.some((item) => item.platform === 'qq');
    const shouldShowMergedLiked = hasNeteaseLiked && hasQQLiked;

    const playlists: UnifiedPlaylist[] = shouldShowMergedLiked
      ? [this.buildMergedLikedPlaylist(likedPlaylists), ...likedPlaylists]
      : likedPlaylists;

    return { playlists, warnings };
  }

  async loadPlaylistDetail(playlist: UnifiedPlaylist, context: LibraryContext): Promise<PlaylistDetailResult> {
    let detail: PlaylistDetailResult;

    if (playlist.platform === 'merged') {
      detail = await this.fetchMergedLikedPlaylistDetail(context);
    } else if (playlist.platform === 'netease') {
      detail = await this.fetchNeteasePlaylistDetail(
        playlist,
        context.neteaseCookie || undefined,
        context.neteaseLikedOrder || 'latest',
        context.forceRefreshNeteaseWebOrder || false,
      );
    } else if (playlist.platform === 'qq') {
      detail = await this.fetchQQPlaylistDetail(playlist as QQPlaylist, context.qqCookie || undefined);
    } else {
      return {
        songs: [],
        warning: '暂不支持该平台的歌单详情。',
      };
    }

    if (playlist.type === 'liked' && detail.songs.length > 0) {
      return {
        ...detail,
        songs: detail.songs.map((song) => ({ ...song, isLiked: true })),
      };
    }

    return detail;
  }

  private buildMergedLikedPlaylist(likedPlaylists: UnifiedPlaylist[]): UnifiedPlaylist {
    const mergedSongCount = likedPlaylists.reduce((sum, item) => sum + Math.max(0, item.songCount || 0), 0);
    const coverSource = likedPlaylists.find((item) => Boolean(item.coverUrl))?.coverUrl || DEFAULT_COVER;

    return {
      id: 'merged_liked',
      platform: 'merged',
      originalId: 'merged_liked',
      type: 'liked',
      name: '双平台我喜欢',
      coverUrl: coverSource,
      songCount: mergedSongCount,
      creator: 'ALLMusic',
      description: '网易云 + QQ 音乐我喜欢歌曲混合歌单',
    };
  }

  private async fetchMergedLikedPlaylistDetail(context: LibraryContext): Promise<PlaylistDetailResult> {
    let neteaseSongsOrdered: UnifiedSong[] = [];
    let qqSongs: UnifiedSong[] = [];
    const warnings: string[] = [];
    let infoMessage: string | undefined;

    if (context.neteaseCookie) {
      // Reuse the same liked-playlist detail pipeline to avoid divergence in ID resolution/order fallback.
      const neteasePlaylistResult = await this.fetchNeteasePlaylists(
        context.neteaseUserId || undefined,
        context.neteaseCookie,
      );
      const neteaseLikedPlaylist = neteasePlaylistResult.playlists.find((item) => item.type === 'liked');

      if (!neteaseLikedPlaylist) {
        warnings.push(neteasePlaylistResult.warning || '网易云：未找到我喜欢歌单，已跳过。');
      } else {
        const neteaseDetail = await this.fetchNeteasePlaylistDetail(
          neteaseLikedPlaylist,
          context.neteaseCookie,
          'latest',
          Boolean(context.forceRefreshNeteaseWebOrder),
        );

        if (neteaseDetail.songs.length > 0) {
          let neteaseLikedPlaylistId = this.toText(neteaseLikedPlaylist.originalId);
          if (!neteaseLikedPlaylistId || neteaseLikedPlaylistId === '0') {
            const resolvedUserId = await this.resolveNeteaseUserId(
              context.neteaseCookie,
              context.neteaseUserId || undefined,
            );
            if (resolvedUserId) {
              const resolvedLikedPlaylistId = await this.resolveNeteaseLikedPlaylistId(
                resolvedUserId,
                context.neteaseCookie,
                neteaseLikedPlaylistId,
              );
              if (resolvedLikedPlaylistId) {
                neteaseLikedPlaylistId = resolvedLikedPlaylistId;
              }
            }
          }

          const trackAddedAtMap = await this.fetchNeteaseTrackAddedAtMap(
            neteaseLikedPlaylistId,
            context.neteaseCookie,
          );
          const neteaseSongsWithAddedAt = this.applyAddedAtMap(neteaseDetail.songs, trackAddedAtMap);
          neteaseSongsOrdered = neteaseSongsWithAddedAt.map((song) => ({ ...song, isLiked: true }));
        } else if (neteaseDetail.warning) {
          warnings.push(`网易云：${neteaseDetail.warning}`);
        }

        if (context.forceRefreshNeteaseWebOrder && neteaseDetail.info) {
          infoMessage = `网易云（混合歌单）：${neteaseDetail.info}`;
        }
      }
    }

    if (context.qqCookie) {
      const qqLiked = await this.fetchQQLikedSongs(context.qqCookie, context.qqUserId || undefined);
      if (qqLiked.songs.length > 0) {
        qqSongs = qqLiked.songs.map((song) => ({ ...song, isLiked: true }));
      }
      if (qqLiked.warning) {
        warnings.push(`QQ：${qqLiked.warning}`);
      }
    }

    const interleavedSongs = this.interleaveSongs([
      neteaseSongsOrdered,
      qqSongs,
    ]);
    const songs = interleavedSongs;
    const infoMessages: string[] = [];
    if (infoMessage) {
      infoMessages.push(infoMessage);
    }

    if (songs.length === 0) {
      return {
        songs: [],
        warning: warnings[0] || '未能加载双平台我喜欢歌曲，请确认两个平台都已登录。',
      };
    }

    return {
      songs,
      warning: warnings.length > 0 ? warnings.join('；') : undefined,
      info: infoMessages.length > 0 ? infoMessages.join('；') : undefined,
    };
  }


  async likeSong(song: UnifiedSong, context: LibraryContext, like = true): Promise<LikeActionResult> {
    if (song.platform === 'netease') {
      const cookie = context.neteaseCookie?.trim();
      if (!cookie) {
        return {
          success: false,
          warning: '\u7f51\u6613\u4e91\u672a\u767b\u5f55\uff0c\u65e0\u6cd5\u64cd\u4f5c\u6211\u559c\u6b22\u3002',
        };
      }

      const endpoint = this.buildNeteaseUrl('/like', {
        id: song.originalId,
        like: like ? 'true' : 'false',
        timestamp: String(Date.now()),
      }, cookie);

      const response = await this.fetchJson<any>(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: this.buildNeteaseAuthHeaders(cookie),
      });

      if (response.ok && response.data && (response.data.code === 200 || response.data.code === 0)) {
        return { success: true };
      }

      return {
        success: false,
        warning: response.error || '\u7f51\u6613\u4e91\u6211\u559c\u6b22\u64cd\u4f5c\u5931\u8d25\u3002',
      };
    }

    if (song.platform === 'qq') {
      const cookie = context.qqCookie?.trim();
      if (!cookie) {
        return {
          success: false,
          warning: 'QQ \u97f3\u4e50\u672a\u767b\u5f55\uff0c\u65e0\u6cd5\u64cd\u4f5c\u6211\u559c\u6b22\u3002',
        };
      }

      const identity = this.resolveQQSongIdentity(song);
      if (!identity.songId) {
        return {
          success: false,
          warning: 'QQ \u97f3\u4e50\u8be5\u6b4c\u66f2\u7f3a\u5c11\u53ef\u7528\u6570\u5b57 ID\uff0c\u6682\u4e0d\u652f\u6301\u4e00\u952e\u7ea2\u5fc3\u3002',
        };
      }

      const endpoint = `${getQQApiBaseUrl()}/playlist/like?id=${encodeURIComponent(identity.songId)}&like=${like ? '1' : '0'}&timestamp=${Date.now()}`;
      const response = await this.fetchJson<any>(endpoint, {
        method: 'POST',
        headers: this.buildQQAuthHeaders(cookie),
        cache: 'no-store',
      });

      if (response.ok && response.data && response.data.code === 0) {
        const payload = response.data.data || {};
        const resolvedLiked = typeof payload.liked === 'boolean' ? payload.liked : null;
        const verified = payload.verified !== false;
        const verifyWarning = typeof payload.warning === 'string' ? payload.warning : '';

        if (resolvedLiked !== null && verified && resolvedLiked !== like) {
          return {
            success: false,
            warning: verifyWarning || 'QQ 喜欢状态校验失败，请稍后重试。',
          };
        }

        return {
          success: true,
          warning: !verified ? (verifyWarning || 'QQ 歌单状态同步中，请稍后刷新确认。') : undefined,
        };
      }

      return {
        success: false,
        warning: response.error || 'QQ \u97f3\u4e50\u6211\u559c\u6b22\u64cd\u4f5c\u5931\u8d25\u3002',
      };
    }

    return {
      success: false,
      warning: '\u6682\u4e0d\u652f\u6301\u8be5\u5e73\u53f0\u7684\u6211\u559c\u6b22\u64cd\u4f5c\u3002',
    };
  }


  async searchUnifiedSongs(keyword: string, context: LibraryContext, limit = 30): Promise<SearchResult> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return { songs: [], warnings: [] };
    }

    const connectedPlatformCount = Number(Boolean(context.neteaseCookie)) + Number(Boolean(context.qqCookie));
    const perPlatformLimit = Math.max(10, Math.ceil(limit / Math.max(connectedPlatformCount, 1)));

    const requests: Array<{
      platform: 'netease' | 'qq';
      task: Promise<{ platform: 'netease' | 'qq'; songs: UnifiedSong[]; warning?: string }>;
    }> = [];

    if (context.neteaseCookie) {
      requests.push({
        platform: 'netease',
        task: this.searchNeteaseSongs(normalizedKeyword, perPlatformLimit, context.neteaseCookie),
      });
    }

    if (context.qqCookie) {
      requests.push({
        platform: 'qq',
        task: this.searchQQSongs(normalizedKeyword, perPlatformLimit, context.qqCookie),
      });
    }

    if (requests.length === 0) {
      return {
        songs: [],
        warnings: ['请先登录至少一个平台后再搜索。'],
      };
    }

    const settled = await this.settlePlatformTasks(requests, 'search');
    const warnings = [...settled.warnings, ...settled.results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item))];
    const results = settled.results;

    const mergedSongs = results.flatMap((item) => item.songs);
    const rankedSongs = this.rankAndDedupeSongs(mergedSongs, normalizedKeyword);
    const dedupedCount = Math.max(0, mergedSongs.length - rankedSongs.length);
    if (dedupedCount > 0) {
      warnings.push(`已跨平台去重 ${dedupedCount} 首重复歌曲，优先保留音质更优版本。`);
    }
    const limitedSongs = rankedSongs.slice(0, limit);
    const songs = await this.attachLikedState(limitedSongs, context);

    return {
      songs,
      warnings,
    };
  }

  async loadDailyRecommendations(context: LibraryContext, limit = 30): Promise<DailyRecommendResult> {
    const requests: Array<{
      platform: 'netease' | 'qq';
      task: Promise<{ platform: 'netease' | 'qq'; songs: UnifiedSong[]; warning?: string }>;
    }> = [];

    if (context.neteaseCookie) {
      requests.push({
        platform: 'netease',
        task: this.fetchNeteaseDailyRecommendations(limit, context.neteaseCookie),
      });
    }

    // 诊断：打印 QQ cookie 状态，定位日推不加载的原因
    const qqCookiePreview = context.qqCookie
      ? `${context.qqCookie.slice(0, 40)}...(${context.qqCookie.length} chars)`
      : null;
    console.info('[ALLMusic][Daily] QQ cookie:', qqCookiePreview ?? 'NULL (QQ login missing or not loaded)');

    if (context.qqCookie) {
      requests.push({
        platform: 'qq',
        task: this.fetchQQDailyRecommendations(limit, context.qqCookie),
      });
    }

    if (requests.length === 0) {
      return {
        songs: [],
        warnings: ['请先登录至少一个平台后再加载推荐。'],
      };
    }

    const settled = await this.settlePlatformTasks(requests, 'daily');
    const warnings = [...settled.warnings, ...settled.results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item))];
    const results = settled.results;

    const interleaved = this.interleaveSongs(results.map((item) => item.songs));
    const songs = await this.attachLikedState(interleaved.slice(0, limit), context);
    return { songs, warnings };
  }

  async loadSongLyrics(song: UnifiedSong, context: LibraryContext): Promise<SongLyricResult> {
    const t0 = performance.now();

    if (song.platform === 'netease') {
      const result = await this.fetchNeteaseSongLyrics(song, context.neteaseCookie || undefined);
      console.info(`[ALLMusic][Lyric] netease done: ${(performance.now() - t0).toFixed(0)}ms`);
      return result;
    }

    if (song.platform === 'qq') {
      const result = await this.fetchQQSongLyrics(song, context.qqCookie || undefined);
      console.info(`[ALLMusic][Lyric] qq done: ${(performance.now() - t0).toFixed(0)}ms`);
      return result;
    }

    return {
      lyric: '',
      translatedLyric: '',
      warning: '暂不支持该平台歌词。',
    };
  }

  private async settlePlatformTasks<T extends { warning?: string }>(
    requests: Array<{ platform: 'netease' | 'qq'; task: Promise<T> }>,
    scene: 'playlists' | 'search' | 'daily',
  ): Promise<{ results: T[]; warnings: string[] }> {
    const settled = await Promise.allSettled(requests.map((item) => item.task));
    const results: T[] = [];
    const warnings: string[] = [];

    settled.forEach((item, index) => {
      const request = requests[index];
      if (item.status === 'fulfilled') {
        results.push(item.value);
        return;
      }

      warnings.push(
        this.buildSinglePlatformFallbackWarning(
          request.platform,
          scene,
          this.normalizeUnknownError(item.reason),
        ),
      );
    });

    return { results, warnings };
  }

  private buildSinglePlatformFallbackWarning(
    platform: 'netease' | 'qq',
    scene: 'playlists' | 'search' | 'daily',
    reason: string,
  ): string {
    const platformName = platform === 'netease' ? '网易云' : 'QQ 音乐';
    const sceneLabelMap: Record<'playlists' | 'search' | 'daily', string> = {
      playlists: '歌单',
      search: '搜索',
      daily: '推荐',
    };
    const sceneLabel = sceneLabelMap[scene];
    const normalizedReason = this.toText(reason);

    if (normalizedReason) {
      return `${platformName}${sceneLabel}暂时不可用，已自动降级为单平台模式（${normalizedReason}）。`;
    }
    return `${platformName}${sceneLabel}暂时不可用，已自动降级为单平台模式。`;
  }

  private async fetchNeteasePlaylists(
    userId: string | undefined,
    cookie: string,
  ): Promise<{ platform: 'netease'; playlists: UnifiedPlaylist[]; warning?: string }> {
    const resolvedUserId = await this.resolveNeteaseUserId(cookie, userId);
    if (!resolvedUserId) {
      return {
        platform: 'netease',
        playlists: [],
        warning: '网易云：无法解析用户 ID，请重新连接网易云后重试。',
      };
    }

    const endpoint = this.buildNeteaseUrl('/user/playlist', {
      uid: resolvedUserId,
      limit: '1000',
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return {
        platform: 'netease',
        playlists: [],
        warning: response.error || '\u7f51\u6613\u4e91\u6b4c\u5355\u52a0\u8f7d\u5931\u8d25\u3002',
      };
    }

    const rawPlaylists = Array.isArray(response.data.playlist) ? response.data.playlist : [];
    const playlists: UnifiedPlaylist[] = rawPlaylists
      .map((item: any) => this.mapNeteasePlaylist(item, resolvedUserId))
      .filter((item: UnifiedPlaylist | null): item is UnifiedPlaylist => Boolean(item));

    let likedPlaylist = playlists.find((item: UnifiedPlaylist) => item.type === 'liked');
    const officialLikedPlaylistId = await this.resolveNeteaseLikedPlaylistId(resolvedUserId, cookie, '');

    if (!likedPlaylist && officialLikedPlaylistId) {
      const matchedById = playlists.find((item) => item.originalId === officialLikedPlaylistId);
      if (matchedById) {
        matchedById.type = 'liked';
        likedPlaylist = matchedById;
      } else {
        const syntheticLiked: UnifiedPlaylist = {
          id: `netease_${officialLikedPlaylistId}`,
          platform: 'netease',
          originalId: officialLikedPlaylistId,
          type: 'liked',
          name: '我喜欢的音乐',
          coverUrl: playlists[0]?.coverUrl || DEFAULT_COVER,
          songCount: 0,
          creator: '网易云用户',
          description: '系统自动补全（接口未返回我喜欢歌单元数据）',
        };
        playlists.unshift(syntheticLiked);
        likedPlaylist = syntheticLiked;
      }
    }

    const likedIds = await this.fetchNeteaseLikedSongIds(resolvedUserId, cookie);
    if (!likedPlaylist && likedIds.length > 0) {
      const syntheticLiked: UnifiedPlaylist = {
        id: 'netease_0',
        platform: 'netease',
        originalId: '0',
        type: 'liked',
        name: '我喜欢的音乐',
        coverUrl: playlists[0]?.coverUrl || DEFAULT_COVER,
        songCount: likedIds.length,
        creator: '网易云用户',
        description: '系统自动补全（根据我喜欢歌曲列表生成）',
      };
      playlists.unshift(syntheticLiked);
      likedPlaylist = syntheticLiked;
    }

    if (likedPlaylist && likedPlaylist.songCount === 0 && likedIds.length > 0) {
      likedPlaylist.songCount = likedIds.length;
    }

    return { platform: 'netease', playlists };
  }


  private async fetchQQPlaylists(
    cookie: string,
    userId?: string,
  ): Promise<{ platform: 'qq'; playlists: UnifiedPlaylist[]; warning?: string }> {
    const inferredUserId = await this.resolveQQUserId(cookie, userId);

    const adapterParams = new URLSearchParams({ timestamp: String(Date.now()) });
    if (inferredUserId) {
      adapterParams.set('uin', inferredUserId);
    }

    const adapterEndpoint = `${getQQApiBaseUrl()}/playlist/user?${adapterParams.toString()}`;
    const adapterResponse = await this.fetchJson<any>(adapterEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (adapterResponse.ok && adapterResponse.data && adapterResponse.data.code === 0) {
      const rawPlaylists = Array.isArray(adapterResponse.data.data?.playlists)
        ? adapterResponse.data.data.playlists
        : Array.isArray(adapterResponse.data.playlists)
          ? adapterResponse.data.playlists
          : [];

      const playlists = rawPlaylists
        .map((item: any) => this.mapQQPlaylist(item))
        .filter((item: UnifiedPlaylist | null): item is UnifiedPlaylist => Boolean(item));

      return { platform: 'qq', playlists };
    }

    // adapter 请求失败 → 直接返回错误，不再尝试不存在的 legacy 端点
    return {
      platform: 'qq',
      playlists: [],
      warning: `QQ: ${
        adapterResponse.error
        || '\u672a\u80fd\u83b7\u53d6 QQ \u6b4c\u5355\uff0c\u8bf7\u786e\u8ba4 QQ \u767b\u5f55\u72b6\u6001\u53ca api \u670d\u52a1\u5df2\u542f\u52a8\u3002'
      }`,
    };
  }

  private async fetchNeteasePlaylistDetail(
    playlist: UnifiedPlaylist,
    cookie?: string,
    likedOrder: 'latest' | 'earliest' | 'api' = 'latest',
    forceRefreshWebOrder = false,
  ): Promise<PlaylistDetailResult> {
    let resolvedPlaylistId = this.normalizeNumericId(playlist.originalId);

    // NetEase likelist endpoint is unordered. For liked playlists, try webpage order first,
    // cache it once, then keep incremental updates by prepending newly liked songs.
    if (playlist.type === 'liked' && cookie) {
      const accountUserId = await this.resolveNeteaseUserId(cookie);
      console.info('[ALLMusic][Liked-Debug] resolveNeteaseUserId:', accountUserId || '(empty)');
      if (!accountUserId) {
        // resolveNeteaseUserId 返回空说明是匿名会话或 cookie 失效
        return {
          songs: [],
          warning: '网易云登录已过期，请重新登录后加载喜欢歌单。',
        };
      }
      if (accountUserId) {
        const officialLikedPlaylistId = await this.resolveNeteaseLikedPlaylistId(
          accountUserId,
          cookie,
          resolvedPlaylistId,
        );
        console.info('[ALLMusic][Liked-Debug] officialLikedPlaylistId:', officialLikedPlaylistId || '(empty)', 'originalId:', resolvedPlaylistId);
        if (officialLikedPlaylistId) {
          resolvedPlaylistId = officialLikedPlaylistId;
        }

        const neteaseOrder = await this.resolveNeteaseLikedOrderedIds({
          userId: accountUserId,
          cookie,
          fallbackPlaylistId: resolvedPlaylistId,
          likedOrder,
          forceRefreshWebOrder,
          includePlaylistHint: true,
        });
        console.info('[ALLMusic][Liked-Debug] orderedSongIds count:', neteaseOrder.orderedSongIds.length);

        if (neteaseOrder.orderedSongIds.length > 0) {
          const likedSongs = await this.fetchNeteaseSongsByIds(neteaseOrder.orderedSongIds, cookie);
          console.info('[ALLMusic][Liked-Debug] fetchNeteaseSongsByIds returned:', likedSongs.length);
          if (likedSongs.length > 0) {
            return {
              songs: likedSongs,
              info: neteaseOrder.info,
            };
          }
        }
      }
    }

    if (!resolvedPlaylistId) {
      console.warn('[ALLMusic][Liked-Debug] resolvedPlaylistId is empty, returning early');
      return {
        songs: [],
        warning: '网易云我喜欢歌单 ID 解析失败，请重新连接网易云后重试。',
      };
    }

    console.info('[ALLMusic][Liked-Debug] generic path with playlistId:', resolvedPlaylistId);
    const endpoint = this.buildNeteaseUrl('/playlist/track/all', {
      id: resolvedPlaylistId,
      limit: '500',
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });
    console.info('[ALLMusic][Liked-Debug] /playlist/track/all ok:', response.ok, 'code:', response.data?.code, 'songs:', Array.isArray(response.data?.songs) ? response.data.songs.length : 'n/a');

    if (response.ok && response.data && response.data.code === 200) {
      const rawSongs = Array.isArray(response.data.songs) ? response.data.songs : [];
      const songs = rawSongs
        .map((item: any) => this.mapNeteaseSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));
      if (songs.length > 0) {
        return { songs };
      }
    }

    const fallbackEndpoint = this.buildNeteaseUrl('/playlist/detail', {
      id: resolvedPlaylistId,
      timestamp: String(Date.now()),
    }, cookie);

    const fallbackResponse = await this.fetchJson<any>(fallbackEndpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (fallbackResponse.ok && fallbackResponse.data && fallbackResponse.data.code === 200) {
      const rawSongs = Array.isArray(fallbackResponse.data.playlist?.tracks)
        ? fallbackResponse.data.playlist.tracks
        : [];
      const songs = rawSongs
        .map((item: any) => this.mapNeteaseSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));
      if (songs.length > 0) {
        return { songs };
      }
    }

    return {
      songs: [],
      warning:
        response.error
        || fallbackResponse.error
        || '\u7f51\u6613\u4e91\u6b4c\u5355\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25\u3002',
    };
  }


  private async fetchQQPlaylistDetail(playlist: QQPlaylist, cookie?: string): Promise<PlaylistDetailResult> {
    const isLikedPlaylist = this.isQQLikedPlaylist(playlist);
    const primaryPlaylistId = (
      playlist.qqSonglistId
      || (isLikedPlaylist ? '201' : '')
      || playlist.originalId
      || playlist.qqDirId
    );

    if (!primaryPlaylistId) {
      return {
        songs: [],
        warning: '\u65e0\u6cd5\u8bc6\u522b QQ \u6b4c\u5355 ID\uff0c\u8bf7\u5237\u65b0\u6b4c\u5355\u540e\u91cd\u8bd5\u3002',
      };
    }

    const adapterParams = new URLSearchParams({
      id: primaryPlaylistId,
      limit: '500',
      timestamp: String(Date.now()),
    });

    if (isLikedPlaylist) {
      adapterParams.set('dirid', playlist.qqDirId || '201');
    } else if (playlist.qqDirId) {
      adapterParams.set('dirid', playlist.qqDirId);
    }

    const adapterEndpoint = `${getQQApiBaseUrl()}/playlist/detail?${adapterParams.toString()}`;
    const adapterResponse = await this.fetchJson<any>(adapterEndpoint, {
      headers: cookie ? this.buildQQAuthHeaders(cookie) : undefined,
      cache: 'no-store',
    });

    if (adapterResponse.ok && adapterResponse.data && adapterResponse.data.code === 0) {
      const rawSongs = Array.isArray(adapterResponse.data.data?.songs)
        ? adapterResponse.data.data.songs
        : Array.isArray(adapterResponse.data.songs)
          ? adapterResponse.data.songs
          : [];

      const songs = rawSongs
        .map((item: any) => this.mapQQSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));

      return { songs };
    }

    // adapter 请求失败 → 直接返回错误，不再尝试不存在的 /songlist 端点
    return {
      songs: [],
      warning:
        adapterResponse.error
        || '\u672a\u80fd\u83b7\u53d6 QQ \u6b4c\u5355\u8be6\u60c5\uff0c\u8bf7\u786e\u8ba4 QQ \u767b\u5f55\u72b6\u6001\u53ca api \u670d\u52a1\u5df2\u542f\u52a8\u3002',
    };
  }

  private async searchNeteaseSongs(
    keyword: string,
    limit: number,
    cookie: string,
  ): Promise<{ platform: 'netease'; songs: UnifiedSong[]; warning?: string }> {
    const endpoint = this.buildNeteaseUrl('/search', {
      keywords: keyword,
      type: '1',
      limit: String(limit),
      timestamp: String(Date.now()),
    });

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return {
        platform: 'netease',
        songs: [],
        warning: response.error || '\u7f51\u6613\u4e91\u641c\u7d22\u5931\u8d25\u3002',
      };
    }

    const rawSongs = Array.isArray(response.data.result?.songs) ? response.data.result.songs : [];
    const songs = rawSongs
      .map((item: any) => this.mapNeteaseSong(item))
      .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));

    return { platform: 'netease', songs };
  }

  private async searchQQSongs(
    keyword: string,
    limit: number,
    cookie: string,
  ): Promise<{ platform: 'qq'; songs: UnifiedSong[]; warning?: string }> {
    const adapterEndpoint = `${getQQApiBaseUrl()}/search/songs?keyword=${encodeURIComponent(keyword)}&limit=${limit}&timestamp=${Date.now()}`;
    const adapterResponse = await this.fetchJson<any>(adapterEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (adapterResponse.ok && adapterResponse.data && adapterResponse.data.code === 0) {
      const rawSongs = Array.isArray(adapterResponse.data.data?.songs)
        ? adapterResponse.data.data.songs
        : Array.isArray(adapterResponse.data.songs)
          ? adapterResponse.data.songs
          : [];

      const songs = rawSongs
        .map((item: any) => this.mapQQSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));

      return { platform: 'qq', songs };
    }

    // adapter 搜索失败 → 直接返回错误，不再尝试不存在的 /search 端点
    return {
      platform: 'qq',
      songs: [],
      warning:
        adapterResponse.error
        || 'QQ 搜索失败，请稍后重试。',
    };
  }

  private async fetchNeteaseDailyRecommendations(
    limit: number,
    cookie: string,
  ): Promise<{ platform: 'netease'; songs: UnifiedSong[]; warning?: string }> {
    const endpoint = this.buildNeteaseUrl('/recommend/songs', {
      limit: String(limit),
      timestamp: String(Date.now()),
    });

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return {
        platform: 'netease',
        songs: [],
        warning: response.error || '网易云日推加载失败。',
      };
    }

    const rawSongs = Array.isArray(response.data.data?.dailySongs)
      ? response.data.data.dailySongs
      : Array.isArray(response.data.recommend)
        ? response.data.recommend
        : [];
    const songs = rawSongs
      .map((item: any) => this.mapNeteaseSong(item))
      .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item))
      .slice(0, limit);

    return {
      platform: 'netease',
      songs,
      warning: songs.length === 0 ? '网易云日推暂无可用歌曲。' : undefined,
    };
  }

  private async fetchQQDailyRecommendations(
    limit: number,
    cookie: string,
  ): Promise<{ platform: 'qq'; songs: UnifiedSong[]; warning?: string }> {
    const endpoint = `${getQQApiBaseUrl()}/recommend/daily?limit=${Math.max(1, limit)}&timestamp=${Date.now()}`;
    const response = await this.fetchJson<any>(endpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (!response.ok || !response.data || response.data.code !== 0) {
      console.warn('[ALLMusic][QQ Daily] request failed:', response.error, 'endpoint:', endpoint);
      return {
        platform: 'qq',
        songs: [],
        warning: response.error || 'QQ 个性化日推加载失败。',
      };
    }

    const rawSongs = Array.isArray(response.data.data?.songs)
      ? response.data.data.songs
      : Array.isArray(response.data.songs)
        ? response.data.songs
        : [];
    const songs = rawSongs
      .map((item: any) => this.mapQQSong(item))
      .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item))
      .slice(0, limit);

    if (songs.length === 0 && rawSongs.length > 0) {
      console.warn(
        '[ALLMusic][QQ Daily] backend returned',
        rawSongs.length,
        'raw tracks but 0 survived mapQQSong. First raw track keys:',
        Object.keys(rawSongs[0]),
      );
    }

    return {
      platform: 'qq',
      songs,
      warning: songs.length === 0 ? 'QQ 个性化日推暂无可用歌曲。' : undefined,
    };
  }

  private async fetchNeteaseSongLyrics(song: UnifiedSong, cookie?: string): Promise<SongLyricResult> {
    const endpoint = this.buildNeteaseUrl('/lyric', {
      id: song.originalId,
      timestamp: String(Date.now()),
    });

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return {
        lyric: '',
        translatedLyric: '',
        warning: response.error || '网易云歌词加载失败。',
      };
    }

    const lyric = this.toText(response.data.lrc?.lyric);
    const translatedLyric = this.toText(response.data.tlyric?.lyric);
    return {
      lyric,
      translatedLyric,
      warning: !lyric && !translatedLyric ? '该歌曲暂无歌词。' : undefined,
    };
  }

  private async fetchQQSongLyrics(song: UnifiedSong, cookie?: string): Promise<SongLyricResult> {
    const identity = this.resolveQQSongIdentity(song);
    if (!identity.songId && !identity.songMid) {
      return {
        lyric: '',
        translatedLyric: '',
        warning: 'QQ 歌曲缺少可用 ID，无法加载歌词。',
      };
    }

    const params = new URLSearchParams({
      timestamp: String(Date.now()),
    });
    if (identity.songMid) {
      params.set('mid', identity.songMid);
    }
    if (identity.songId) {
      params.set('id', identity.songId);
    }

    const endpoint = `${getQQApiBaseUrl()}/song/lyric?${params.toString()}`;
    const response = await this.fetchJson<any>(endpoint, {
      headers: cookie ? this.buildQQAuthHeaders(cookie) : undefined,
      cache: 'no-store',
    });

    if (!response.ok || !response.data || response.data.code !== 0) {
      return {
        lyric: '',
        translatedLyric: '',
        warning: response.error || 'QQ 歌词加载失败。',
      };
    }

    const payload = response.data.data || response.data;
    const lyric = this.toText(payload?.lyric);
    const translatedLyric = this.toText(payload?.trans);
    return {
      lyric,
      translatedLyric,
      warning: !lyric && !translatedLyric ? '该歌曲暂无歌词。' : undefined,
    };
  }

  private mapNeteasePlaylist(raw: any, currentUserId: string): UnifiedPlaylist | null {
    const originalId = this.toText(raw?.id);
    if (!originalId) {
      return null;
    }

    const name = this.toText(raw?.name || raw?.playlistName) || '\u672a\u547d\u540d\u6b4c\u5355';
    const creatorName = this.toText(raw?.creator?.nickname || raw?.creator?.name || raw?.nickname) || '\u7f51\u6613\u4e91\u7528\u6237';
    const trackIdsLength = Array.isArray(raw?.trackIds) ? raw.trackIds.length : 0;
    const songCount = this.toNumber(
      raw?.trackCount
      ?? raw?.trackNumber
      ?? raw?.songCount
      ?? raw?.track_count
      ?? raw?.total_song_num
      ?? trackIdsLength,
    );

    return {
      id: `netease_${originalId}`,
      platform: 'netease',
      originalId,
      type: this.detectNeteasePlaylistType(raw, currentUserId),
      name,
      coverUrl: normalizeImageUrl(
        this.toText(raw?.coverImgUrl || raw?.coverUrl || raw?.cover) || DEFAULT_COVER,
      ),
      songCount,
      creator: creatorName,
      description: this.toText(raw?.description),
    };
  }


  private isQQLikedPlaylistByIds(
    qqDirId?: string,
    qqSonglistId?: string,
    originalId?: string,
  ): boolean {
    return qqDirId === '201' || qqSonglistId === '201' || originalId === '201';
  }

  private isQQLikedPlaylist(playlist: Pick<QQPlaylist, 'qqDirId' | 'qqSonglistId' | 'originalId' | 'type'>): boolean {
    if (this.isQQLikedPlaylistByIds(playlist.qqDirId, playlist.qqSonglistId, playlist.originalId)) {
      return true;
    }

    // Safe fallback for incomplete payloads.
    return playlist.type === 'liked' && !playlist.qqDirId && !playlist.qqSonglistId;
  }

  private mapQQPlaylist(raw: any): UnifiedPlaylist | null {
    const dirInfo = raw?.dirinfo || raw?.dirInfo || {};
    const creatorInfo = raw?.creator || {};

    const qqSonglistId = this.toText(
      raw?.songlistId
      || raw?.songlist_id
      || raw?.id
      || raw?.dirId
      || raw?.tid
      || raw?.dissid
      || raw?.disstid,
    );
    const qqDirId = this.toText(raw?.dirid || raw?.dirId || dirInfo?.dirid || dirInfo?.dirId);
    const originalId = qqSonglistId || qqDirId;

    if (!originalId) {
      return null;
    }

    const name = this.toText(
      raw?.name
      || raw?.diss_name
      || raw?.dissname
      || raw?.dirname
      || raw?.dirName
      || raw?.title
      || dirInfo?.dirname
      || dirInfo?.name,
    ) || '\u672a\u547d\u540d\u6b4c\u5355';

    const rawType = this.toText(raw?.type).toLowerCase();
    const isLikedPlaylist = this.isQQLikedPlaylistByIds(qqDirId || undefined, qqSonglistId || undefined, originalId || undefined);

    let playlistType: PlaylistType = 'created';
    if (isLikedPlaylist) {
      playlistType = 'liked';
    } else if (rawType === 'collected') {
      playlistType = 'collected';
    }

    const songCount = this.toNumber(
      raw?.songCount
      ?? raw?.song_num
      ?? raw?.songnum
      ?? raw?.songNum
      ?? raw?.song_count
      ?? raw?.total_song_num
      ?? raw?.total_song_count
      ?? raw?.trackCount
      ?? dirInfo?.song_num
      ?? dirInfo?.song_count
      ?? dirInfo?.total_song_num,
    );

    const creatorName = this.toText(
      raw?.creator_name
      || raw?.hostname
      || raw?.nick
      || (typeof raw?.creator === 'string' ? raw.creator : '')
      || creatorInfo?.name
      || creatorInfo?.nickname
      || creatorInfo?.creator_name,
    ) || 'QQ \u97f3\u4e50\u7528\u6237';

    const playlist: QQPlaylist = {
      id: `qq_${originalId}`,
      platform: 'qq',
      originalId,
      type: playlistType,
      name,
      coverUrl: normalizeImageUrl(
        this.toText(
          raw?.coverUrl
          || raw?.cover_url_big
          || raw?.cover_url_medium
          || raw?.cover_url
          || raw?.cover
          || raw?.bigpicUrl
          || raw?.picUrl
          || raw?.imgurl
          || raw?.logo
          || raw?.diss_cover
          || dirInfo?.cover_url
          || dirInfo?.coverurl,
        ) || DEFAULT_COVER,
      ),
      songCount,
      creator: creatorName,
      description: this.toText(raw?.description || raw?.desc || raw?.diss_desc || dirInfo?.desc),
      qqDirId: qqDirId || undefined,
      qqSonglistId: qqSonglistId || undefined,
    };

    return playlist;
  }


  private mapNeteaseSong(raw: any): UnifiedSong | null {
    const originalId = this.toText(raw?.id);
    if (!originalId) {
      return null;
    }

    const artists = Array.isArray(raw?.ar)
      ? raw.ar.map((artist: any) => this.toText(artist?.name)).filter(Boolean).join('/')
      : Array.isArray(raw?.artists)
        ? raw.artists.map((artist: any) => this.toText(artist?.name)).filter(Boolean).join('/')
        : this.toText(raw?.artist || raw?.singer);

    const albumName = this.toText(raw?.al?.name || raw?.album?.name || raw?.albumName || raw?.album);
    const duration = this.toNumber(raw?.dt ?? raw?.duration ?? raw?.interval);
    const coverUrl = normalizeImageUrl(
      this.toText(
        raw?.al?.picUrl
        || raw?.album?.picUrl
        || raw?.album?.blurPicUrl
        || raw?.picUrl
        || raw?.coverUrl,
      ) || DEFAULT_COVER,
    );
    const quality = this.detectNeteaseSongQuality(raw);
    const rawAddedAt = this.toNumber(raw?.addedAt ?? raw?.at);
    const addedAt = rawAddedAt > 0
      ? Math.round(rawAddedAt >= 10_000_000_000 ? rawAddedAt : rawAddedAt * 1000)
      : undefined;

    return {
      id: `netease_${originalId}`,
      platform: 'netease',
      originalId,
      name: this.toText(raw?.name) || '\u672a\u77e5\u6b4c\u66f2',
      artist: artists || '\u672a\u77e5\u6b4c\u624b',
      album: albumName || '\u672a\u77e5\u4e13\u8f91',
      duration,
      coverUrl,
      addedAt,
      quality,
    };
  }


  private mapQQSong(raw: any): UnifiedSong | null {
    const qqSongId = this.normalizeNumericId(this.toText(raw?.id || raw?.songid));
    const qqSongMid = this.toText(raw?.mid || raw?.songmid);
    const originalId = qqSongId || qqSongMid;
    if (!originalId) {
      return null;
    }

    const singers = Array.isArray(raw?.singer)
      ? raw.singer.map((item: any) => this.toText(item?.name)).filter(Boolean).join('/')
      : this.toText(raw?.artist || raw?.singername);

    const albumName = this.toText(raw?.album?.name || raw?.album || raw?.albumname);
    const albumMid = this.toText(raw?.album?.mid || raw?.albummid);
    const coverFromAlbumMid = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '';

    const interval = this.toNumber(raw?.interval);
    const quality = this.detectQQSongQuality(raw);
    const rawAddedAt = this.toNumber(
      raw?.addedAt
      ?? raw?.join_time
      ?? raw?.joinTime
      ?? raw?.add_time
      ?? raw?.addTime
      ?? raw?.addtime
      ?? raw?.ctime
      ?? raw?.create_time
      ?? raw?.createTime,
    );
    const addedAt = rawAddedAt > 0
      ? Math.round(rawAddedAt >= 10_000_000_000 ? rawAddedAt : rawAddedAt * 1000)
      : undefined;

    return {
      id: `qq_${originalId}`,
      platform: 'qq',
      originalId,
      qqSongId: qqSongId || undefined,
      qqSongMid: qqSongMid || undefined,
      name: this.toText(raw?.name || raw?.songname || raw?.title) || '未知歌曲',
      artist: singers || '未知歌手',
      album: albumName || '未知专辑',
      duration: interval > 0 ? interval * 1000 : this.toNumber(raw?.duration),
      coverUrl: normalizeImageUrl(
        this.toText(raw?.coverUrl || raw?.picurl || raw?.albumpic) || coverFromAlbumMid || DEFAULT_COVER,
      ),
      addedAt,
      quality,
    };
  }

  private detectNeteaseSongQuality(raw: any): UnifiedSong['quality'] | undefined {
    const maxBr = this.toNumber(
      raw?.privilege?.maxbr
      ?? raw?.maxBr
      ?? raw?.maxbr
      ?? raw?.hMusic?.bitrate
      ?? raw?.mMusic?.bitrate
      ?? raw?.lMusic?.bitrate,
    );

    if (raw?.hr?.br || maxBr >= 999000) {
      return 'hires';
    }
    if (raw?.sq?.br || maxBr >= 700000) {
      return 'flac';
    }
    if (raw?.h?.br || maxBr >= 320000) {
      return '320';
    }
    if (raw?.m?.br || raw?.l?.br || maxBr > 0) {
      return '128';
    }
    return undefined;
  }

  private detectQQSongQuality(raw: any): UnifiedSong['quality'] | undefined {
    const file = raw?.file || {};
    const hiResSize = this.toNumber(file?.size_hires || file?.size_hires_24bit || file?.size_new);
    const flacSize = this.toNumber(file?.size_flac || file?.flacsize || raw?.flacsize);
    const size320 = this.toNumber(
      file?.size_320mp3
      || file?.size_ogg_320
      || raw?.size320
      || raw?.size_320,
    );
    const size128 = this.toNumber(
      file?.size_128mp3
      || file?.size_128
      || raw?.size128
      || raw?.size_128,
    );

    if (hiResSize > 0) {
      return 'hires';
    }
    if (flacSize > 0 || this.toText(raw?.stream) === 'flac') {
      return 'flac';
    }
    if (size320 > 0) {
      return '320';
    }
    if (size128 > 0) {
      return '128';
    }
    return undefined;
  }


  private detectNeteasePlaylistType(raw: any, currentUserId: string): PlaylistType {
    const specialType = this.toNumber(raw?.specialType ?? raw?.special_type);
    if (specialType === 5) {
      return 'liked';
    }

    const normalizedCurrentUserId = this.normalizeNumericId(currentUserId);
    const creatorId = this.normalizeNumericId(this.toText(raw?.creator?.userId));
    if (creatorId && normalizedCurrentUserId && creatorId !== normalizedCurrentUserId) {
      return 'collected';
    }

    return 'created';
  }

  private rankAndDedupeSongs(songs: UnifiedSong[], keyword: string): UnifiedSong[] {
    if (songs.length <= 1) {
      return songs;
    }

    const deduped = new Map<string, { song: UnifiedSong; score: number; qualityScore: number; index: number }>();
    const normalizedKeyword = this.normalizeSearchText(keyword);

    songs.forEach((song, index) => {
      const score = this.computeSearchScore(song, normalizedKeyword);
      const qualityScore = this.resolveSongQualityScore(song);
      const normalizedName = this.normalizeSearchText(song.name);
      const normalizedArtist = this.normalizeSearchText(song.artist);
      const dedupeKey = normalizedName && normalizedArtist
        ? `${normalizedName}|${normalizedArtist}`
        : `${song.platform}|${song.id}`;
      const current = deduped.get(dedupeKey);
      if (!current) {
        deduped.set(dedupeKey, { song, score, qualityScore, index });
        return;
      }

      const shouldReplace = (
        score > current.score
        || (score === current.score && qualityScore > current.qualityScore)
        || (score === current.score && qualityScore === current.qualityScore && index < current.index)
      );
      if (shouldReplace) {
        deduped.set(dedupeKey, { song, score, qualityScore, index });
      }
    });

    return Array.from(deduped.values())
      .sort((a, b) => (b.score - a.score) || (b.qualityScore - a.qualityScore) || (a.index - b.index))
      .map((item) => item.song);
  }

  private resolveSongQualityScore(song: UnifiedSong): number {
    const qualityScoreMap: Record<NonNullable<UnifiedSong['quality']>, number> = {
      '128': 1,
      '320': 2,
      flac: 3,
      hires: 4,
    };
    const explicitQualityScore = song.quality ? qualityScoreMap[song.quality] || 0 : 0;
    if (explicitQualityScore > 0) {
      return explicitQualityScore * 10;
    }

    // Heuristic fallback: QQ search endpoint usually provides higher-quality candidates with cookie auth.
    return song.platform === 'qq' ? 15 : 10;
  }

  private computeSearchScore(song: UnifiedSong, normalizedKeyword: string): number {
    const normalizedName = this.normalizeSearchText(song.name);
    const normalizedArtist = this.normalizeSearchText(song.artist);
    const normalizedAlbum = this.normalizeSearchText(song.album);

    let score = 0;
    if (!normalizedKeyword) {
      return score;
    }

    if (normalizedName === normalizedKeyword) {
      score += 120;
    } else if (normalizedName.startsWith(normalizedKeyword)) {
      score += 90;
    } else if (normalizedName.includes(normalizedKeyword)) {
      score += 70;
    }

    if (normalizedArtist.includes(normalizedKeyword)) {
      score += 35;
    }

    if (normalizedAlbum.includes(normalizedKeyword)) {
      score += 20;
    }

    if (song.duration > 0) {
      score += 5;
    }

    return score;
  }

  private normalizeSearchText(input: string): string {
    return this.toText(input)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  private interleaveSongs(groups: UnifiedSong[][]): UnifiedSong[] {
    const list = groups.map((songs) => [...songs]);
    const merged: UnifiedSong[] = [];
    const seen = new Set<string>();

    while (list.some((songs) => songs.length > 0)) {
      for (const songs of list) {
        const next = songs.shift();
        if (!next || seen.has(next.id)) {
          continue;
        }
        seen.add(next.id);
        merged.push(next);
      }
    }

    return merged;
  }

  private applyAddedAtMap(songs: UnifiedSong[], trackAddedAtMap: Map<string, number>): UnifiedSong[] {
    if (trackAddedAtMap.size === 0) {
      return songs;
    }

    return songs.map((song) => {
      const mappedAddedAt = this.toNumber(trackAddedAtMap.get(song.originalId));
      if (mappedAddedAt <= 0) {
        return song;
      }
      return { ...song, addedAt: mappedAddedAt };
    });
  }

  private async fetchNeteaseTrackAddedAtMap(
    playlistId: string,
    cookie?: string,
  ): Promise<Map<string, number>> {
    if (!playlistId) {
      return new Map<string, number>();
    }

    const endpoint = this.buildNeteaseUrl('/playlist/detail', {
      id: playlistId,
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return new Map<string, number>();
    }

    const trackIds = Array.isArray(response.data.playlist?.trackIds)
      ? response.data.playlist.trackIds
      : [];
    const trackAddedAtMap = new Map<string, number>();

    for (const item of trackIds) {
      const trackId = this.toText(item?.id);
      const addedAt = this.toNumber(item?.at);
      if (!trackId || addedAt <= 0) {
        continue;
      }
      trackAddedAtMap.set(trackId, addedAt);
    }

    return trackAddedAtMap;
  }

  private async attachLikedState(songs: UnifiedSong[], context: LibraryContext): Promise<UnifiedSong[]> {
    if (songs.length === 0) {
      return songs;
    }

    const neteaseLikedSet = new Set<string>();
    const qqLikedSongIdSet = new Set<string>();
    const qqLikedSongMidSet = new Set<string>();
    const normalizedNeteaseCookie = context.neteaseCookie?.trim() || '';
    const normalizedQQCookie = context.qqCookie?.trim() || '';
    const now = Date.now();
    const canUseCache = Boolean(
      this.likedStateCache
      && this.likedStateCache.expiresAt > now
      && this.likedStateCache.neteaseCookie === normalizedNeteaseCookie
      && this.likedStateCache.qqCookie === normalizedQQCookie,
    );

    if (canUseCache && this.likedStateCache) {
      this.likedStateCache.neteaseLikedIds.forEach((id) => neteaseLikedSet.add(id));
      this.likedStateCache.qqLikedSongIds.forEach((id) => qqLikedSongIdSet.add(id));
      this.likedStateCache.qqLikedSongMids.forEach((mid) => qqLikedSongMidSet.add(mid));
    } else {
      const hasNeteaseSongs = songs.some((song) => song.platform === 'netease');
      if (hasNeteaseSongs && normalizedNeteaseCookie) {
        const neteaseUserId = await this.resolveNeteaseUserId(normalizedNeteaseCookie, context.neteaseUserId || undefined);
        if (neteaseUserId) {
          const likedIds = await this.fetchNeteaseLikedSongIds(neteaseUserId, normalizedNeteaseCookie);
          likedIds.forEach((id) => neteaseLikedSet.add(id));
        }
      }

      const hasQQSongs = songs.some((song) => song.platform === 'qq');
      if (hasQQSongs && normalizedQQCookie) {
        const likedLookup = await this.fetchQQLikedSongIds(normalizedQQCookie, context.qqUserId || undefined);
        likedLookup.songIds.forEach((songId) => qqLikedSongIdSet.add(songId));
        likedLookup.songMids.forEach((songMid) => qqLikedSongMidSet.add(songMid));
      }

      this.likedStateCache = {
        expiresAt: now + LIKED_STATE_CACHE_TTL_MS,
        neteaseCookie: normalizedNeteaseCookie,
        qqCookie: normalizedQQCookie,
        neteaseLikedIds: Array.from(neteaseLikedSet),
        qqLikedSongIds: Array.from(qqLikedSongIdSet),
        qqLikedSongMids: Array.from(qqLikedSongMidSet),
      };
    }

    return songs.map((song) => {
      if (song.platform === 'netease') {
        return {
          ...song,
          isLiked: neteaseLikedSet.has(song.originalId),
        };
      }

      if (song.platform === 'qq') {
        const identity = this.resolveQQSongIdentity(song);
        const isLikedById = Boolean(identity.songId) && qqLikedSongIdSet.has(identity.songId);
        const isLikedByMid = Boolean(identity.songMid) && qqLikedSongMidSet.has(identity.songMid);

        return {
          ...song,
          isLiked: isLikedById || isLikedByMid,
        };
      }

      return song;
    });
  }

  private async resolveNeteaseLikedPlaylistId(userId: string, cookie: string, fallbackPlaylistId: string): Promise<string> {
    const endpoint = this.buildNeteaseUrl('/user/playlist', {
      uid: userId,
      limit: '1000',
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return fallbackPlaylistId;
    }

    const rawPlaylists = Array.isArray(response.data.playlist) ? response.data.playlist : [];
    const officialLiked = rawPlaylists.find((item: any) => this.toNumber(item?.specialType) === 5);
    const officialLikedId = this.toText(officialLiked?.id);

    return officialLikedId || fallbackPlaylistId;
  }

  private async resolveNeteaseLikedOrderedIds(context: {
    userId: string;
    cookie: string;
    fallbackPlaylistId: string;
    likedOrder: 'latest' | 'earliest' | 'api';
    forceRefreshWebOrder: boolean;
    includePlaylistHint?: boolean;
  }): Promise<{ orderedSongIds: string[]; info?: string }> {
    const likedSongIds = this.normalizeNeteaseSongIds(
      await this.fetchNeteaseLikedSongIds(context.userId, context.cookie),
    );

    if (likedSongIds.length === 0) {
      return { orderedSongIds: [] };
    }

    const apiOrderedSongIds = context.likedOrder === 'latest'
      ? [...likedSongIds].reverse()
      : [...likedSongIds];

    if (context.likedOrder !== 'latest') {
      return { orderedSongIds: apiOrderedSongIds };
    }

    const officialLikedPlaylistId = await this.resolveNeteaseLikedPlaylistId(
      context.userId,
      context.cookie,
      context.fallbackPlaylistId,
    );

    if (!officialLikedPlaylistId) {
      return { orderedSongIds: apiOrderedSongIds };
    }

    const webOrderResolution = await this.resolveNeteaseLikedOrderFromWeb({
      userId: context.userId,
      playlistId: officialLikedPlaylistId,
      cookie: context.cookie,
      currentLikedIds: likedSongIds,
      forceRefreshWebOrder: context.forceRefreshWebOrder,
    });

    const info = context.forceRefreshWebOrder && webOrderResolution.message
      ? webOrderResolution.message
      : undefined;

    if (webOrderResolution.songIds.length > 0) {
      return {
        orderedSongIds: webOrderResolution.songIds,
        info,
      };
    }

    return {
      orderedSongIds: apiOrderedSongIds,
      info,
    };
  }

  private async resolveNeteaseLikedOrderFromWeb(context: {
    userId: string;
    playlistId: string;
    cookie: string;
    currentLikedIds: string[];
    forceRefreshWebOrder: boolean;
  }): Promise<NeteaseWebOrderResolution> {
    const normalizedCurrentLikedIds = this.normalizeNeteaseSongIds(context.currentLikedIds);
    if (normalizedCurrentLikedIds.length === 0) {
      return {
        songIds: [],
        source: 'none',
        message: context.forceRefreshWebOrder ? '当前歌单暂无歌曲，未执行网页重抓。' : undefined,
      };
    }

    if (!context.forceRefreshWebOrder) {
      const cachedOrder = this.readNeteaseWebOrderCache(context.userId, context.playlistId);
      if (cachedOrder.length > 0) {
        const mergedFromCache = this.mergeNeteaseOrderWithCurrent(cachedOrder, normalizedCurrentLikedIds, true);
        this.writeNeteaseWebOrderCache(context.userId, context.playlistId, mergedFromCache);
        return {
          songIds: mergedFromCache,
          source: 'cache',
        };
      }
    }

    const webOrderResult = await this.fetchNeteaseWebPlaylistOrder(context.playlistId, context.cookie);
    const webOrder = webOrderResult.songIds;

    if (webOrder.length === 0) {
      const fallbackCachedOrder = this.readNeteaseWebOrderCache(context.userId, context.playlistId);
      if (fallbackCachedOrder.length > 0) {
        const mergedFallback = this.mergeNeteaseOrderWithCurrent(fallbackCachedOrder, normalizedCurrentLikedIds, true);
        this.writeNeteaseWebOrderCache(context.userId, context.playlistId, mergedFallback);

        if (context.forceRefreshWebOrder) {
          const reason = webOrderResult.error ? `（${webOrderResult.error}）` : '';
          return {
            songIds: mergedFallback,
            source: 'cache_fallback',
            message: `网页顺序重抓失败，已回退到本地缓存顺序。${reason}`,
          };
        }

        return {
          songIds: mergedFallback,
          source: 'cache_fallback',
        };
      }

      if (context.forceRefreshWebOrder) {
        const reason = webOrderResult.error ? `（${webOrderResult.error}）` : '';
        return {
          songIds: [],
          source: 'none',
          message: `网页顺序重抓失败，且没有可用缓存，已回退到 API 顺序。${reason}`,
        };
      }

      return {
        songIds: [],
        source: 'none',
      };
    }

    const mergedFromWeb = this.mergeNeteaseOrderWithCurrent(webOrder, normalizedCurrentLikedIds, false);
    this.writeNeteaseWebOrderCache(context.userId, context.playlistId, mergedFromWeb);

    return {
      songIds: mergedFromWeb,
      source: 'web',
      message: context.forceRefreshWebOrder
        ? `网页顺序重抓成功，缓存已更新（抓取 ${mergedFromWeb.length} 首）。`
        : undefined,
    };
  }

  private async fetchNeteaseWebPlaylistOrder(playlistId: string, cookie: string): Promise<NeteaseWebOrderFetchResult> {
    if (!canUseTauriInvoke()) {
      return {
        songIds: [],
        error: '当前不在桌面模式，无法调用本地网页抓取命令。',
      };
    }

    try {
      const songIds = await invoke<string[]>('fetch_netease_playlist_order', {
        playlistId,
        cookie,
      });

      const normalized = this.normalizeNeteaseSongIds(songIds || []);
      if (normalized.length === 0) {
        return {
          songIds: [],
          error: '网页返回成功，但未解析到歌曲顺序。',
        };
      }

      return { songIds: normalized };
    } catch (error) {
      return {
        songIds: [],
        error: this.normalizeUnknownError(error),
      };
    }
  }

  private mergeNeteaseOrderWithCurrent(cachedOrder: string[], currentLikedIds: string[], prependMissing = true): string[] {
    const currentSet = new Set(currentLikedIds);
    const seen = new Set<string>();
    const persisted: string[] = [];

    for (const songId of cachedOrder) {
      if (!currentSet.has(songId) || seen.has(songId)) {
        continue;
      }

      seen.add(songId);
      persisted.push(songId);
    }

    const missingSongs: string[] = [];
    for (const songId of currentLikedIds) {
      if (seen.has(songId)) {
        continue;
      }

      seen.add(songId);
      missingSongs.push(songId);
    }

    return prependMissing ? [...missingSongs, ...persisted] : [...persisted, ...missingSongs];
  }

  private normalizeNeteaseSongIds(songIds: string[]): string[] {
    const deduped = new Set<string>();
    const normalized: string[] = [];

    for (const rawId of songIds) {
      const songId = this.normalizeNumericId(rawId);
      if (!songId || deduped.has(songId)) {
        continue;
      }

      deduped.add(songId);
      normalized.push(songId);
    }

    return normalized;
  }

  private buildNeteaseWebOrderCacheEntryKey(userId: string, playlistId: string): string {
    return `${this.normalizeNumericId(userId)}:${this.normalizeNumericId(playlistId)}`;
  }

  private readNeteaseWebOrderCache(userId: string, playlistId: string): string[] {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return [];
    }

    const cacheEntryKey = this.buildNeteaseWebOrderCacheEntryKey(userId, playlistId);
    if (!cacheEntryKey || cacheEntryKey === ':') {
      return [];
    }

    try {
      const rawCache = localStorage.getItem(NETEASE_WEB_ORDER_CACHE_KEY);
      if (!rawCache) {
        return [];
      }

      const parsed = JSON.parse(rawCache) as Record<string, unknown>;
      const cachedValue = parsed?.[cacheEntryKey];
      if (!Array.isArray(cachedValue)) {
        return [];
      }

      const normalized = cachedValue
        .map((item) => this.toText(item))
        .filter((item): item is string => Boolean(item));

      return this.normalizeNeteaseSongIds(normalized);
    } catch {
      return [];
    }
  }

  private writeNeteaseWebOrderCache(userId: string, playlistId: string, songIds: string[]): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }

    const cacheEntryKey = this.buildNeteaseWebOrderCacheEntryKey(userId, playlistId);
    if (!cacheEntryKey || cacheEntryKey === ':') {
      return;
    }

    const normalized = this.normalizeNeteaseSongIds(songIds).slice(0, NETEASE_WEB_ORDER_CACHE_LIMIT);
    if (normalized.length === 0) {
      return;
    }

    try {
      const rawCache = localStorage.getItem(NETEASE_WEB_ORDER_CACHE_KEY);
      const parsedCache = rawCache ? JSON.parse(rawCache) : {};
      const nextCache: Record<string, unknown> = (
        parsedCache && typeof parsedCache === 'object' && !Array.isArray(parsedCache)
      ) ? parsedCache as Record<string, unknown> : {};

      nextCache[cacheEntryKey] = normalized;
      localStorage.setItem(NETEASE_WEB_ORDER_CACHE_KEY, JSON.stringify(nextCache));
    } catch {
      // Ignore local cache write failures and keep runtime flow intact.
    }
  }

  private async resolveNeteaseUserId(cookie: string, currentUserId?: string): Promise<string> {
    const accountEndpoint = this.buildNeteaseUrl('/user/account', {
      timestamp: String(Date.now()),
    }, cookie);

    const accountResponse = await this.fetchJson<any>(accountEndpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    const hasMusicU = cookie?.includes('MUSIC_U') ?? false;
    const hasMusicUExact = /(?:^|;\s*)MUSIC_U=/.test(cookie ?? '');
    const cleanedCookie = LibraryService.cleanCookieString(cookie ?? '');
    const cleanedHasMusicU = /(?:^|;\s*)MUSIC_U=/.test(cleanedCookie);
    const semicolonSpaceCount = (cookie?.match(/; /g) || []).length;
    const semicolonNoSpaceCount = (cookie?.match(/;[^ ]/g) || []).length;
    const anonimousUser = accountResponse.data?.account?.anonimousUser;
    console.info('[ALLMusic][Liked-Debug] /user/account ok:', accountResponse.ok, 'code:', accountResponse.data?.code, 'profile.userId:', accountResponse.data?.profile?.userId, 'account.id:', accountResponse.data?.account?.id, 'anonimousUser:', anonimousUser, 'hasMusicU:', hasMusicU, 'hasMusicUExact:', hasMusicUExact, 'cleanedHasMusicU:', cleanedHasMusicU, 'cookieLen:', cookie?.length ?? 0, 'cleanedLen:', cleanedCookie.length, 'semicolonSpace:', semicolonSpaceCount, 'semicolonNoSpace:', semicolonNoSpaceCount, 'cleanedPreview:', cleanedCookie.slice(0, 300));
    // 详细诊断：打印顶层键和 profile/account 的所有字段名
    const topKeys = accountResponse.data ? Object.keys(accountResponse.data) : [];
    const profileKeys = accountResponse.data?.profile ? Object.keys(accountResponse.data.profile) : [];
    const accountKeys = accountResponse.data?.account ? Object.keys(accountResponse.data.account) : [];
    console.info('[ALLMusic][Liked-Debug] response topKeys:', topKeys, 'profileKeys:', profileKeys.slice(0, 20), 'accountKeys:', accountKeys.slice(0, 20));

    // 匿名会话（anonimousUser=true）即使有 account.id 也不是真实登录用户，
    // /likelist 和 /playlist/track/all 对匿名用户返回空结果。
    if (anonimousUser === true) {
      console.warn('[ALLMusic][Liked-Debug] 匿名会话，跳过喜欢歌单解析。请重新登录网易云。');
      return '';
    }

    const fromAccount = this.normalizeNumericId(this.toText(
      accountResponse.data?.profile?.userId
      ?? accountResponse.data?.account?.id
      ?? accountResponse.data?.account?.userId
      ?? accountResponse.data?.data?.profile?.userId
      ?? accountResponse.data?.data?.account?.id
      ?? accountResponse.data?.data?.account?.userId,
    ));
    if (fromAccount) {
      return fromAccount;
    }

    // Stored auth state can be stale or contain a non-account identifier.
    return this.normalizeNumericId(currentUserId);
  }

  private async fetchQQLikedSongs(cookie: string, userId?: string): Promise<PlaylistDetailResult> {
    const { playlists } = await this.fetchQQPlaylists(cookie, userId);
    const likedPlaylist = playlists.find((playlist) => this.isQQLikedPlaylist(playlist as QQPlaylist)) as QQPlaylist | undefined;

    const fallbackLikedPlaylist: QQPlaylist = {
      id: 'qq_201',
      platform: 'qq',
      originalId: '201',
      type: 'liked',
      name: 'QQ 我喜欢',
      coverUrl: DEFAULT_COVER,
      songCount: 0,
      creator: 'QQ 音乐用户',
      qqDirId: '201',
      qqSonglistId: '201',
    };

    return this.fetchQQPlaylistDetail(likedPlaylist || fallbackLikedPlaylist, cookie);
  }

  private async fetchQQLikedSongIds(cookie: string, userId?: string): Promise<{ songIds: string[]; songMids: string[] }> {
    const detail = await this.fetchQQLikedSongs(cookie, userId);
    if (detail.songs.length === 0) {
      return { songIds: [], songMids: [] };
    }

    const songIdSet = new Set<string>();
    const songMidSet = new Set<string>();

    for (const song of detail.songs) {
      const identity = this.resolveQQSongIdentity(song);
      if (identity.songId) {
        songIdSet.add(identity.songId);
      }
      if (identity.songMid) {
        songMidSet.add(identity.songMid);
      }
    }

    return {
      songIds: Array.from(songIdSet),
      songMids: Array.from(songMidSet),
    };
  }



  private async fetchNeteaseLikedSongIds(userId: string, cookie: string): Promise<string[]> {
    const endpoint = this.buildNeteaseUrl('/likelist', {
      uid: userId,
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
      headers: this.buildNeteaseAuthHeaders(cookie),
    });

    console.info('[ALLMusic][Liked-Debug] /likelist uid:', userId, 'ok:', response.ok, 'code:', response.data?.code, 'ids count:', Array.isArray(response.data?.ids) ? response.data.ids.length : 'n/a', 'cookieLen:', cookie?.length ?? 0);

    if (!response.ok || !response.data || response.data.code !== 200) {
      return [];
    }

    const rawIds = Array.isArray(response.data.ids) ? response.data.ids : [];
    return rawIds
      .map((item: unknown) => this.toText(item))
      .filter((item: string): item is string => Boolean(item));
  }

  private async fetchNeteaseSongsByIds(songIds: string[], cookie: string, maxCount = 1000): Promise<UnifiedSong[]> {
    const ids = songIds.slice(0, maxCount);
    if (ids.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    const batchSize = 100;
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }

    const songByOriginalId = new Map<string, UnifiedSong>();

    for (const batch of batches) {
      const endpoint = this.buildNeteaseUrl('/song/detail', {
        ids: batch.join(','),
        timestamp: String(Date.now()),
      }, cookie);

      const response = await this.fetchJson<any>(endpoint, {
        cache: 'no-store',
        headers: this.buildNeteaseAuthHeaders(cookie),
      });

      if (!response.ok || !response.data || response.data.code !== 200) {
        continue;
      }

      const rawSongs = Array.isArray(response.data.songs) ? response.data.songs : [];
      for (const item of rawSongs) {
        const mapped = this.mapNeteaseSong(item);
        if (!mapped || songByOriginalId.has(mapped.originalId)) {
          continue;
        }

        songByOriginalId.set(mapped.originalId, mapped);
      }
    }

    const orderedSongs: UnifiedSong[] = [];
    for (const id of ids) {
      const song = songByOriginalId.get(id);
      if (song) {
        orderedSongs.push(song);
      }
    }

    return orderedSongs;
  }

  private buildNeteaseUrl(path: string, params: Record<string, string>, cookie?: string): string {
    const searchParams = new URLSearchParams(params);
    const normalizedCookie = LibraryService.cleanCookieString(cookie || '');
    if (normalizedCookie) {
      searchParams.set('cookie', normalizedCookie);
    }
    return `${getNeteaseApiBaseUrl()}${path}?${searchParams.toString()}`;
  }

  private buildNeteaseAuthHeaders(cookie?: string): Record<string, string> {
    if (!cookie?.trim()) {
      return {};
    }
    return { Cookie: LibraryService.cleanCookieString(cookie) };
  }

  /**
   * 清洗 cookie 字符串：
   * 1. 移除 Set-Cookie 响应头属性（Max-Age, Expires, Path 等）
   * 2. 修复分隔符格式（;; → ; ）
   * 3. 去重（同名 cookie 只保留第一次出现）
   * NeteaseCloudMusicApi 的 cookie 解析器对格式敏感，重复条目会导致 MUSIC_U 解析失败。
   */
  private static cleanCookieString(raw: string): string {
    const SET_COOKIE_ATTRS = new Set([
      'max-age', 'expires', 'path', 'domain', 'httponly', 'secure',
      'samesite', 'comment', 'version', 'priority', 'partitioned',
    ]);

    const seen = new Set<string>();
    const kept: string[] = [];

    for (const part of raw.split(/;\s*/)) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      // 无等号的 flag 属性（HttpOnly, Secure）
      if (!trimmed.includes('=')) {
        if (!SET_COOKIE_ATTRS.has(trimmed.toLowerCase())) {
          kept.push(trimmed);
        }
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      const name = trimmed.slice(0, eqIdx).trim();
      if (SET_COOKIE_ATTRS.has(name.toLowerCase())) {
        continue;
      }
      // 去重：同名 cookie 只保留第一次出现
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      kept.push(trimmed);
    }

    return kept.join('; ');
  }

  private buildQQAuthHeaders(cookie?: string): Record<string, string> {
    if (!cookie?.trim()) {
      return {};
    }

    const bearerToken = `Bearer ${cookie.trim()}`;
    return {
      token: bearerToken,
      Authorization: bearerToken,
    };
  }

  private async resolveQQUserId(cookie: string, userId?: string): Promise<string> {
    const normalizedCookie = cookie.trim();
    if (
      this.qqUserIdCache
      && this.qqUserIdCache.cookie === normalizedCookie
      && this.qqUserIdCache.expiresAt > Date.now()
    ) {
      return this.qqUserIdCache.userId;
    }

    const fromCookie = this.extractQQUserIdFromCookie(cookie);
    if (fromCookie) {
      this.qqUserIdCache = {
        cookie: normalizedCookie,
        userId: fromCookie,
        expiresAt: Date.now() + QQ_USER_ID_CACHE_TTL_MS,
      };
      return fromCookie;
    }

    const statusEndpoint = `${getQQApiBaseUrl()}/connect/status?timestamp=${Date.now()}`;
    const statusResponse = await this.fetchJson<any>(statusEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (statusResponse.ok && statusResponse.data && statusResponse.data.code === 0) {
      const statusId = this.normalizeNumericId(
        this.toText(statusResponse.data.data?.id ?? statusResponse.data.id),
      );
      if (statusId) {
        this.qqUserIdCache = {
          cookie: normalizedCookie,
          userId: statusId,
          expiresAt: Date.now() + QQ_USER_ID_CACHE_TTL_MS,
        };
        return statusId;
      }
    }

    // Keep stored state as the final fallback only; stale state should not override live cookie/session.
    return this.normalizeNumericId(userId);
  }

  private normalizeNumericId(value: string | null | undefined): string {
    const text = (value || '').trim();
    return /^\d+$/.test(text) ? text : '';
  }

  private resolveQQSongIdentity(song: Pick<UnifiedSong, 'originalId' | 'qqSongId' | 'qqSongMid'>): { songId: string; songMid: string } {
    const originalId = this.toText(song.originalId);
    const songId = this.normalizeNumericId(song.qqSongId || originalId);

    let songMid = this.toText(song.qqSongMid);
    if (!songMid && originalId && !this.normalizeNumericId(originalId)) {
      songMid = originalId;
    }

    return { songId, songMid };
  }

  private extractQQUserIdFromCookie(cookie: string): string {
    const matchers = [
      /(?:^|;\s*)uin=o?(\d+)/i,
      /(?:^|;\s*)p_uin=o?(\d+)/i,
      /(?:^|;\s*)qqmusic_uin=(\d+)/i,
    ];

    for (const matcher of matchers) {
      const matched = cookie.match(matcher);
      if (matched?.[1]) {
        return matched[1];
      }
    }

    const trimmed = cookie.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const candidates = [parsed.musicid, parsed.str_musicid, parsed.uin, parsed.p_uin, parsed.qqmusic_uin];

        for (const candidate of candidates) {
          const digits = String(candidate ?? '').match(/(\d+)/)?.[1];
          if (digits) {
            return digits;
          }
        }
      } catch {
        // Ignore invalid JSON payloads.
      }
    }

    return '';
  }

  private normalizeUnknownError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.trim();
      return message || '未知错误';
    }

    if (typeof error === 'string') {
      return error.trim() || '未知错误';
    }

    return '未知错误';
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

  private toNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LIBRARY_REQUEST_TIMEOUT_MS);
    const requestLabel = this.describeRequestTarget(url);

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
          error: maybeMessage || `${requestLabel} 请求失败（HTTP ${response.status}）`,
        };
      }

      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      const isConnectionIssue = /failed to fetch|networkerror|err_connection_refused|fetch failed/i.test(message);
      return {
        ok: false,
        error: isAbort
          ? `${requestLabel} 请求超时（${Math.floor(LIBRARY_REQUEST_TIMEOUT_MS / 1000)}s），请检查本地 API 状态。`
          : (isConnectionIssue ? `${this.getConnectionIssueMessage()}（${requestLabel}）` : `${requestLabel} 请求异常：${message}`),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private describeRequestTarget(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.pathname || parsed.origin;
    } catch {
      return url;
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
}

export const libraryService = new LibraryService();
