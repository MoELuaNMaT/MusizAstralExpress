export interface ThumbnailState {
  songId: string | null;
  title: string;
  artist: string;
  isPlaying: boolean;
  canPrevious: boolean;
  canNext: boolean;
  coverUrl?: string | null;
}
