import type { UnifiedPlaylist, UnifiedSong, UnifiedUser } from '@/types';
import { genericNicknamePatterns, type NeteaseLikedOrder } from '@/constants/home.constants';

export function collectLoadedPlaylistPlatforms(playlists: UnifiedPlaylist[]): Set<'netease' | 'qq'> {
  const platforms = new Set<'netease' | 'qq'>();
  playlists.forEach((playlist) => {
    if (playlist.platform === 'netease' || playlist.platform === 'qq') {
      platforms.add(playlist.platform);
    }
  });
  return platforms;
}

export const isNumericId = (value: string): boolean => /^\d+$/.test(value.trim());

const isNicknameLikelyHuman = (nickname: string): boolean => {
  const trimmed = nickname.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\d{5,}$/.test(trimmed)) {
    return false;
  }
  return !genericNicknamePatterns.some((pattern) => pattern.test(trimmed));
};

export const resolveDisplayNickname = (user: UnifiedUser | null): string => {
  if (!user) {
    return '';
  }

  const nickname = (user.nickname || '').trim();
  if (isNicknameLikelyHuman(nickname)) {
    return nickname;
  }

  const userId = (user.userId || '').trim();
  if (userId) {
    return `用户${userId.slice(-4)}`;
  }

  return nickname || '已登录用户';
};

export const isNeteaseLikedOrder = (value: string | null): value is NeteaseLikedOrder => (
  value === 'latest' || value === 'earliest' || value === 'api'
);

export const resolveQQSongIdentity = (song: Pick<UnifiedSong, 'originalId' | 'qqSongId' | 'qqSongMid'>): { songId: string; songMid: string } => {
  const originalId = song.originalId.trim();
  const songId = (song.qqSongId || '').trim() || (isNumericId(originalId) ? originalId : '');
  const songMid = (song.qqSongMid || '').trim() || (!isNumericId(originalId) ? originalId : '');
  return { songId, songMid };
};

export const getSongLikeKey = (song: Pick<UnifiedSong, 'platform' | 'originalId' | 'qqSongId' | 'qqSongMid'>): string => {
  if (song.platform !== 'qq') {
    return `${song.platform}:${song.originalId}`;
  }

  const identity = resolveQQSongIdentity(song);
  if (identity.songId) {
    return `qq:id:${identity.songId}`;
  }
  if (identity.songMid) {
    return `qq:mid:${identity.songMid}`;
  }
  return `qq:raw:${song.originalId}`;
};
