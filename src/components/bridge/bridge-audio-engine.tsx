import { useEffect } from 'react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

export function BridgeAudioEngine({
  onSeekReady,
  onRetryReady,
}: {
  onSeekReady: (fn: (ms: number) => void) => void;
  onRetryReady: (fn: () => void) => void;
}) {
  const { seekTo, retryCurrent } = useAudioPlayer();

  useEffect(() => {
    onSeekReady(seekTo);
    onRetryReady(retryCurrent);
  }, [onRetryReady, onSeekReady, retryCurrent, seekTo]);

  return null;
}
