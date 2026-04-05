import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { playerService } from '@/services/player.service';
import { LOCAL_API_READY_EVENT } from '@/constants/app.constants';

const MEDIA_SESSION_DEFAULT_ARTWORK = 'https://p.qlogo.cn/gh/0/0/100';
const MEDIA_SESSION_SEEK_STEP_SECONDS = 10;
const NATIVE_BRIDGE_POSITION_SYNC_MS = 1500;
const NATIVE_BRIDGE_MAX_SYNC_INTERVAL_MS = 5000;
const SONG_URL_AUTO_RETRY_LIMIT = 1;

const sharedAudio = {
  _element: null as HTMLAudioElement | null,
  _loadedSongId: null as string | null,

  getElement(): HTMLAudioElement | null {
    return this._element;
  },
  setElement(el: HTMLAudioElement | null): void {
    this._element = el;
  },
  getLoadedSongId(): string | null {
    return this._loadedSongId;
  },
  setLoadedSongId(id: string | null): void {
    this._loadedSongId = id;
  },
};

export function stopSharedAudioPlayback(options: { resetSource?: boolean } = {}): void {
  const audio = sharedAudio.getElement();
  if (!audio) {
    sharedAudio.setLoadedSongId(null);
    return;
  }

  try {
    audio.pause();
  } catch {
    // noop
  }

  if (options.resetSource) {
    audio.removeAttribute('src');
    audio.load();
  }

  sharedAudio.setLoadedSongId(null);
}

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

function hasMediaSessionSupport(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function safeSetMediaSessionActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  if (!hasMediaSessionSupport()) {
    return;
  }

  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some runtimes throw when action is unsupported; silently ignore to keep playback working.
  }
}

type AndroidNativeMediaBridge = {
  updatePlayback: (
    title: string,
    artist: string,
    album: string,
    coverUrl: string,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number,
  ) => void;
  clearPlayback: () => void;
};

function resolveAndroidNativeMediaBridge(): AndroidNativeMediaBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridge = (window as Window & { AllMusicAndroidMedia?: Partial<AndroidNativeMediaBridge> }).AllMusicAndroidMedia;
  if (!bridge || typeof bridge.updatePlayback !== 'function' || typeof bridge.clearPlayback !== 'function') {
    return null;
  }

  return bridge as AndroidNativeMediaBridge;
}

