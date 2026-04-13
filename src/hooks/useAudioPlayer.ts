import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { playerService } from '@/services/player.service';
import { LOCAL_API_READY_EVENT } from '@/constants/app.constants';

const MEDIA_SESSION_DEFAULT_ARTWORK = 'https://p.qlogo.cn/gh/0/0/100';
const MEDIA_SESSION_SEEK_STEP_SECONDS = 10;
const NATIVE_BRIDGE_POSITION_SYNC_MS = 1500;
const NATIVE_BRIDGE_MAX_SYNC_INTERVAL_MS = 5000;
const SONG_URL_AUTO_RETRY_LIMIT = 1;
const SPECTRUM_MIN_DECIBELS = -92;
const SPECTRUM_MAX_DECIBELS = -18;
const SPECTRUM_MIN_FREQ = 32;
const SPECTRUM_MAX_FREQ = 16_000;
const SPECTRUM_ATTACK_MS = 70;
const SPECTRUM_RELEASE_MS = 420;
const SPECTRUM_PEAK_HOLD_MS = 180;
const SPECTRUM_PEAK_DROP_PER_SECOND = 3.5;
const SPECTRUM_FLOOR_RISE_MS = 3200;
const SPECTRUM_FLOOR_FALL_MS = 1800;
const SPECTRUM_CEILING_RISE_MS = 320;
const SPECTRUM_CEILING_FALL_MS = 2400;
const SPECTRUM_PCEN_SMOOTH_MS = 300;
const SPECTRUM_PCEN_EPSILON = 0.045;
const SPECTRUM_PCEN_GAIN = 0.78;
const SPECTRUM_PCEN_BIAS = 0.08;
const SPECTRUM_PCEN_POWER = 0.72;
const SPECTRUM_FLUX_ATTACK_MS = 48;
const SPECTRUM_FLUX_RELEASE_MS = 170;

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

const sharedAnalyser = {
  context: null as AudioContext | null,
  analyser: null as AnalyserNode | null,
  source: null as MediaStreamAudioSourceNode | null,
  stream: null as MediaStream | null,
  streamSrc: null as string | null,
  dataArray: null as Float32Array<ArrayBuffer> | null,
  captureBlocked: false,
};

export type SpectrumTone = 'cyan' | 'green' | 'yellow' | 'red';

export interface SpectrumBar {
  level: number;
  peakLevel: number;
  tone: SpectrumTone;
}

interface SpectrumBandRange {
  startIndex: number;
  endIndex: number;
  gain: number;
}

interface SpectrumBandDynamics {
  floorRatio: number;
  headroom: number;
  minWindow: number;
}

function resetSharedAnalyserCapture(): void {
  try {
    sharedAnalyser.source?.disconnect();
  } catch {
    // noop
  }

  sharedAnalyser.source = null;
  sharedAnalyser.stream = null;
  sharedAnalyser.streamSrc = null;
  sharedAnalyser.captureBlocked = false;
}

function resolveAudioCaptureStream(audio: HTMLAudioElement): MediaStream | null {
  const mediaElement = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  try {
    if (typeof mediaElement.captureStream === 'function') {
      return mediaElement.captureStream();
    }

    if (typeof mediaElement.mozCaptureStream === 'function') {
      return mediaElement.mozCaptureStream();
    }
  } catch {
    sharedAnalyser.captureBlocked = true;
    return null;
  }

  return null;
}

function getOrCreateSharedAudio(): HTMLAudioElement {
  if (!sharedAudio.getElement()) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    sharedAudio.setElement(audio);
  }
  return sharedAudio.getElement()!;
}

function hzToMel(freq: number): number {
  return 2595 * Math.log10(1 + (freq / 700));
}

