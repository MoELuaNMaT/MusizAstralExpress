import type { UnifiedPlaylist, UnifiedSong, PlaylistType } from '@/types';
import { invoke } from '@tauri-apps/api/core';
import { getNeteaseApiBaseUrl, getQQApiBaseUrl } from '@/lib/api/endpoints';

const NETEASE_API_BASE_URL = getNeteaseApiBaseUrl();
const QQ_API_BASE_URL = getQQApiBaseUrl();
const DEFAULT_COVER = 'https://p.qlogo.cn/gh/0/0/100';
const NETEASE_WEB_ORDER_CACHE_KEY = 'allmusic_netease_web_order_cache_v1';
const NETEASE_WEB_ORDER_CACHE_LIMIT = 5000;

function canUseTauriInvoke(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof tauriInternals?.invoke === 'function';
}

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

class LibraryService {
  async loadUnifiedPlaylists(context: LibraryContext): Promise<PlaylistResult> {
    const requests: Array<Promise<{ platform: 'netease' | 'qq'; playlists: UnifiedPlaylist[]; warning?: string }>> = [];

    if (context.neteaseCookie) {
      requests.push(this.fetchNeteasePlaylists(context.neteaseUserId || undefined, context.neteaseCookie));
    }

    if (context.qqCookie) {
      requests.push(this.fetchQQPlaylists(context.qqCookie, context.qqUserId || undefined));
    }

    if (requests.length === 0) {
      return {
        playlists: [],
        warnings: ['未检测到可用登录状态，请先连接音乐平台。'],
      };
    }

    const results = await Promise.all(requests);
    const warnings = results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item));

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
        warning: '?????????????',
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
          neteaseSongsOrdered = neteaseDetail.songs.map((song) => ({ ...song, isLiked: true }));
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

    // Interleave NetEase/QQ liked songs to form a true mixed feed.
    const songs = this.interleaveSongs([
      neteaseSongsOrdered,
      qqSongs,
    ]);

    if (songs.length === 0) {
      return {
        songs: [],
        warning: warnings[0] || '未能加载双平台我喜欢歌曲，请确认两个平台都已登录。',
      };
    }

    return {
      songs,
      warning: warnings.length > 0 ? warnings.join('；') : undefined,
      info: infoMessage,
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

      const endpoint = `${QQ_API_BASE_URL}/playlist/like?id=${encodeURIComponent(identity.songId)}&like=${like ? '1' : '0'}&timestamp=${Date.now()}`;
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

    const requests: Array<Promise<{ platform: 'netease' | 'qq'; songs: UnifiedSong[]; warning?: string }>> = [];

    if (context.neteaseCookie) {
      requests.push(this.searchNeteaseSongs(normalizedKeyword, perPlatformLimit, context.neteaseCookie));
    }

    if (context.qqCookie) {
      requests.push(this.searchQQSongs(normalizedKeyword, perPlatformLimit, context.qqCookie));
    }

    if (requests.length === 0) {
      return {
        songs: [],
        warnings: ['请先登录至少一个平台后再搜索。'],
      };
    }

    const results = await Promise.all(requests);
    const warnings = results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item));

    const rankedResults = results.map((item) => ({
      ...item,
      songs: this.rankAndDedupeSongs(item.songs, normalizedKeyword),
    }));

    const interleaved = this.interleaveSongs(rankedResults.map((item) => item.songs));
    const limitedSongs = interleaved.slice(0, limit);
    const songs = await this.attachLikedState(limitedSongs, context);

    return {
      songs,
      warnings,
    };
  }

  async loadDailyRecommendations(context: LibraryContext, limit = 30): Promise<DailyRecommendResult> {
    const requests: Array<Promise<{ platform: 'netease' | 'qq'; songs: UnifiedSong[]; warning?: string }>> = [];

    if (context.neteaseCookie) {
      requests.push(this.fetchNeteaseDailyRecommendations(limit, context.neteaseCookie));
    }

    if (context.qqCookie) {
      requests.push(this.fetchQQDailyRecommendations(limit, context.qqCookie));
    }

    if (requests.length === 0) {
      return {
        songs: [],
        warnings: ['请先登录至少一个平台后再加载推荐。'],
      };
    }

    const results = await Promise.all(requests);
    const warnings = results
      .map((item) => item.warning)
      .filter((item): item is string => Boolean(item));

    const interleaved = this.interleaveSongs(results.map((item) => item.songs));
    const songs = await this.attachLikedState(interleaved.slice(0, limit), context);
    return { songs, warnings };
  }

  async loadSongLyrics(song: UnifiedSong, context: LibraryContext): Promise<SongLyricResult> {
    if (song.platform === 'netease') {
      return this.fetchNeteaseSongLyrics(song, context.neteaseCookie || undefined);
    }

    if (song.platform === 'qq') {
      return this.fetchQQSongLyrics(song, context.qqCookie || undefined);
    }

    return {
      lyric: '',
      translatedLyric: '',
      warning: '暂不支持该平台歌词。',
    };
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
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
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

    const adapterEndpoint = `${QQ_API_BASE_URL}/playlist/user?${adapterParams.toString()}`;
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

    if (!inferredUserId) {
      const missingUinMessage = this.normalizeQQMissingUinMessage(adapterResponse.error);
      return {
        platform: 'qq',
        playlists: [],
        warning: `QQ: ${missingUinMessage}`,
      };
    }

    const legacyEndpoint = `${QQ_API_BASE_URL}/user/songlist?id=${encodeURIComponent(inferredUserId)}&pageNo=1&pageSize=200&timestamp=${Date.now()}`;
    const legacyResponse = await this.fetchJson<any>(legacyEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (legacyResponse.ok && legacyResponse.data && legacyResponse.data.result === 100) {
      const rawPlaylists = Array.isArray(legacyResponse.data.data?.list)
        ? legacyResponse.data.data.list
        : [];

      const playlists = rawPlaylists
        .map((item: any) => this.mapQQPlaylist(item))
        .filter((item: UnifiedPlaylist | null): item is UnifiedPlaylist => Boolean(item));

      return { platform: 'qq', playlists };
    }

    return {
      platform: 'qq',
      playlists: [],
      warning: `QQ: ${
        this.normalizeQQMissingUinMessage(adapterResponse.error)
        || legacyResponse.error
        || '\u672a\u80fd\u83b7\u53d6 QQ \u6b4c\u5355\uff0c\u8bf7\u786e\u8ba4 api:qq \u670d\u52a1\u5df2\u542f\u52a8\u3002'
      }`,
    };
  }

  private async fetchNeteasePlaylistDetail(
    playlist: UnifiedPlaylist,
    cookie?: string,
    likedOrder: 'latest' | 'earliest' | 'api' = 'latest',
    forceRefreshWebOrder = false,
  ): Promise<PlaylistDetailResult> {
    // NetEase likelist endpoint is unordered. For liked playlists, try webpage order first,
    // cache it once, then keep incremental updates by prepending newly liked songs.
    if (playlist.type === 'liked' && cookie) {
      const accountUserId = await this.resolveNeteaseUserId(cookie);
      if (accountUserId) {
        const neteaseOrder = await this.resolveNeteaseLikedOrderedIds({
          userId: accountUserId,
          cookie,
          fallbackPlaylistId: playlist.originalId,
          likedOrder,
          forceRefreshWebOrder,
          includePlaylistHint: true,
        });

        if (neteaseOrder.orderedSongIds.length > 0) {
          const likedSongs = await this.fetchNeteaseSongsByIds(neteaseOrder.orderedSongIds, cookie);
          if (likedSongs.length > 0) {
            return {
              songs: likedSongs,
              info: neteaseOrder.info,
            };
          }
        }
      }
    }

    const endpoint = this.buildNeteaseUrl('/playlist/track/all', {
      id: playlist.originalId,
      limit: '500',
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
    });

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
      id: playlist.originalId,
      timestamp: String(Date.now()),
    }, cookie);

    const fallbackResponse = await this.fetchJson<any>(fallbackEndpoint, {
      cache: 'no-store',
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

    const adapterEndpoint = `${QQ_API_BASE_URL}/playlist/detail?${adapterParams.toString()}`;
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

    const legacyPlaylistId = playlist.qqSonglistId || playlist.originalId || playlist.qqDirId;
    if (!legacyPlaylistId) {
      return {
        songs: [],
        warning:
          adapterResponse.error
          || '\u65e0\u6cd5\u8bc6\u522b QQ \u6b4c\u5355 ID\uff0c\u8bf7\u5237\u65b0\u6b4c\u5355\u540e\u91cd\u8bd5\u3002',
      };
    }

    const legacyEndpoint = `${QQ_API_BASE_URL}/songlist?id=${encodeURIComponent(legacyPlaylistId)}&timestamp=${Date.now()}`;
    const legacyResponse = await this.fetchJson<any>(legacyEndpoint, {
      headers: cookie ? this.buildQQAuthHeaders(cookie) : undefined,
      cache: 'no-store',
    });

    if (legacyResponse.ok && legacyResponse.data && legacyResponse.data.result === 100) {
      const rawSongs = Array.isArray(legacyResponse.data.data?.songlist)
        ? legacyResponse.data.data.songlist
        : [];

      const songs = rawSongs
        .map((item: any) => this.mapQQSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));

      return { songs };
    }

    return {
      songs: [],
      warning:
        adapterResponse.error
        || legacyResponse.error
        || '\u672a\u80fd\u83b7\u53d6 QQ \u6b4c\u5355\u8be6\u60c5\uff0c\u8bf7\u91cd\u542f QQ API \u670d\u52a1\u540e\u91cd\u8bd5\u3002',
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
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
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
    const adapterEndpoint = `${QQ_API_BASE_URL}/search/songs?keyword=${encodeURIComponent(keyword)}&limit=${limit}&timestamp=${Date.now()}`;
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

    const legacyEndpoint = `${QQ_API_BASE_URL}/search?key=${encodeURIComponent(keyword)}&t=0&pageNo=1&pageSize=${limit}&timestamp=${Date.now()}`;
    const legacyResponse = await this.fetchJson<any>(legacyEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (legacyResponse.ok && legacyResponse.data && legacyResponse.data.result === 100) {
      const rawSongs = Array.isArray(legacyResponse.data.data?.list)
        ? legacyResponse.data.data.list
        : [];

      const songs = rawSongs
        .map((item: any) => this.mapQQSong(item))
        .filter((item: UnifiedSong | null): item is UnifiedSong => Boolean(item));

      return { platform: 'qq', songs };
    }

    return {
      platform: 'qq',
      songs: [],
      warning:
        adapterResponse.error
        || legacyResponse.error
        || 'QQ \u641c\u7d22\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
    };
  }

  private async fetchNeteaseDailyRecommendations(
    limit: number,
    cookie: string,
  ): Promise<{ platform: 'netease'; songs: UnifiedSong[]; warning?: string }> {
    const endpoint = this.buildNeteaseUrl('/recommend/songs', {
      limit: String(limit),
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
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
    const endpoint = `${QQ_API_BASE_URL}/recommend/daily?limit=${Math.max(1, limit)}&timestamp=${Date.now()}`;
    const response = await this.fetchJson<any>(endpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (!response.ok || !response.data || response.data.code !== 0) {
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
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
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

    const endpoint = `${QQ_API_BASE_URL}/song/lyric?${params.toString()}`;
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
      coverUrl: this.toText(raw?.coverImgUrl || raw?.coverUrl || raw?.cover) || DEFAULT_COVER,
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
      coverUrl: this.toText(
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
    const coverUrl = this.toText(
      raw?.al?.picUrl
      || raw?.album?.picUrl
      || raw?.album?.blurPicUrl
      || raw?.picUrl
      || raw?.coverUrl,
    ) || DEFAULT_COVER;

    return {
      id: `netease_${originalId}`,
      platform: 'netease',
      originalId,
      name: this.toText(raw?.name) || '\u672a\u77e5\u6b4c\u66f2',
      artist: artists || '\u672a\u77e5\u6b4c\u624b',
      album: albumName || '\u672a\u77e5\u4e13\u8f91',
      duration,
      coverUrl,
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

    return {
      id: `qq_${originalId}`,
      platform: 'qq',
      originalId,
      qqSongId: qqSongId || undefined,
      qqSongMid: qqSongMid || undefined,
      name: this.toText(raw?.name || raw?.songname || raw?.title) || '????',
      artist: singers || '????',
      album: albumName || '????',
      duration: interval > 0 ? interval * 1000 : this.toNumber(raw?.duration),
      coverUrl: this.toText(raw?.coverUrl || raw?.picurl || raw?.albumpic) || coverFromAlbumMid || DEFAULT_COVER,
    };
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

    const deduped = new Map<string, { song: UnifiedSong; score: number; index: number }>();
    const normalizedKeyword = this.normalizeSearchText(keyword);

    songs.forEach((song, index) => {
      const score = this.computeSearchScore(song, normalizedKeyword);
      const dedupeKey = `${song.platform}|${this.normalizeSearchText(song.name)}|${this.normalizeSearchText(song.artist)}`;
      const current = deduped.get(dedupeKey);
      if (!current || score > current.score) {
        deduped.set(dedupeKey, { song, score, index });
      }
    });

    return Array.from(deduped.values())
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map((item) => item.song);
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

  private async attachLikedState(songs: UnifiedSong[], context: LibraryContext): Promise<UnifiedSong[]> {
    if (songs.length === 0) {
      return songs;
    }

    const neteaseLikedSet = new Set<string>();
    const qqLikedSongIdSet = new Set<string>();
    const qqLikedSongMidSet = new Set<string>();

    const hasNeteaseSongs = songs.some((song) => song.platform === 'netease');
    if (hasNeteaseSongs && context.neteaseCookie) {
      const neteaseUserId = await this.resolveNeteaseUserId(context.neteaseCookie, context.neteaseUserId || undefined);
      if (neteaseUserId) {
        const likedIds = await this.fetchNeteaseLikedSongIds(neteaseUserId, context.neteaseCookie);
        likedIds.forEach((id) => neteaseLikedSet.add(id));
      }
    }

    const hasQQSongs = songs.some((song) => song.platform === 'qq');
    if (hasQQSongs && context.qqCookie) {
      const likedLookup = await this.fetchQQLikedSongIds(context.qqCookie, context.qqUserId || undefined);
      likedLookup.songIds.forEach((songId) => qqLikedSongIdSet.add(songId));
      likedLookup.songMids.forEach((songMid) => qqLikedSongMidSet.add(songMid));
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
      timestamp: String(Date.now()),
    }, cookie);

    const response = await this.fetchJson<any>(endpoint, {
      cache: 'no-store',
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
    const fromState = this.normalizeNumericId(currentUserId);
    if (fromState) {
      return fromState;
    }

    const accountEndpoint = this.buildNeteaseUrl('/user/account', {
      timestamp: String(Date.now()),
    }, cookie);

    const accountResponse = await this.fetchJson<any>(accountEndpoint, {
      cache: 'no-store',
    });

    return this.normalizeNumericId(this.toText(
      accountResponse.data?.profile?.userId
      ?? accountResponse.data?.account?.id
      ?? accountResponse.data?.account?.userId,
    ));
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
    });

    if (!response.ok || !response.data || response.data.code !== 200) {
      return [];
    }

    const rawIds = Array.isArray(response.data.ids) ? response.data.ids : [];
    return rawIds
      .map((item: unknown) => this.toText(item))
      .filter((item: string): item is string => Boolean(item));
  }

  private async fetchNeteaseSongsByIds(songIds: string[], cookie: string, maxCount = 500): Promise<UnifiedSong[]> {
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
    if (cookie?.trim()) {
      searchParams.set('cookie', cookie.trim());
    }
    return `${NETEASE_API_BASE_URL}${path}?${searchParams.toString()}`;
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
    const fromCookie = this.extractQQUserIdFromCookie(cookie);
    if (fromCookie) {
      return fromCookie;
    }

    const statusEndpoint = `${QQ_API_BASE_URL}/connect/status?timestamp=${Date.now()}`;
    const statusResponse = await this.fetchJson<any>(statusEndpoint, {
      headers: this.buildQQAuthHeaders(cookie),
      cache: 'no-store',
    });

    if (statusResponse.ok && statusResponse.data && statusResponse.data.code === 0) {
      const statusId = this.normalizeNumericId(
        this.toText(statusResponse.data.data?.id ?? statusResponse.data.id),
      );
      if (statusId) {
        return statusId;
      }
    }

    // Keep stored state as the final fallback only; stale state should not override live cookie/session.
    return this.normalizeNumericId(userId);
  }

  private normalizeQQMissingUinMessage(message?: string): string {
    if (!message) {
      return '\u65e0\u6cd5\u89e3\u6790 QQ \u7528\u6237 ID\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55 QQ \u97f3\u4e50\u540e\u91cd\u8bd5\u3002';
    }

    if (message.toLowerCase().includes('missing uin')) {
      return '\u7f3a\u5c11 QQ \u7528\u6237 ID\uff08uin\uff09\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55 QQ \u97f3\u4e50\u3002';
    }

    return message;
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
        error: isConnectionIssue
          ? '本地 API 服务未启动或端口不可达。'
          : message,
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
}

export const libraryService = new LibraryService();
