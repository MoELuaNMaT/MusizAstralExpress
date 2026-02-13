import { create } from 'zustand';
import type { UnifiedPlaylist, UnifiedSong } from '@/types';

/**
 * Playlist store state
 */
interface PlaylistState {
  /** All user playlists */
  playlists: UnifiedPlaylist[];
  /** Currently selected playlist */
  currentPlaylist: UnifiedPlaylist | null;
  /** Is loading playlists */
  isLoadingPlaylists: boolean;
  /** Is loading playlist detail */
  isLoadingDetail: boolean;
}

/**
 * Playlist store actions
 */
interface PlaylistActions {
  /** Set playlists */
  setPlaylists: (playlists: UnifiedPlaylist[]) => void;
  /** Add playlists */
  addPlaylists: (playlists: UnifiedPlaylist[]) => void;
  /** Update playlist */
  updatePlaylist: (playlistId: string, updates: Partial<UnifiedPlaylist>) => void;
  /** Remove playlist */
  removePlaylist: (playlistId: string) => void;
  /** Set current playlist */
  setCurrentPlaylist: (playlist: UnifiedPlaylist | null) => void;
  /** Load playlist songs */
  loadPlaylistSongs: (playlistId: string, songs: UnifiedSong[]) => void;
  /** Set loading state */
  setIsLoadingPlaylists: (isLoading: boolean) => void;
  setIsLoadingDetail: (isLoading: boolean) => void;
  /** Reset store */
  reset: () => void;
}

/**
 * Initial state
 */
const initialState: PlaylistState = {
  playlists: [],
  currentPlaylist: null,
  isLoadingPlaylists: false,
  isLoadingDetail: false,
};

/**
 * Playlist store
 */
export const usePlaylistStore = create<PlaylistState & PlaylistActions>((set) => ({
  ...initialState,

  setPlaylists: (playlists) => set({ playlists }),

  addPlaylists: (newPlaylists) =>
    set((state) => ({
      playlists: [...state.playlists, ...newPlaylists],
    })),

  updatePlaylist: (playlistId, updates) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, ...updates } : p
      ),
      currentPlaylist:
        state.currentPlaylist?.id === playlistId
          ? { ...state.currentPlaylist, ...updates }
          : state.currentPlaylist,
    })),

  removePlaylist: (playlistId) =>
    set((state) => ({
      playlists: state.playlists.filter((p) => p.id !== playlistId),
      currentPlaylist:
        state.currentPlaylist?.id === playlistId ? null : state.currentPlaylist,
    })),

  setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist }),

  loadPlaylistSongs: (playlistId, songs) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, songs } : p
      ),
      currentPlaylist:
        state.currentPlaylist?.id === playlistId
          ? { ...state.currentPlaylist, songs }
          : state.currentPlaylist,
    })),

  setIsLoadingPlaylists: (isLoading) => set({ isLoadingPlaylists: isLoading }),

  setIsLoadingDetail: (isLoading) => set({ isLoadingDetail: isLoading }),

  reset: () => set(initialState),
}));
