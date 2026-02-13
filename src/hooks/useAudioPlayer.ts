import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { playerService } from '@/services/player.service';

function toMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.floor(seconds * 1000);
}

function toSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return ms / 1000;
}

export function useAudioPlayer(): { seekTo: (ms: number) => void; retryCurrent: () => void } {
  const cookies = useAuthStore((state) => state.cookies);

  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const volume = usePlayerStore((state) => state.volume);

  const setIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setIsLoading = usePlayerStore((state) => state.setIsLoading);
  const setError = usePlayerStore((state) => state.setError);
  const playNext = usePlayerStore((state) => state.playNext);

  const [retryNonce, setRetryNonce] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestSeqRef = useRef(0);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    const audio = getAudio();

    const onLoadedMetadata = () => {
      setDuration(toMs(audio.duration));
    };
    const onTimeUpdate = () => {
      setCurrentTime(toMs(audio.currentTime));
    };
    const onPlaying = () => {
      setIsLoading(false);
    };
    const onWaiting = () => {
      setIsLoading(true);
    };
    const onEnded = () => {
      playNext();
    };
    const onError = () => {
      const state = usePlayerStore.getState();
      const songName = state.currentSong?.name || '当前歌曲';
      state.setError(`${songName} 播放失败，已自动切到下一首。`);
      state.playNext();
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [getAudio, playNext, setCurrentTime, setDuration, setIsLoading]);

  useEffect(() => {
    const audio = getAudio();
    audio.volume = Math.max(0, Math.min(1, volume));
  }, [getAudio, volume]);

  useEffect(() => {
    const audio = getAudio();
    if (!currentSong) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setCurrentTime(0);
      setDuration(0);
      setIsLoading(false);
      return;
    }

    const sequence = requestSeqRef.current + 1;
    requestSeqRef.current = sequence;

    const loadAndPlay = async () => {
      setIsLoading(true);
      setError(null);

      const resolved = await playerService.resolveSongPlayUrl(currentSong, {
        neteaseCookie: cookies.netease,
        qqCookie: cookies.qq,
      });

      if (requestSeqRef.current !== sequence) {
        return;
      }

      if (!resolved.success || !resolved.url) {
        setIsLoading(false);
        setIsPlaying(false);
        setError(resolved.error || `${currentSong.name} 暂无可用播放链接。`);
        return;
      }

      if (audio.src !== resolved.url) {
        audio.src = resolved.url;
      }

      audio.currentTime = 0;
      setCurrentTime(0);
      setDuration(0);

      if (!usePlayerStore.getState().isPlaying) {
        setIsLoading(false);
        return;
      }

      try {
        await audio.play();
      } catch (error) {
        if (requestSeqRef.current !== sequence) {
          return;
        }
        setIsLoading(false);
        setIsPlaying(false);
        setError(error instanceof Error ? error.message : '播放启动失败，请重试。');
      }
    };

    void loadAndPlay();
  }, [
    cookies.netease,
    cookies.qq,
    currentSong?.id,
    getAudio,
    retryNonce,
    setCurrentTime,
    setDuration,
    setError,
    setIsLoading,
    setIsPlaying,
  ]);

  useEffect(() => {
    const audio = getAudio();
    if (!currentSong) {
      return;
    }

    if (!isPlaying) {
      audio.pause();
      return;
    }

    void audio.play().catch((error) => {
      setIsPlaying(false);
      setError(error instanceof Error ? error.message : '播放失败，请重试。');
    });
  }, [currentSong?.id, getAudio, isPlaying, setError, setIsPlaying]);

  const seekTo = useCallback((ms: number) => {
    const audio = getAudio();
    audio.currentTime = toSeconds(ms);
    setCurrentTime(toMs(audio.currentTime));
  }, [getAudio, setCurrentTime]);

  const retryCurrent = useCallback(() => {
    setRetryNonce((prev) => prev + 1);
    usePlayerStore.getState().setIsPlaying(true);
  }, []);

  return { seekTo, retryCurrent };
}
