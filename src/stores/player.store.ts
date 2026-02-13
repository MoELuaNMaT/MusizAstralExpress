import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { UnifiedSong, PlayMode } from '@/types';

/**
 * Player store state
 */
interface PlayerState {
  /** Current playing song */
  currentSong: UnifiedSong | null;
  /** Play queue */
  queue: UnifiedSong[];
  /** Current queue index */
  currentIndex: number;
  /** Is playing */
  isPlaying: boolean;
  /** Play mode */
  playMode: PlayMode;
  /** Volume (0-1) */
  volume: number;
  /** Current playback position (ms) */
  currentTime: number;
  /** Total duration (ms) */
  duration: number;
  /** Is buffering/loading */
  isLoading: boolean;
  /** Playback error message */
  error: string | null;
}

/**
 * Player store actions
 */
interface PlayerActions {
  /** Set current song */
  setCurrentSong: (song: UnifiedSong | null) => void;
  /** Set play queue */
  setQueue: (songs: UnifiedSong[], startIndex?: number) => void;
  /** Add songs to queue */
  addToQueue: (songs: UnifiedSong[]) => void;
  /** Remove song from queue */
  removeFromQueue: (index: number) => void;
  /** Clear queue */
  clearQueue: () => void;
  /** Play song at index */
  playAt: (index: number) => void;
  /** Play next song */
  playNext: () => void;
  /** Play previous song */
  playPrevious: () => void;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Set playing state */
  setIsPlaying: (isPlaying: boolean) => void;
  /** Set play mode */
  setPlayMode: (mode: PlayMode) => void;
  /** Set volume */
  setVolume: (volume: number) => void;
  /** Set current time */
  setCurrentTime: (time: number) => void;
  /** Set total duration */
  setDuration: (duration: number) => void;
  /** Set loading state */
  setIsLoading: (isLoading: boolean) => void;
  /** Set playback error */
  setError: (error: string | null) => void;
  /** Reset player */
  reset: () => void;
}

/**
 * Initial state
 */
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

  let nextIndex = currentIndex;
  for (let i = 0; i < 5; i += 1) {
    const candidate = Math.floor(Math.random() * queueLength);
    if (candidate !== currentIndex) {
      nextIndex = candidate;
      break;
    }
  }
  return nextIndex;
}

/**
 * Player store
 */
export const usePlayerStore = create<PlayerState & PlayerActions>()(persist((set, get) => ({
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

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),

  setDuration: (duration) => set({ duration: Math.max(0, duration) }),

  setIsLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => {
    const state = get();
    if (state.currentSong || state.queue.length > 0 || state.isPlaying) {
      set(initialState);
      return;
    }
    set(initialState);
  },
}), {
  name: PLAYER_STORE_KEY,
  storage: createJSONStorage(resolvePlayerStorage),
  partialize: (state) => ({
    queue: state.queue.slice(0, 300),
    currentIndex: state.currentIndex,
    playMode: state.playMode,
    volume: state.volume,
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
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isLoading: false,
      error: null,
    };
  },
}));
