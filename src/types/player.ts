import type { UnifiedSong } from './song';

/**
 * Play mode
 */
export type PlayMode = 'sequential' | 'loop' | 'shuffle' | 'loop-one';

/**
 * Player state
 */
export interface PlayerState {
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
