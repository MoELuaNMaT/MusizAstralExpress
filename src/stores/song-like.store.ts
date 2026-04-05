import { create } from 'zustand';
import type { UnifiedSong } from '@/types';
import { getSongLikeKey } from '@/utils/home.utils';

type SongLikeRef = Pick<UnifiedSong, 'platform' | 'originalId' | 'qqSongId' | 'qqSongMid' | 'isLiked'>;

type SongLikeKeyInput = SongLikeRef | string;

interface SongLikeState {
  likedByKey: Record<string, boolean>;
  pendingByKey: Record<string, boolean>;
  setLiked: (songOrKey: SongLikeKeyInput, isLiked: boolean) => void;
  setPending: (songOrKey: SongLikeKeyInput, pending: boolean) => void;
  resolveLiked: (song: SongLikeRef) => boolean;
  reset: () => void;
}

const initialState: Pick<SongLikeState, 'likedByKey' | 'pendingByKey'> = {
  likedByKey: {},
  pendingByKey: {},
};

function resolveLikeKey(songOrKey: SongLikeKeyInput): string {
  return typeof songOrKey === 'string' ? songOrKey : getSongLikeKey(songOrKey);
}

export const useSongLikeStore = create<SongLikeState>()((set, get) => ({
  ...initialState,

  setLiked: (songOrKey, isLiked) =>
    set((state) => {
      const key = resolveLikeKey(songOrKey);
      if (state.likedByKey[key] === isLiked) {
        return state;
      }
      return {
        likedByKey: {
          ...state.likedByKey,
          [key]: isLiked,
        },
      };
    }),

  setPending: (songOrKey, pending) =>
    set((state) => {
      const key = resolveLikeKey(songOrKey);

      if (!pending) {
        if (!state.pendingByKey[key]) {
          return state;
        }
        const nextPendingByKey = { ...state.pendingByKey };
        delete nextPendingByKey[key];
        return {
          pendingByKey: nextPendingByKey,
        };
      }

      if (state.pendingByKey[key]) {
        return state;
      }

      return {
        pendingByKey: {
          ...state.pendingByKey,
          [key]: true,
        },
      };
    }),

  resolveLiked: (song) => {
    const key = resolveLikeKey(song);
    const override = get().likedByKey[key];
    if (typeof override === 'boolean') {
      return override;
    }
    return Boolean(song.isLiked);
  },

  reset: () => set(initialState),
}));
