import type { UnifiedSong } from './song';

export type PlayMode = 'sequential' | 'loop' | 'shuffle' | 'loop-one';
export type PreferredQuality = '128' | '320' | 'flac';

export interface PlayerState {
  currentSong: UnifiedSong | null;
  queue: UnifiedSong[];
  currentIndex: number;
  isPlaying: boolean;
  playMode: PlayMode;
  volume: number;
  currentTime: number;
  duration: number;
  isLoading: boolean;
  error: string | null;
  preferredQuality: PreferredQuality;
  history: UnifiedSong[];
  isMuted: boolean;
}
