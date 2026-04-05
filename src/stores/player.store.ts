import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { UnifiedSong, PlayMode, PreferredQuality, PlayerState } from '@/types';
import { getSongLikeKey } from '@/utils/home.utils';

interface PlayerActions {
  setCurrentSong: (song: UnifiedSong | null) => void;
  setQueue: (songs: UnifiedSong[], startIndex?: number) => void;
  addToQueue: (songs: UnifiedSong[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  playAt: (index: number) => void;
  playNext: () => void;
  playPrevious: () => void;
  togglePlay: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setPlayMode: (mode: PlayMode) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (isMuted: boolean) => void;
  toggleMute: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setPreferredQuality: (quality: PreferredQuality) => void;
  updateCurrentSongLiked: (isLiked: boolean) => void;
  updateSongLikedByKey: (
    song: Pick<UnifiedSong, 'platform' | 'originalId' | 'qqSongId' | 'qqSongMid'>,
    isLiked: boolean,
  ) => void;
  pushHistory: (song: UnifiedSong) => void;
  clearHistory: () => void;
  reset: () => void;
}

const initialState: PlayerState = {
  currentSong: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  playMode: 'sequential',
  volume: 0.8,
  currentTime: 0,
  duration: 0,
  isLoading: false,
  error: null,
  preferredQuality: '320',
  history: [],
  isMuted: false,
};

const PLAYER_STORE_KEY = 'allmusic_player_v1';

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function resolvePlayerStorage(): StateStorage {
  if (typeof window === 'undefined') {
    return noopStorage;
  }
  return window.localStorage;
}

function clampQueueIndex(queue: UnifiedSong[], index: number): number {
  if (queue.length === 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= queue.length) {
    return queue.length - 1;
  }

  return index;
}

function randomNextIndex(currentIndex: number, queueLength: number): number {
  if (queueLength <= 1) {
    return Math.max(0, currentIndex);
  }
  const offset = 1 + Math.floor(Math.random() * (queueLength - 1));
  return (currentIndex + offset) % queueLength;
}

function patchSongsLikedByKey(
  songs: UnifiedSong[],
  likeKey: string,
  isLiked: boolean,
): { songs: UnifiedSong[]; changed: boolean } {
  let changed = false;
  const nextSongs = songs.map((song) => {
    if (getSongLikeKey(song) !== likeKey || Boolean(song.isLiked) === isLiked) {
      return song;
    }
    changed = true;
    return { ...song, isLiked };
  });

  return {
    songs: changed ? nextSongs : songs,
    changed,
  };
}

/**
 * Player store
 */
export const usePlayerStore = create<PlayerState & PlayerActions>()(persist((set) => ({
  ...initialState,

  setCurrentSong: (song) =>
    set((state) => ({
      currentSong: song,
      currentIndex: song ? state.queue.findIndex((item) => item.id === song.id) : -1,
      currentTime: 0,
      duration: 0,
      error: null,
    })),

  setQueue: (songs, startIndex = 0) =>
    set(() => {
      const safeIndex = clampQueueIndex(songs, startIndex);
      return {
        queue: songs,
        currentIndex: safeIndex,
        currentSong: safeIndex >= 0 ? songs[safeIndex] : null,
        currentTime: 0,
        duration: 0,
        isLoading: false,
        error: null,
      };
    }),

  addToQueue: (songs) =>
    set((state) => ({
      queue: [...state.queue, ...songs],
    })),

  removeFromQueue: (index) =>
    set((state) => {
      if (index < 0 || index >= state.queue.length) {
        return state;
      }

      const newQueue = state.queue.filter((_, i) => i !== index);
      if (newQueue.length === 0) {
        return {
          queue: [],
          currentIndex: -1,
          currentSong: null,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          isLoading: false,
        };
      }

      let newIndex = state.currentIndex;
      if (index < state.currentIndex) {
        newIndex = state.currentIndex - 1;
      } else if (index === state.currentIndex) {
        newIndex = Math.min(state.currentIndex, newQueue.length - 1);
      }

      const safeIndex = clampQueueIndex(newQueue, newIndex);
      return {
        queue: newQueue,
        currentIndex: safeIndex,
        currentSong: safeIndex >= 0 ? newQueue[safeIndex] : null,
        currentTime: index === state.currentIndex ? 0 : state.currentTime,
        duration: index === state.currentIndex ? 0 : state.duration,
        error: null,
      };
    }),

  clearQueue: () =>
    set({
      queue: [],
      currentIndex: -1,
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isLoading: false,
      error: null,
    }),

  playAt: (index) =>
    set((state) => {
      if (index < 0 || index >= state.queue.length) {
        return state;
      }
      return {
        currentIndex: index,
        currentSong: state.queue[index],
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        error: null,
      };
    }),

  playNext: () =>
    set((state) => {
      if (state.queue.length === 0) {
        return state;
      }

      let nextIndex = state.currentIndex + 1;

      switch (state.playMode) {
        case 'loop':
          if (nextIndex >= state.queue.length) {
            nextIndex = 0;
          }
          break;
        case 'shuffle':
          nextIndex = randomNextIndex(state.currentIndex, state.queue.length);
          break;
        case 'loop-one':
          nextIndex = state.currentIndex;
          break;
        case 'sequential':
        default:
          if (nextIndex >= state.queue.length) {
            return { ...state, isPlaying: false, isLoading: false };
          }
          break;
      }

      return {
        currentIndex: nextIndex,
        currentSong: state.queue[nextIndex],
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        isLoading: false,
        error: null,
      };
    }),

  playPrevious: () =>
    set((state) => {
      if (state.queue.length === 0) {
        return state;
      }

      let prevIndex = state.currentIndex - 1;

      if (state.playMode === 'loop' && prevIndex < 0) {
        prevIndex = state.queue.length - 1;
      } else if (state.playMode === 'shuffle') {
        prevIndex = randomNextIndex(state.currentIndex, state.queue.length);
      } else if (state.playMode === 'loop-one') {
        prevIndex = state.currentIndex;
      } else if (prevIndex < 0) {
        prevIndex = 0;
      }

      return {
        currentIndex: prevIndex,
        currentSong: state.queue[prevIndex],
        isPlaying: true,
        currentTime: 0,
        duration: 0,
        isLoading: false,
        error: null,
      };
    }),

  togglePlay: () =>
    set((state) => ({ isPlaying: !state.isPlaying })),

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setPlayMode: (mode) => set({ playMode: mode }),

  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),

  setIsMuted: (isMuted) => set({ isMuted }),

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),

  setDuration: (duration) => set({ duration: Math.max(0, duration) }),

  setIsLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setPreferredQuality: (quality) => set({ preferredQuality: quality }),

  updateCurrentSongLiked: (isLiked) =>
    set((state) => {
      if (!state.currentSong) {
        return state;
      }

      const likeKey = getSongLikeKey(state.currentSong);
      const nextCurrentSong = Boolean(state.currentSong.isLiked) === isLiked
        ? state.currentSong
        : { ...state.currentSong, isLiked };
      const queuePatch = patchSongsLikedByKey(state.queue, likeKey, isLiked);
      const historyPatch = patchSongsLikedByKey(state.history, likeKey, isLiked);

      if (!queuePatch.changed && !historyPatch.changed && nextCurrentSong === state.currentSong) {
        return state;
      }

      return {
        currentSong: nextCurrentSong,
        queue: queuePatch.songs,
        history: historyPatch.songs,
      };
    }),

  updateSongLikedByKey: (song, isLiked) =>
    set((state) => {
      const likeKey = getSongLikeKey(song);
      const queuePatch = patchSongsLikedByKey(state.queue, likeKey, isLiked);
      const historyPatch = patchSongsLikedByKey(state.history, likeKey, isLiked);

      const nextCurrentSong = state.currentSong
        && getSongLikeKey(state.currentSong) === likeKey
        && Boolean(state.currentSong.isLiked) !== isLiked
        ? { ...state.currentSong, isLiked }
        : state.currentSong;

      if (!queuePatch.changed && !historyPatch.changed && nextCurrentSong === state.currentSong) {
        return state;
      }

      return {
        currentSong: nextCurrentSong,
        queue: queuePatch.songs,
        history: historyPatch.songs,
      };
    }),

  pushHistory: (song) =>
    set((state) => ({
      history: [song, ...state.history.filter((item) => item.id !== song.id)].slice(0, 100),
    })),

  clearHistory: () => set({ history: [] }),

  reset: () => set(initialState),
}), {
  name: PLAYER_STORE_KEY,
  storage: createJSONStorage(resolvePlayerStorage),
  partialize: (state) => ({
    queue: state.queue.slice(0, 300),
    currentIndex: state.currentIndex,
    playMode: state.playMode,
    volume: state.volume,
    isMuted: state.isMuted,
    preferredQuality: state.preferredQuality,
    history: state.history.slice(0, 100),
  }),
  merge: (persistedState, currentState) => {
    const persisted = persistedState as Partial<PlayerState>;
    const queue = Array.isArray(persisted.queue) ? persisted.queue : [];
    const currentIndex = clampQueueIndex(
      queue,
      typeof persisted.currentIndex === 'number' ? persisted.currentIndex : -1,
    );

    return {
      ...currentState,
      queue,
      currentIndex,
      currentSong: currentIndex >= 0 ? queue[currentIndex] : null,
      playMode: persisted.playMode || currentState.playMode,
      volume: typeof persisted.volume === 'number' ? persisted.volume : currentState.volume,
      isMuted: typeof persisted.isMuted === 'boolean' ? persisted.isMuted : currentState.isMuted,
      preferredQuality: persisted.preferredQuality || currentState.preferredQuality,
      history: Array.isArray(persisted.history) ? persisted.history.slice(0, 100) : currentState.history,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isLoading: false,
      error: null,
    };
  },
}));