export function useAudioPlayer(): { seekTo: (ms: number) => void; retryCurrent: () => void } {
  const cookies = useAuthStore((state) => state.cookies);

  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const volume = usePlayerStore((state) => state.volume);
  const isMuted = usePlayerStore((state) => state.isMuted);
  const preferredQuality = usePlayerStore((state) => state.preferredQuality);

  const setIsPlaying = usePlayerStore((state) => state.setIsPlaying);
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setIsLoading = usePlayerStore((state) => state.setIsLoading);
  const setError = usePlayerStore((state) => state.setError);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const pushHistory = usePlayerStore((state) => state.pushHistory);

  const [isLocalApiReady, setIsLocalApiReady] = useState(() => {
    const w = window as Window & { __ALLMUSIC_LOCAL_API_READY__?: boolean };
    return Boolean(w.__ALLMUSIC_LOCAL_API_READY__);
  });

  useEffect(() => {
    if (isLocalApiReady) return;
    const onReady = () => setIsLocalApiReady(true);
    window.addEventListener(LOCAL_API_READY_EVENT, onReady);
    return () => window.removeEventListener(LOCAL_API_READY_EVENT, onReady);
  }, [isLocalApiReady]);

  const [retryNonce, setRetryNonce] = useState(0);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const playRequestRef = useRef<{ songId: string | null; sequence: number }>({ songId: null, sequence: 0 });
  const nativeBridgeSyncRef = useRef<{
    songId: string | null;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    syncedAt: number;
  }>({
    songId: null,
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    syncedAt: 0,
  });
  const retryStateRef = useRef<{
    songId: string | null;
    autoRetryCount: number;
    forceRefreshNextLoad: boolean;
  }>({
    songId: null,
    autoRetryCount: 0,
    forceRefreshNextLoad: false,
  });

  const getAudio = useCallback(() => {
    if (!sharedAudio.getElement()) {
      const audio = new Audio();
      audio.preload = 'auto';
      sharedAudio.setElement(audio);
    }
    return sharedAudio.getElement()!;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      // Keep shared audio alive across UI version switches (current/v4/v8).
      // Playback is explicitly stopped by player actions, not by UI unmount.
    };
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
      // Prevent the old `audio.src` from being re-played by other play() effects
      // while the next song URL is still being resolved.
      playRequestRef.current = { songId: null, sequence: requestSeqRef.current };
      playNext();
    };
    const onError = () => {
      const state = usePlayerStore.getState();
      const failedSong = state.currentSong;
      if (!failedSong) {
        return;
      }

      if (retryStateRef.current.songId !== failedSong.id) {
        retryStateRef.current = {
          songId: failedSong.id,
          autoRetryCount: 0,
          forceRefreshNextLoad: false,
        };
      }

      if (retryStateRef.current.autoRetryCount < SONG_URL_AUTO_RETRY_LIMIT) {
        retryStateRef.current.autoRetryCount += 1;
        retryStateRef.current.forceRefreshNextLoad = true;
        sharedAudio.setLoadedSongId(null);
        state.setError(`${failedSong.name} 播放链接已过期，正在重试…`);
        state.setIsPlaying(true);
        state.setIsLoading(true);
        setRetryNonce((prev) => prev + 1);
        return;
      }

      retryStateRef.current.autoRetryCount = 0;
      retryStateRef.current.forceRefreshNextLoad = false;
      state.setError(`${failedSong.name} 播放失败，已切换到下一首`);
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
    audio.muted = isMuted;
  }, [getAudio, isMuted]);

  useEffect(() => {
    retryStateRef.current = {
      songId: currentSong?.id || null,
      autoRetryCount: 0,
      forceRefreshNextLoad: false,
    };
  }, [currentSong?.id]);

  useEffect(() => {
    if (!currentSong) {
      return;
    }

    pushHistory(currentSong);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally trigger only on song ID change
  }, [currentSong?.id, pushHistory]);

  useEffect(() => {
    if (!currentSong) {
      return;
    }

    // Force current song URL re-resolve when quality preference changes.
    sharedAudio.setLoadedSongId(null);
  }, [currentSong?.id, preferredQuality]);

  useEffect(() => {
    if (!hasMediaSessionSupport()) {
      return;
    }

    const seekBy = (deltaSeconds: number) => {
      const audio = getAudio();
      const target = Math.max(0, audio.currentTime + deltaSeconds);
      audio.currentTime = Number.isFinite(audio.duration)
        ? Math.min(target, Math.max(0, audio.duration))
        : target;
      setCurrentTime(toMs(audio.currentTime));
    };

    safeSetMediaSessionActionHandler('play', () => {
      usePlayerStore.getState().setIsPlaying(true);
    });
    safeSetMediaSessionActionHandler('pause', () => {
      usePlayerStore.getState().setIsPlaying(false);
    });
    safeSetMediaSessionActionHandler('previoustrack', () => {
      usePlayerStore.getState().playPrevious();
    });
    safeSetMediaSessionActionHandler('nexttrack', () => {
      usePlayerStore.getState().playNext();
    });
    safeSetMediaSessionActionHandler('seekbackward', (details) => {
      const step = Number(details?.seekOffset) > 0 ? Number(details.seekOffset) : MEDIA_SESSION_SEEK_STEP_SECONDS;
      seekBy(-step);
    });
    safeSetMediaSessionActionHandler('seekforward', (details) => {
      const step = Number(details?.seekOffset) > 0 ? Number(details.seekOffset) : MEDIA_SESSION_SEEK_STEP_SECONDS;
      seekBy(step);
    });
    safeSetMediaSessionActionHandler('seekto', (details) => {
      const seekTime = Number(details?.seekTime);
      if (!Number.isFinite(seekTime) || seekTime < 0) {
        return;
      }

      const audio = getAudio();
      const bounded = Number.isFinite(audio.duration)
        ? Math.min(seekTime, Math.max(0, audio.duration))
        : seekTime;
      audio.currentTime = bounded;
      setCurrentTime(toMs(audio.currentTime));
    });

    return () => {
      safeSetMediaSessionActionHandler('play', null);
      safeSetMediaSessionActionHandler('pause', null);
      safeSetMediaSessionActionHandler('previoustrack', null);
      safeSetMediaSessionActionHandler('nexttrack', null);
      safeSetMediaSessionActionHandler('seekbackward', null);
      safeSetMediaSessionActionHandler('seekforward', null);
      safeSetMediaSessionActionHandler('seekto', null);
    };
  }, [getAudio, playNext, playPrevious, setCurrentTime]);

  useEffect(() => {
    if (!hasMediaSessionSupport()) {
      return;
    }

    if (!currentSong) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    if (typeof MediaMetadata !== 'function') {
      return;
    }

    const artwork = currentSong.coverUrl || MEDIA_SESSION_DEFAULT_ARTWORK;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.name || 'ALLMusic',
      artist: currentSong.artist || '未知歌手',
      album: currentSong.album || 'ALLMusic',
      artwork: [
        { src: artwork, sizes: '96x96' },
        { src: artwork, sizes: '192x192' },
        { src: artwork, sizes: '512x512' },
      ],
    });
  }, [currentSong]);

  useEffect(() => {
    if (!hasMediaSessionSupport()) {
      return;
    }

    navigator.mediaSession.playbackState = currentSong ? (isPlaying ? 'playing' : 'paused') : 'none';
  }, [currentSong, isPlaying]);

  useEffect(() => {
    if (!hasMediaSessionSupport() || typeof navigator.mediaSession.setPositionState !== 'function') {
      return;
    }

    if (!currentSong || duration <= 0) {
      return;
    }

    const durationSeconds = toSeconds(duration);
    const positionSeconds = Math.min(durationSeconds, Math.max(0, toSeconds(currentTime)));
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        playbackRate: 1,
        position: positionSeconds,
      });
    } catch {
      // Ignore invalid state updates and keep audio state source-of-truth inside the player store.
    }
  }, [currentSong, currentTime, duration]);

  useEffect(() => {
    const bridge = resolveAndroidNativeMediaBridge();
    if (!bridge) {
      return;
    }

    if (!currentSong) {
      if (nativeBridgeSyncRef.current.songId !== null) {
        try {
          bridge.clearPlayback();
        } catch {
          // Ignore bridge-level failures to avoid affecting core playback.
        }
      }

      nativeBridgeSyncRef.current = {
        songId: null,
        isPlaying: false,
        positionMs: 0,
        durationMs: 0,
        syncedAt: Date.now(),
      };
      return;
    }

    const now = Date.now();
    const previous = nativeBridgeSyncRef.current;
    const songChanged = previous.songId !== currentSong.id;
    const playStateChanged = previous.isPlaying !== isPlaying;
    const durationChanged = Math.abs(previous.durationMs - duration) >= 1000;
    const positionChanged = Math.abs(previous.positionMs - currentTime) >= NATIVE_BRIDGE_POSITION_SYNC_MS;
    const syncExpired = now - previous.syncedAt >= NATIVE_BRIDGE_MAX_SYNC_INTERVAL_MS;

    if (!(songChanged || playStateChanged || durationChanged || positionChanged || syncExpired)) {
      return;
    }

    try {
      bridge.updatePlayback(
        currentSong.name || 'ALLMusic',
        currentSong.artist || '',
        currentSong.album || '',
        currentSong.coverUrl || '',
        Boolean(isPlaying),
        Math.max(0, Math.floor(currentTime)),
        Math.max(0, Math.floor(duration)),
      );
    } catch {
      // Ignore bridge-level failures to avoid affecting core playback.
    }

    nativeBridgeSyncRef.current = {
      songId: currentSong.id,
      isPlaying,
      positionMs: Math.max(0, Math.floor(currentTime)),
      durationMs: Math.max(0, Math.floor(duration)),
      syncedAt: now,
    };
  }, [
    currentSong?.album,
    currentSong?.artist,
    currentSong?.coverUrl,
    currentSong?.id,
    currentSong?.name,
    currentTime,
    duration,
    isPlaying,
  ]);

  useEffect(() => {
    const audio = getAudio();
    if (!currentSong) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      sharedAudio.setLoadedSongId(null);
      setCurrentTime(0);
      setDuration(0);
      setIsLoading(false);
      return;
    }

    if (sharedAudio.getLoadedSongId() === currentSong.id && audio.src) {
      setDuration(toMs(audio.duration));
      setCurrentTime(toMs(audio.currentTime));
      setIsLoading(false);
      return;
    }

    const sequence = requestSeqRef.current + 1;
    requestSeqRef.current = sequence;

    const loadAndPlay = async () => {
      setIsLoading(true);
      setError(null);
      const retryState = retryStateRef.current;
      const shouldForceRefresh =
        retryState.songId === currentSong.id && retryState.forceRefreshNextLoad;
      if (shouldForceRefresh) {
        retryState.forceRefreshNextLoad = false;
      }

      const resolved = await playerService.resolveSongPlayUrl(currentSong, {
        neteaseCookie: cookies.netease,
        qqCookie: cookies.qq,
        quality: preferredQuality,
        forceRefresh: shouldForceRefresh,
      });

      if (!mountedRef.current || requestSeqRef.current !== sequence) {
        return;
      }

      if (!resolved.success || !resolved.url) {
        setIsLoading(false);

        // 只有在实际播放时才显示错误，避免启动时的误报
        const currentState = usePlayerStore.getState();
        if (currentState.isPlaying) {
          setIsPlaying(false);
          const fallbackMessage = resolved.error || `${currentSong.name} 无可用播放链接`;
          if (shouldForceRefresh) {
            setError(`${fallbackMessage}，自动重试失败，已切换到下一首`);
            currentState.playNext();
            return;
          }
          setError(fallbackMessage);
        }
        return;
      }

      if (audio.src !== resolved.url) {
        audio.src = resolved.url;
      }
      sharedAudio.setLoadedSongId(currentSong.id);
      if (retryStateRef.current.songId === currentSong.id) {
        retryStateRef.current.autoRetryCount = 0;
      }

      playRequestRef.current = { songId: currentSong.id, sequence };

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
        if (!mountedRef.current || requestSeqRef.current !== sequence) {
          return;
        }
        setIsLoading(false);
        setIsPlaying(false);
        const message = error instanceof Error ? error.message : '播放启动失败';
        if (shouldForceRefresh) {
          setError(`${message}，自动重试失败，已切换到下一首`);
          usePlayerStore.getState().playNext();
          return;
        }
        setError(message);
      }
    };

    // API 未就绪时跳过 URL 解析，避免 bootstrap 期间产生无意义的播放错误
    if (!isLocalApiReady) {
      return;
    }

    void loadAndPlay();
  }, [
    cookies.netease,
    cookies.qq,
    currentSong?.id,
    getAudio,
    isLocalApiReady,
    preferredQuality,
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

    if (playRequestRef.current.songId !== currentSong.id) {
      return;
    }

    void audio.play().catch((error) => {
      setIsPlaying(false);
      setError(error instanceof Error ? error.message : '播放失败');
    });
  }, [currentSong?.id, getAudio, isPlaying, setError, setIsPlaying]);

  const seekTo = useCallback((ms: number) => {
    const audio = getAudio();
    audio.currentTime = toSeconds(ms);
    setCurrentTime(toMs(audio.currentTime));
  }, [getAudio, setCurrentTime]);

  const retryCurrent = useCallback(() => {
    const songId = usePlayerStore.getState().currentSong?.id || null;
    retryStateRef.current = {
      songId,
      autoRetryCount: 0,
      forceRefreshNextLoad: true,
    };
    setRetryNonce((prev) => prev + 1);
    sharedAudio.setLoadedSongId(null);
    usePlayerStore.getState().setIsPlaying(true);
  }, []);

  return { seekTo, retryCurrent };
}