function melToHz(mel: number): number {
  return 700 * ((10 ** (mel / 2595)) - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSpectrumGain(centerHz: number): number {
  if (centerHz < 140) {
    return 1.24;
  }
  if (centerHz < 1_200) {
    return 1.18;
  }
  if (centerHz < 6_000) {
    return 1.06;
  }
  return 0.96;
}

function resolveSpectrumTone(level: number): SpectrumTone {
  if (level >= 10) {
    return 'red';
  }
  if (level >= 6) {
    return 'yellow';
  }
  if (level >= 3) {
    return 'green';
  }
  return 'cyan';
}

function resolveSpectrumBandDynamics(index: number, barCount: number): SpectrumBandDynamics {
  const position = barCount <= 1 ? 0 : index / (barCount - 1);
  if (position <= 0.22) {
    return {
      floorRatio: 0.56,
      headroom: 0.24,
      minWindow: 0.28,
    };
  }
  if (position <= 0.65) {
    return {
      floorRatio: 0.42,
      headroom: 0.2,
      minWindow: 0.24,
    };
  }
  return {
    floorRatio: 0.3,
    headroom: 0.16,
    minWindow: 0.2,
  };
}

function compressLowBandHeadroom(value: number, index: number): number {
  if (index >= 4 || value <= 0.8) {
    return value;
  }

  const overflow = clamp((value - 0.8) / 0.2, 0, 1);
  return 0.8 + (Math.pow(overflow, 0.9) * 0.12);
}

function remapSpectrumDisplayLevel(value: number, segmentCount: number): number {
  const normalized = clamp(value, 0, 1);
  const lowerCompressedThreshold = 0.16;
  const middleExpandedThreshold = 0.68;

  if (normalized <= lowerCompressedThreshold) {
    return (normalized / lowerCompressedThreshold) * 0.22;
  }

  if (normalized <= middleExpandedThreshold) {
    const middleProgress = (normalized - lowerCompressedThreshold)
      / (middleExpandedThreshold - lowerCompressedThreshold);
    return 0.22 + (middleProgress * Math.max(0, segmentCount - 1.8));
  }

  const highProgress = (normalized - middleExpandedThreshold) / (1 - middleExpandedThreshold);
  return (segmentCount - 1.58) + (highProgress * 1.58);
}

function buildSpectrumBandRanges(
  frequencyBinCount: number,
  sampleRate: number,
  barCount: number,
): SpectrumBandRange[] {
  const nyquist = sampleRate / 2;
  const minMel = hzToMel(SPECTRUM_MIN_FREQ);
  const maxMel = hzToMel(Math.min(SPECTRUM_MAX_FREQ, nyquist));
  const melStep = (maxMel - minMel) / barCount;

  return Array.from({ length: barCount }, (_, barIndex) => {
    const startMel = minMel + (melStep * barIndex);
    const endMel = minMel + (melStep * (barIndex + 1));
    const startFreq = melToHz(startMel);
    const endFreq = melToHz(endMel);
    const centerHz = (startFreq + endFreq) / 2;
    const startIndex = clamp(
      Math.floor((startFreq / nyquist) * frequencyBinCount),
      0,
      Math.max(0, frequencyBinCount - 1),
    );
    const endIndex = clamp(
      Math.ceil((endFreq / nyquist) * frequencyBinCount),
      startIndex + 1,
      frequencyBinCount,
    );

    return {
      startIndex,
      endIndex,
      gain: resolveSpectrumGain(centerHz),
    };
  });
}

function smoothTowards(current: number, target: number, deltaMs: number): number {
  if (target >= current) {
    const riseStep = clamp(deltaMs / SPECTRUM_ATTACK_MS, 0, 1);
    return current + ((target - current) * riseStep);
  }

  const fallStep = clamp(deltaMs / SPECTRUM_RELEASE_MS, 0, 1);
  return current + ((target - current) * fallStep);
}

function smoothByTime(current: number, target: number, deltaMs: number, timeMs: number): number {
  const blend = clamp(deltaMs / Math.max(1, timeMs), 0, 1);
  return current + ((target - current) * blend);
}

function smoothByEnvelope(
  current: number,
  target: number,
  deltaMs: number,
  attackMs: number,
  releaseMs: number,
): number {
  if (target >= current) {
    return smoothByTime(current, target, deltaMs, attackMs);
  }

  return smoothByTime(current, target, deltaMs, releaseMs);
}

function normalizePcen(value: number): number {
  return clamp(value / 1.45, 0, 1);
}

function buildPcenValue(rawEnergy: number, smoothEnergy: number): number {
  const denominator = Math.pow(SPECTRUM_PCEN_EPSILON + smoothEnergy, SPECTRUM_PCEN_GAIN);
  const pcen = Math.pow((rawEnergy / Math.max(0.0001, denominator)) + SPECTRUM_PCEN_BIAS, SPECTRUM_PCEN_POWER)
    - Math.pow(SPECTRUM_PCEN_BIAS, SPECTRUM_PCEN_POWER);

  return normalizePcen(pcen);
}

function ensureSharedAnalyser(): typeof sharedAnalyser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  const audio = getOrCreateSharedAudio();
  if (!sharedAnalyser.context) {
    sharedAnalyser.context = new AudioContextCtor();
  }

  if (!sharedAnalyser.analyser) {
    sharedAnalyser.analyser = sharedAnalyser.context.createAnalyser();
    sharedAnalyser.analyser.fftSize = 1024;
    sharedAnalyser.analyser.minDecibels = SPECTRUM_MIN_DECIBELS;
    sharedAnalyser.analyser.maxDecibels = SPECTRUM_MAX_DECIBELS;
    sharedAnalyser.analyser.smoothingTimeConstant = 0.55;
    sharedAnalyser.dataArray = new Float32Array(sharedAnalyser.analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
  }

  if (sharedAnalyser.captureBlocked) {
    return sharedAnalyser;
  }

  // `currentSrc` can lag behind `src` during source swaps. For capture rebinding we
  // care about the requested track boundary first, otherwise the analyser may keep
  // holding on to the previous song's capture graph for one transition.
  const currentStreamSrc = audio.src || audio.currentSrc || null;
  if (!currentStreamSrc) {
    return sharedAnalyser;
  }

  if (sharedAnalyser.source && sharedAnalyser.stream && sharedAnalyser.streamSrc === currentStreamSrc) {
    return sharedAnalyser;
  }

  const stream = resolveAudioCaptureStream(audio);
  if (!stream) {
    return sharedAnalyser;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    return sharedAnalyser;
  }

  const shouldReconnectSource = !sharedAnalyser.source
    || !sharedAnalyser.stream
    || sharedAnalyser.streamSrc !== currentStreamSrc
    || sharedAnalyser.stream.id !== stream.id;

  if (shouldReconnectSource) {
    sharedAnalyser.source?.disconnect();
    sharedAnalyser.stream = stream;
    sharedAnalyser.streamSrc = currentStreamSrc;
    // 有些运行时会复用同一个 MediaStream，但底层音轨已经随切歌变化。
    // 这里按当前歌曲 URL 重建采样源，避免频谱继续挂在上一首或出现隔首失效。
    sharedAnalyser.source = sharedAnalyser.context.createMediaStreamSource(stream);
    sharedAnalyser.source.connect(sharedAnalyser.analyser);
  }

  return sharedAnalyser;
}

function resumeSharedAnalyserContext(): void {
  const analyserState = ensureSharedAnalyser();
  if (!analyserState?.context || analyserState.context.state !== 'suspended') {
    return;
  }

  void analyserState.context.resume().catch(() => undefined);
}

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

  resetSharedAnalyserCapture();
  sharedAudio.setLoadedSongId(null);
}

export function useAudioSpectrum(
  options: {
    barCount?: number;
    segmentCount?: number;
    enabled?: boolean;
  } = {},
) : { bars: SpectrumBar[]; available: boolean } {
  const barCount = options.barCount ?? 16;
  const segmentCount = options.segmentCount ?? 12;
  const enabled = options.enabled ?? true;
  const zeroBars = useMemo<SpectrumBar[]>(
    () => Array.from({ length: barCount }, () => ({ level: 0, peakLevel: 0, tone: 'cyan' as const })),
    [barCount],
  );
  const [bars, setBars] = useState<SpectrumBar[]>(zeroBars);
  const [available, setAvailable] = useState(true);
  const displayLevelsRef = useRef<number[]>(Array.from({ length: barCount }, () => 0));
  const peakLevelsRef = useRef<number[]>(Array.from({ length: barCount }, () => 0));
  const peakHoldUntilRef = useRef<number[]>(Array.from({ length: barCount }, () => 0));
  const adaptiveFloorRef = useRef<number[]>(Array.from({ length: barCount }, () => 0.02));
  const adaptiveCeilingRef = useRef<number[]>(Array.from({ length: barCount }, () => 0.7));
  const pcenSmoothingRef = useRef<number[]>(Array.from({ length: barCount }, () => 0.04));
  const previousEnergyRef = useRef<number[]>(Array.from({ length: barCount }, () => 0));
  const fluxLevelsRef = useRef<number[]>(Array.from({ length: barCount }, () => 0));
  const lastFrameTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      displayLevelsRef.current = Array.from({ length: barCount }, () => 0);
      peakLevelsRef.current = Array.from({ length: barCount }, () => 0);
      peakHoldUntilRef.current = Array.from({ length: barCount }, () => 0);
      adaptiveFloorRef.current = Array.from({ length: barCount }, () => 0.02);
      adaptiveCeilingRef.current = Array.from({ length: barCount }, () => 0.7);
      pcenSmoothingRef.current = Array.from({ length: barCount }, () => 0.04);
      previousEnergyRef.current = Array.from({ length: barCount }, () => 0);
      fluxLevelsRef.current = Array.from({ length: barCount }, () => 0);
      lastFrameTimeRef.current = null;
      setBars((prev) => (prev.every((item) => item.level === 0 && item.peakLevel === 0) ? prev : zeroBars));
      setAvailable(!sharedAnalyser.captureBlocked);
      return;
    }

    let frameId = 0;
    let cancelled = false;

    const update = () => {
      if (cancelled) {
        return;
      }

      const now = performance.now();
      const deltaMs = Math.min(64, Math.max(16, now - (lastFrameTimeRef.current ?? now)));
      lastFrameTimeRef.current = now;

      const analyserState = ensureSharedAnalyser();
      setAvailable(Boolean(analyserState && !analyserState.captureBlocked));
      const audio = sharedAudio.getElement();
      const normalizedLevels = Array.from({ length: barCount }, () => 0);
      const canSample = Boolean(
        analyserState
        && analyserState.analyser
        && analyserState.dataArray
        && analyserState.context
        && !analyserState.captureBlocked
        && audio,
      );

      if (canSample) {
        const analyser = analyserState!.analyser!;
        const dataArray = analyserState!.dataArray!;
        const context = analyserState!.context!;
        if (context.state === 'suspended') {
          void context.resume().catch(() => undefined);
        }

        if (!audio!.paused) {
          analyser.getFloatFrequencyData(dataArray);
          const bandRanges = buildSpectrumBandRanges(
            dataArray.length,
            context.sampleRate,
            barCount,
          );

          for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
            const band = bandRanges[barIndex];
            let energySum = 0;
            let peak = 0;
            let sampleCount = 0;

            for (let index = band.startIndex; index < band.endIndex; index += 1) {
              const valueDb = clamp(
                dataArray[index],
                SPECTRUM_MIN_DECIBELS,
                SPECTRUM_MAX_DECIBELS,
              );
              const amplitude = clamp(
                10 ** ((valueDb - SPECTRUM_MAX_DECIBELS) / 20),
                0,
                1,
              );
              energySum += amplitude * amplitude;
              peak = Math.max(peak, amplitude);
              sampleCount += 1;
            }

            const rms = sampleCount > 0 ? Math.sqrt(energySum / sampleCount) : 0;
            const bandEnergy = clamp(((rms * 0.78) + (peak * 0.22)) * band.gain, 0, 1);
            normalizedLevels[barIndex] = bandEnergy;
          }
        }
      }

      const nextBars = normalizedLevels.map((rawNormalizedLevel, index) => {
        const dynamics = resolveSpectrumBandDynamics(index, barCount);
        const previousFloor = adaptiveFloorRef.current[index] ?? 0.02;
        const previousCeiling = adaptiveCeilingRef.current[index] ?? 0.7;
        const previousSmoothEnergy = pcenSmoothingRef.current[index] ?? 0.04;
        const nextSmoothEnergy = smoothByTime(
          previousSmoothEnergy,
          rawNormalizedLevel,
          deltaMs,
          SPECTRUM_PCEN_SMOOTH_MS,
        );
        pcenSmoothingRef.current[index] = nextSmoothEnergy;

        const absoluteEnergy = Math.pow(rawNormalizedLevel, 0.42);
        const pcenEnergy = buildPcenValue(rawNormalizedLevel, nextSmoothEnergy);
        const relativePresence = clamp(
          Math.pow(
            Math.max(0, rawNormalizedLevel - (nextSmoothEnergy * 0.82)) / 0.36,
            0.74,
          ),
          0,
          1,
        );
        const previousEnergy = previousEnergyRef.current[index] ?? 0;
        const rawFlux = Math.max(0, rawNormalizedLevel - previousEnergy);
        previousEnergyRef.current[index] = rawNormalizedLevel;
        const fluxLevel = smoothByEnvelope(
          fluxLevelsRef.current[index] ?? 0,
          rawFlux,
          deltaMs,
          SPECTRUM_FLUX_ATTACK_MS,
          SPECTRUM_FLUX_RELEASE_MS,
        );
        fluxLevelsRef.current[index] = fluxLevel;
        const fluxEnergy = clamp(Math.pow(fluxLevel / 0.16, 0.72), 0, 1);
        const emphasized = clamp(
          (absoluteEnergy * 0.36)
          + (pcenEnergy * 0.34)
          + (relativePresence * 0.18)
          + (fluxEnergy * 0.12),
          0,
          1,
        );

        const floorTarget = emphasized <= previousFloor
          ? emphasized
          : emphasized * dynamics.floorRatio;
        const nextFloor = emphasized <= previousFloor
          ? previousFloor + ((floorTarget - previousFloor) * clamp(deltaMs / SPECTRUM_FLOOR_FALL_MS, 0, 1))
          : previousFloor + ((floorTarget - previousFloor) * clamp(deltaMs / SPECTRUM_FLOOR_RISE_MS, 0, 1));

        const ceilingTarget = emphasized >= previousCeiling
          ? emphasized
          : Math.max(emphasized + dynamics.headroom, nextFloor + dynamics.minWindow);
        const nextCeiling = emphasized >= previousCeiling
          ? previousCeiling + ((ceilingTarget - previousCeiling) * clamp(deltaMs / SPECTRUM_CEILING_RISE_MS, 0, 1))
          : previousCeiling + ((ceilingTarget - previousCeiling) * clamp(deltaMs / SPECTRUM_CEILING_FALL_MS, 0, 1));

        adaptiveFloorRef.current[index] = clamp(nextFloor, 0.01, 0.72);
        adaptiveCeilingRef.current[index] = clamp(
          Math.max(nextCeiling, adaptiveFloorRef.current[index] + dynamics.minWindow),
          adaptiveFloorRef.current[index] + dynamics.minWindow,
          1,
        );

        const normalizedWindowed = clamp(
          (emphasized - adaptiveFloorRef.current[index])
            / Math.max(0.12, adaptiveCeilingRef.current[index] - adaptiveFloorRef.current[index]),
          0,
          1,
        );
        const compressed = compressLowBandHeadroom(normalizedWindowed, index);
        const positiveDelta = Math.max(0, emphasized - previousFloor);
        const changeBoost = Math.pow(positiveDelta, 0.8) * 0.32;

        const displayEnergy = clamp((compressed * 0.76) + (changeBoost * 0.24), 0, 1);
        const targetLevel = remapSpectrumDisplayLevel(displayEnergy, segmentCount);
        const smoothedLevel = smoothTowards(displayLevelsRef.current[index] ?? 0, targetLevel, deltaMs);
        displayLevelsRef.current[index] = smoothedLevel;

        let nextPeakLevel = peakLevelsRef.current[index] ?? 0;
        if (smoothedLevel >= nextPeakLevel) {
          nextPeakLevel = smoothedLevel;
          peakHoldUntilRef.current[index] = now + SPECTRUM_PEAK_HOLD_MS;
        } else if (now >= (peakHoldUntilRef.current[index] ?? 0)) {
          nextPeakLevel = Math.max(
            smoothedLevel,
            nextPeakLevel - ((deltaMs / 1000) * SPECTRUM_PEAK_DROP_PER_SECOND),
          );
        }
        peakLevelsRef.current[index] = nextPeakLevel;

        const toneLevel = Math.max(smoothedLevel, nextPeakLevel);
        return {
          level: smoothedLevel,
          peakLevel: nextPeakLevel,
          tone: resolveSpectrumTone(toneLevel),
        };
      });

      setBars((prev) => {
        if (
          prev.length === nextBars.length
          && prev.every((item, index) => (
            Math.abs(item.level - nextBars[index].level) < 0.01
            && Math.abs(item.peakLevel - nextBars[index].peakLevel) < 0.01
            && item.tone === nextBars[index].tone
          ))
        ) {
          return prev;
        }
        return nextBars;
      });

      frameId = window.requestAnimationFrame(update);
    };

    frameId = window.requestAnimationFrame(update);
    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [barCount, enabled, segmentCount, zeroBars]);

  return { bars, available };
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
    return getOrCreateSharedAudio();
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
      resumeSharedAnalyserContext();
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
      resetSharedAnalyserCapture();
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
        resetSharedAnalyserCapture();
        audio.crossOrigin = 'anonymous';
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
        resumeSharedAnalyserContext();
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

    resumeSharedAnalyserContext();
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
