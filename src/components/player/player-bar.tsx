import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSongLikeAction } from '@/hooks/useSongLikeAction';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration } from '@/lib/utils';
import { parseLyric, getActiveLyricIndex, resolveLyricPair } from '@/lib/lyrics';
import type { ParsedLyric } from '@/lib/lyrics';
import { libraryService } from '@/services/library.service';
import { useAuthStore, useLocalApiStatusStore, usePlayerStore, useSongLikeStore } from '@/stores';
import type { PlayMode, UnifiedSong } from '@/types';
import { getSongLikeKey } from '@/utils/home.utils';

const SPECTRUM_BAR_COUNT = 10;
const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;
const LYRIC_MODE_ORDER = ['original', 'translated', 'bilingual'] as const;
const LYRIC_MODE_ANGLE: Record<LyricDisplayMode, number> = {
  original: -42,
  translated: 0,
  bilingual: 42,
};

type LyricDisplayMode = (typeof LYRIC_MODE_ORDER)[number];

interface VolumeSegmentSpec {
  active: boolean;
  path: string;
  tone: 'green' | 'yellow' | 'red';
}

interface IconProps {
  className?: string;
}

interface PlatformPowerSwitchProps {
  label: string;
  accent: 'green' | 'red';
  active: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}

function PrevIcon({ className = 'am-retro-player__icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M7 5h2v14H7zM11 12l8 6V6z" fill="currentColor" />
    </svg>
  );
}

function NextIcon({ className = 'am-retro-player__icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M15 12L7 6v12zM17 5h2v14h-2z" fill="currentColor" />
    </svg>
  );
}

function PlayIcon({ className = 'am-retro-player__icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon({ className = 'am-retro-player__icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
    </svg>
  );
}

function SequentialIcon({ className = 'am-retro-player__mode-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="4.5" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
      <rect x="3" y="10.4" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
      <rect x="3" y="16.3" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
      <rect x="8" y="5" width="13" height="2.4" rx="1.2" fill="currentColor" />
      <rect x="8" y="10.9" width="13" height="2.4" rx="1.2" fill="currentColor" />
      <rect x="8" y="16.8" width="13" height="2.4" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function RepeatIcon({ className = 'am-retro-player__mode-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M17.4 2.5l4.1 4.1-4.1 4.1V8.3H8.2c-1.9 0-3.3 1.4-3.3 3.3v0.1H2.5v-0.1c0-3.2 2.6-5.7 5.7-5.7h9.2V2.5z" fill="currentColor" />
      <path d="M6.6 21.5l-4.1-4.1 4.1-4.1v2.4h9.2c1.9 0 3.3-1.4 3.3-3.3v-0.1h2.4v0.1c0 3.2-2.6 5.7-5.7 5.7H6.6v3.4z" fill="currentColor" />
    </svg>
  );
}

function ShuffleIcon({ className = 'am-retro-player__mode-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M16.9 3h4.1v4.1h-2.3V6.8l-4 4-1.7-1.7 3.9-3.9h-0.1V3z" fill="currentColor" />
      <path d="M16.9 16.9h0.1l-3.9-3.9 1.7-1.7 4 4v-0.3H21V21h-4.1v-2.3z" fill="currentColor" />
      <path d="M3 5.7h3.4l3.1 3.1-1.7 1.7-2.4-2.4H3V5.7z" fill="currentColor" />
      <path d="M3 18.3h2.4l7.8-7.8 1.7 1.7-8.5 8.5H3v-2.4z" fill="currentColor" />
    </svg>
  );
}

function RepeatOneIcon({ className = 'am-retro-player__mode-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M17.4 2.5l4.1 4.1-4.1 4.1V8.3H8.2c-1.9 0-3.3 1.4-3.3 3.3v0.1H2.5v-0.1c0-3.2 2.6-5.7 5.7-5.7h9.2V2.5z" fill="currentColor" />
      <path d="M6.6 21.5l-4.1-4.1 4.1-4.1v2.4h9.2c1.9 0 3.3-1.4 3.3-3.3v-0.1h2.4v0.1c0 3.2-2.6 5.7-5.7 5.7H6.6v3.4z" fill="currentColor" />
      <path d="M11 8.2h2.2v7.6H11zM9.1 9.9L12 7l2.9 2.9-1.6 1.6-1.3-1.3-1.3 1.3-1.6-1.6z" fill="currentColor" />
    </svg>
  );
}

function HeartIcon({ className = 'am-retro-player__mode-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 20.8l-1.3-1.2C5.6 14.9 2.5 12 2.5 8.5A4.7 4.7 0 017.2 3.8c1.8 0 3.5.9 4.8 2.4 1.3-1.5 3-2.4 4.8-2.4a4.7 4.7 0 014.7 4.7c0 3.5-3.1 6.4-8.2 11.1L12 20.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function MuteIcon({ className = 'am-retro-player__mode-icon', muted = false }: IconProps & { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M10.8 4.4v15.2L5.8 15H2.6V9h3.2l5-4.6z" fill="currentColor" />
      {muted ? (
        <>
          <path d="M16.2 8.7l1.7-1.7 2.2 2.2L22.3 7l1.7 1.7-2.2 2.2 2.2 2.2-1.7 1.7-2.2-2.2-2.2 2.2-1.7-1.7 2.2-2.2-2.2-2.2z" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M14.7 9.1c1.8 1.1 1.8 4.7 0 5.8v-5.8z" fill="currentColor" />
          <path d="M17.4 6.5c3.4 2.2 3.4 8.8 0 11V15c1.4-1.5 1.4-4.5 0-6v-2.5z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function PlatformPowerSwitch({ label, accent, active, disabled = false, onToggle }: PlatformPowerSwitchProps) {
  return (
    <button
      type="button"
      className="am-retro-player__power-switch-slot am-retro-player__power-switch-button"
      title={`${label}${active ? '已连接，点击断开' : '未连接，点击扫码登录'}`}
      aria-label={`${label}${active ? '已连接，点击断开' : '未连接，点击扫码登录'}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <div
        className={`am-retro-player__power-switch am-retro-player__power-switch--${accent} ${active ? 'is-on' : 'is-off'}`}
        aria-label={`${label}${active ? '已连接' : '未连接'}`}
      >
        <span className="am-retro-player__power-switch-lens">
          <span className="am-retro-player__power-switch-mark am-retro-player__power-switch-mark--off">O</span>
          <span className="am-retro-player__power-switch-mark am-retro-player__power-switch-mark--on">I</span>
        </span>
      </div>
      <span className="am-retro-player__power-switch-label">{label}</span>
    </button>
  );
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + (radius * Math.cos(angleRad)),
    y: cy + (radius * Math.sin(angleRad)),
  };
}

function describeRingArcPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function resolveBilingualLyricPair(
  originalLyric: ParsedLyric,
  translatedLyric: ParsedLyric,
  currentTimeMs: number,
): [string, string] {
  if (originalLyric.lines.length === 0 && translatedLyric.lines.length === 0) {
    return ['暂无歌词', '等待歌曲开始播放'];
  }

  if (translatedLyric.lines.length === 0) {
    return ['暂无中文歌词', '当前歌曲没有翻译歌词'];
  }

  const originalIndex = getActiveLyricIndex(originalLyric, currentTimeMs);
  const translatedIndex = getActiveLyricIndex(translatedLyric, currentTimeMs);
  const originalLine = originalLyric.lines[originalIndex]?.text || originalLyric.lines[0]?.text || '暂无原文歌词';
  const translatedLine =
    translatedLyric.lines[translatedIndex]?.text || translatedLyric.lines[0]?.text || '暂无中文歌词';
  return [originalLine, translatedLine];
}

function VfdLyricWindow({
  lines,
  mode,
}: {
  lines: [string, string];
  mode: LyricDisplayMode;
}) {
  const currentLine = lines[0].trim() || '暂无歌词';
  const nextLine = lines[1].trim() || currentLine;
  const activeKey = `${currentLine}|${nextLine}`;

  return (
    <div className={`am-retro-player__lyric-viewport ${mode === 'bilingual' ? 'is-bilingual' : ''}`}>
      <div key={activeKey} className="am-retro-player__lyric-stack">
        <p className="am-retro-player__lyric-row am-retro-player__lyric-row--primary">{currentLine}</p>
        <p className="am-retro-player__lyric-row am-retro-player__lyric-row--secondary">{nextLine}</p>
      </div>
    </div>
  );
}

interface DeckShellProps {
  children: React.ReactNode;
}

function DeckShell({ children }: DeckShellProps) {
  return (
    <div className="am-player-shell am-retro-player">
      <div className="am-retro-player__frame">
        <div className="am-retro-player__badge-row">
          <span className="am-retro-player__badge">ALLMusic Retro Deck</span>
          <span className="am-retro-player__badge am-retro-player__badge--muted">Core Transport Linked</span>
        </div>
        {children}
      </div>
    </div>
  );
}

interface DeckDisplayProps {
  coverUrl: string;
  titleLabel: string;
  artistLabel: string;
  isPlaying: boolean;
  isLoading: boolean;
  spectrumLevels: number[];
  lyricLines: [string, string];
  lyricDisplayMode: LyricDisplayMode;
}

function DeckDisplay({
  coverUrl,
  titleLabel,
  artistLabel,
  isPlaying,
  isLoading,
  spectrumLevels,
  lyricLines,
  lyricDisplayMode,
}: DeckDisplayProps) {
  return (
    <div className="am-retro-player__top">
      <div className="am-retro-player__cassette">
        <div className="am-retro-player__cassette-label">Memory Stop System</div>
        <div className="am-retro-player__cassette-window">
          <div className="am-retro-player__cassette-art">
            {coverUrl ? (
              <img src={coverUrl} alt={titleLabel} className="am-retro-player__cassette-image" />
            ) : (
              <span className="am-retro-player__cassette-placeholder">TAPE</span>
            )}
          </div>
          <div className={`am-retro-player__reel am-retro-player__reel--left ${isPlaying ? 'is-spinning' : ''}`} />
          <div className={`am-retro-player__reel am-retro-player__reel--right ${isPlaying ? 'is-spinning' : ''}`} />
        </div>
        <div className="am-retro-player__cassette-state">
          {isLoading ? 'BUFFER...' : isPlaying ? 'PLAY ▷' : 'PAUSE ▌▌'}
        </div>
      </div>

      <div className="am-retro-player__display">
        <div className="am-retro-player__vfd">
          <div className="am-retro-player__vfd-copy">
            <div className="am-retro-player__vfd-title-main" title={titleLabel}>{titleLabel}</div>
            <div className="am-retro-player__vfd-track-row">
              <span className="am-retro-player__vfd-track-tag" title={artistLabel}>{artistLabel}</span>
              <span className={`am-retro-player__vfd-state ${isPlaying ? 'is-live' : ''}`}>
                {isLoading ? 'LOADING' : isPlaying ? 'LIVE' : 'IDLE'}
              </span>
            </div>
            <div className="am-retro-player__vfd-lyrics">
              <VfdLyricWindow lines={lyricLines} mode={lyricDisplayMode} />
            </div>
          </div>
          <DeckSpectrum levels={spectrumLevels} isPlaying={isPlaying} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}

interface DeckSpectrumProps {
  levels: number[];
  isPlaying: boolean;
  isLoading: boolean;
}

function DeckSpectrum({ levels, isPlaying, isLoading }: DeckSpectrumProps) {
  return (
    <div className="am-retro-player__spectrum" aria-hidden="true">
      {levels.map((level, index) => (
        <div key={`spectrum-${index}`} className="am-retro-player__spectrum-bar">
          {Array.from({ length: 10 }, (_, segmentIndex) => {
            const active = segmentIndex < level;
            const className = active
              ? segmentIndex >= 8
                ? 'is-red'
                : segmentIndex >= 5
                  ? 'is-orange'
                  : 'is-cyan'
              : '';
            return (
              <span
                key={`segment-${index}-${segmentIndex}`}
                className={`am-retro-player__spectrum-segment ${active ? 'is-active' : ''} ${className} ${
                  isLoading ? 'is-pulsing' : ''
                } ${!isPlaying && !isLoading ? 'is-idle' : ''}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface DeckTransportControlsProps {
  disabled: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  lyricDisplayMode: LyricDisplayMode;
  modeControls: React.ReactNode;
  onOpenLibrary?: () => void;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onLyricDisplayModeChange: (mode: LyricDisplayMode) => void;
}

interface DeckLyricModeKnobProps {
  disabled: boolean;
  mode: LyricDisplayMode;
  onChange: (mode: LyricDisplayMode) => void;
}

function DeckLyricModeKnob({ disabled, mode, onChange }: DeckLyricModeKnobProps) {
  const activeIndex = LYRIC_MODE_ORDER.indexOf(mode);
  const activeOption = LYRIC_MODE_ORDER[activeIndex] || 'bilingual';

  const cycleMode = () => {
    if (disabled) {
      return;
    }
    const nextMode = LYRIC_MODE_ORDER[(activeIndex + 1) % LYRIC_MODE_ORDER.length] || 'bilingual';
    onChange(nextMode);
  };

  return (
    <div className={`am-retro-player__lyric-selector ${disabled ? 'is-disabled' : ''}`} role="radiogroup" aria-label="歌词显示模式">
      <button
        type="button"
        className="am-retro-player__lyric-knob"
        onClick={cycleMode}
        disabled={disabled}
        title={`歌词模式：${activeOption === 'original' ? '原文' : activeOption === 'translated' ? '中文' : '双语'}`}
        aria-label={`歌词模式：${activeOption === 'original' ? '原文' : activeOption === 'translated' ? '中文' : '双语'}`}
      >
        <div className={`am-retro-player__lyric-knob-shell am-retro-player__knob-shell ${disabled ? 'is-disabled' : ''}`}>
          <div className="am-retro-player__knob-glow am-retro-player__lyric-knob-glow" />
          <div className="am-retro-player__knob" style={{ transform: `rotate(${LYRIC_MODE_ANGLE[mode]}deg)` }}>
            <span className="am-retro-player__knob-indicator" />
          </div>
        </div>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={mode === 'original'}
        className={`am-retro-player__lyric-marker am-retro-player__lyric-marker--original ${mode === 'original' ? 'is-active' : ''}`}
        onClick={() => onChange('original')}
        disabled={disabled}
        title="原文歌词"
        aria-label="原文歌词"
      >
        <span className="am-retro-player__lyric-marker-led" />
        <span className="am-retro-player__lyric-marker-label">ORIG</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={mode === 'translated'}
        className={`am-retro-player__lyric-marker am-retro-player__lyric-marker--translated ${mode === 'translated' ? 'is-active' : ''}`}
        onClick={() => onChange('translated')}
        disabled={disabled}
        title="中文歌词"
        aria-label="中文歌词"
      >
        <span className="am-retro-player__lyric-marker-led" />
        <span className="am-retro-player__lyric-marker-label">CN</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={mode === 'bilingual'}
        className={`am-retro-player__lyric-marker am-retro-player__lyric-marker--bilingual ${mode === 'bilingual' ? 'is-active' : ''}`}
        onClick={() => onChange('bilingual')}
        disabled={disabled}
        title="双语歌词"
        aria-label="双语歌词"
      >
        <span className="am-retro-player__lyric-marker-led" />
        <span className="am-retro-player__lyric-marker-label">A+B</span>
      </button>
    </div>
  );
}

function DeckTransportControls({
  disabled,
  isPlaying,
  isLoading,
  lyricDisplayMode,
  modeControls,
  onOpenLibrary,
  onPrevious,
  onTogglePlay,
  onNext,
  onLyricDisplayModeChange,
}: DeckTransportControlsProps) {
  return (
    <div className="am-retro-player__transport-panel">
      <div className="am-retro-player__transport-segment am-retro-player__transport-segment--controls">
        <div className="am-retro-player__transport-buttons">
          <button
            type="button"
            className="am-retro-player__transport-btn"
            onClick={onPrevious}
            disabled={disabled}
            title="上一首"
            aria-label="上一首"
          >
            <PrevIcon />
          </button>
          <button
            type="button"
            className={`am-retro-player__transport-btn am-retro-player__transport-btn--primary ${isPlaying ? 'is-playing' : ''}`}
            onClick={onTogglePlay}
            disabled={disabled}
            title={isPlaying ? '暂停' : '播放'}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            <span className="am-retro-player__led" />
            {isLoading ? <span className="am-retro-player__loading-dot">...</span> : isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="am-retro-player__transport-btn"
            onClick={onNext}
            disabled={disabled}
            title="下一首"
            aria-label="下一首"
          >
            <NextIcon />
          </button>
        </div>
        <button
          type="button"
          className="am-retro-player__eject-btn"
          onClick={onOpenLibrary}
          title="弹出磁带并打开资料库"
          aria-label="弹出磁带并打开资料库"
        >
          ⏏ EJECT
        </button>
      </div>

      <div className="am-retro-player__transport-segment am-retro-player__transport-segment--modes">
        {modeControls}
      </div>

      <div className="am-retro-player__transport-segment am-retro-player__transport-segment--selector">
        <DeckLyricModeKnob
          disabled={disabled}
          mode={lyricDisplayMode}
          onChange={onLyricDisplayModeChange}
        />
      </div>
    </div>
  );
}

interface DeckModeButtonProps {
  label: string;
  title: string;
  active: boolean;
  accent?: 'green' | 'red';
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function DeckModeButton({
  label,
  title,
  active,
  accent = 'green',
  disabled = false,
  onClick,
  children,
}: DeckModeButtonProps) {
  const previousActiveRef = useRef(active);
  const timeoutIdsRef = useRef<number[]>([]);
  const [pressPhase, setPressPhase] = useState<'idle' | 'pressing' | 'hold' | 'rebound' | 'settled'>(
    active ? 'settled' : 'idle',
  );
  const [isLit, setIsLit] = useState(active);

  useEffect(() => {
    const clearTimers = () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
    };

    if (previousActiveRef.current === active) {
      return clearTimers;
    }

    clearTimers();

    if (active) {
      setIsLit(false);
      setPressPhase('pressing');

      timeoutIdsRef.current.push(
        window.setTimeout(() => {
          setPressPhase('hold');
        }, 140),
      );

      timeoutIdsRef.current.push(
        window.setTimeout(() => {
          setIsLit(true);
          setPressPhase('rebound');
        }, 520),
      );

      timeoutIdsRef.current.push(
        window.setTimeout(() => {
          setPressPhase('settled');
        }, 660),
      );
    } else {
      setIsLit(false);
      setPressPhase('idle');
    }

    previousActiveRef.current = active;
    return clearTimers;
  }, [active]);

  return (
    <div
      className={`am-retro-player__mode-slot ${active ? 'is-active' : ''} ${isLit ? 'is-lit' : ''} ${disabled ? 'is-disabled' : ''} ${accent === 'red' ? 'is-red' : 'is-green'}`}
    >
      <span className="am-retro-player__mode-led" />
      <span className="am-retro-player__mode-label">{label}</span>
      <button
        type="button"
        className={`am-retro-player__mode-btn ${active ? 'is-active' : ''} is-phase-${pressPhase}`}
        title={title}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="am-retro-player__mode-icon-wrap">{children}</span>
      </button>
    </div>
  );
}

interface DeckModeControlsProps {
  hasSong: boolean;
  playMode: PlayMode;
  isMuted: boolean;
  isLiked: boolean;
  likePending: boolean;
  embedded?: boolean;
  onSetPlayMode: (mode: PlayMode) => void;
  onToggleMute: () => void;
  onToggleLike: () => void;
}

function DeckModeControls({
  hasSong,
  playMode,
  isMuted,
  isLiked,
  likePending,
  embedded = false,
  onSetPlayMode,
  onToggleMute,
  onToggleLike,
}: DeckModeControlsProps) {
  return (
    <div className={`am-retro-player__mode-panel ${embedded ? 'is-embedded' : ''}`}>
      <DeckModeButton
        label="LIST"
        title="列表循环"
        active={playMode === 'loop'}
        onClick={() => onSetPlayMode('loop')}
      >
        <RepeatIcon />
      </DeckModeButton>
      <DeckModeButton
        label="SHUF"
        title="随机播放"
        active={playMode === 'shuffle'}
        onClick={() => onSetPlayMode('shuffle')}
      >
        <ShuffleIcon />
      </DeckModeButton>
      <DeckModeButton
        label="ONE"
        title="单曲循环"
        active={playMode === 'loop-one'}
        onClick={() => onSetPlayMode('loop-one')}
      >
        <RepeatOneIcon />
      </DeckModeButton>
      <DeckModeButton
        label="SEQ"
        title="顺序播放"
        active={playMode === 'sequential'}
        onClick={() => onSetPlayMode('sequential')}
      >
        <SequentialIcon />
      </DeckModeButton>
      <DeckModeButton
        label={likePending ? 'SYNC' : 'LIKE'}
        title={isLiked ? '取消喜欢' : '加入喜欢'}
        active={isLiked}
        accent="red"
        disabled={!hasSong || likePending}
        onClick={onToggleLike}
      >
        <HeartIcon />
      </DeckModeButton>
      <DeckModeButton
        label="MUTE"
        title={isMuted ? '取消静音' : '静音'}
        active={isMuted}
        disabled={!hasSong}
        onClick={onToggleMute}
      >
        <MuteIcon muted={isMuted} />
      </DeckModeButton>
    </div>
  );
}

interface DeckVolumeKnobProps {
  volumePercent: number;
  knobAngle: number;
  isMuted: boolean;
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

function DeckVolumeKnob({
  volumePercent,
  knobAngle,
  isMuted,
  disabled,
  onPointerDown,
}: DeckVolumeKnobProps) {
  const activeSegmentCount = isMuted ? 0 : Math.ceil(volumePercent / 10);
  const volumeDisplay = String(Math.min(volumePercent, 99)).padStart(2, '0');
  const groovePath = useMemo(
    () => describeRingArcPath(44, 44, 20, 43, 225, 495),
    [],
  );
  const volumeSegments = useMemo<VolumeSegmentSpec[]>(
    () => Array.from({ length: 10 }, (_, index) => {
      const startAngle = 225 + (index * 27);
      const endAngle = startAngle + 24;
      return {
        active: index < activeSegmentCount,
        path: describeRingArcPath(44, 44, 24, 39, startAngle, endAngle),
        tone: index < 3 ? 'green' : index < 7 ? 'yellow' : 'red',
      };
    }),
    [activeSegmentCount],
  );

  return (
    <div className="am-retro-player__knob-wrap">
      <div
        className={`am-retro-player__knob-shell am-retro-player__knob-shell--volume ${disabled ? 'is-disabled' : ''}`}
        onPointerDown={disabled ? undefined : onPointerDown}
        role="slider"
        aria-label="音量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volumePercent}
        aria-valuetext={isMuted ? '静音' : `${volumePercent}%`}
        tabIndex={disabled ? -1 : 0}
      >
        <div className="am-retro-player__knob-scale" aria-hidden="true">
          <svg viewBox="0 0 88 88" className="am-retro-player__knob-scale-svg">
            <path className="am-retro-player__knob-groove" d={groovePath} />
            {volumeSegments.map((segment, index) => (
              <path
                key={`volume-segment-${index}`}
                className={`am-retro-player__knob-segment am-retro-player__knob-segment--${segment.tone} ${
                  segment.active ? 'is-active' : 'is-idle'
                }`}
                d={segment.path}
              />
            ))}
          </svg>
        </div>
        <div className="am-retro-player__knob" style={{ transform: `rotate(${knobAngle}deg)` }}>
          <span className="am-retro-player__knob-indicator" />
        </div>
      </div>
      <div className="am-retro-player__knob-caption">
        <span>{isMuted ? '00' : volumeDisplay}</span>
      </div>
    </div>
  );
}

interface DeckProgressDialProps {
  progressPercent: number;
  currentLabel: string;
  durationLabel: string;
  duration: number;
  currentTime: number;
  disabled: boolean;
  onSeek: (nextValue: number) => void;
}

function DeckProgressDial({
  progressPercent,
  currentLabel,
  durationLabel,
  duration,
  currentTime,
  disabled,
  onSeek,
}: DeckProgressDialProps) {
  return (
    <div className="am-retro-player__dial-wrap">
      <div className="am-retro-player__dial">
        <div className="am-retro-player__dial-lamp" />
        <div
          className="am-retro-player__dial-needle"
          style={{ left: `calc(24px + (${progressPercent} * (100% - 48px) / 100))` }}
        />
        <div className="am-retro-player__dial-track">
          <div className="am-retro-player__dial-scale" />
          <div className="am-retro-player__dial-time">
            <span>{currentLabel}</span>
            <span>{durationLabel}</span>
          </div>
        </div>
        <input
          type="range"
          className="am-retro-player__dial-input"
          min={0}
          max={duration || 0}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => onSeek(Number(event.target.value))}
          disabled={disabled || duration <= 0}
          aria-label="播放进度"
        />
      </div>
    </div>
  );
}

interface PlayerBarProps {
  localApiReady?: boolean;
  onOpenLibrary?: () => void;
  onTogglePlatform?: (platform: 'netease' | 'qq') => void;
}

export function PlayerBar({
  localApiReady = false,
  onOpenLibrary,
  onTogglePlatform,
}: PlayerBarProps = {}) {
  const users = useAuthStore((state) => state.users);
  const cookies = useAuthStore((state) => state.cookies);
  const localApiServiceState = useLocalApiStatusStore((state) => state.serviceState);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const playMode = usePlayerStore((state) => state.playMode);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const volume = usePlayerStore((state) => state.volume);
  const isMuted = usePlayerStore((state) => state.isMuted);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playNext = usePlayerStore((state) => state.playNext);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const setIsMuted = usePlayerStore((state) => state.setIsMuted);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const setPlayMode = usePlayerStore((state) => state.setPlayMode);
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);
  const likePendingByKey = useSongLikeStore((state) => state.pendingByKey);

  const { toggleSongLike } = useSongLikeAction();
  const { seekTo } = useAudioPlayer();

  const knobRef = useRef<HTMLDivElement | null>(null);
  const lyricRequestSeqRef = useRef(0);
  const [spectrumTick, setSpectrumTick] = useState(0);
  const [lyricText, setLyricText] = useState('');
  const [translatedLyricText, setTranslatedLyricText] = useState('');
  const [lyricDisplayMode, setLyricDisplayMode] = useState<LyricDisplayMode>('bilingual');

  useEffect(() => {
    if (!isPlaying && !isLoading) {
      setSpectrumTick(0);
      return;
    }

    const timer = window.setInterval(() => {
      setSpectrumTick((prev) => prev + 1);
    }, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLoading, isPlaying]);

  useEffect(() => {
    if (!currentSong) {
      lyricRequestSeqRef.current += 1;
      setLyricText('');
      setTranslatedLyricText('');
      return;
    }

    const requestSeq = lyricRequestSeqRef.current + 1;
    lyricRequestSeqRef.current = requestSeq;

    const loadLyrics = async (song: UnifiedSong) => {
      try {
        const result = await libraryService.loadSongLyrics(song, {
          neteaseCookie: cookies.netease,
          qqCookie: cookies.qq,
        });

        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setLyricText(result.lyric || '');
        setTranslatedLyricText(result.translatedLyric || '');
      } catch {
        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setLyricText('');
        setTranslatedLyricText('');
      }
    };

    void loadLyrics(currentSong);
  }, [cookies.netease, cookies.qq, currentSong]);

  const hasSong = Boolean(currentSong);
  const volumePercent = isMuted ? 0 : Math.round(volume * 100);
  const knobAngle = KNOB_MIN_ANGLE + ((KNOB_MAX_ANGLE - KNOB_MIN_ANGLE) * volumePercent) / 100;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const currentLabel = formatDuration(currentTime);
  const durationLabel = formatDuration(duration);
  const isQQConnected = Boolean(users.qq && cookies.qq && localApiServiceState.qq === 'ready');
  const isNeteaseConnected = Boolean(users.netease && cookies.netease && localApiServiceState.netease === 'ready');
  const titleLabel = currentSong?.name || 'INSERT TRACK TO START';
  const artistLabel = currentSong?.artist || 'READY FOR PLAYBACK';
  const coverUrl = currentSong?.coverUrl || '';
  const parsedLyric = useMemo(() => parseLyric(lyricText), [lyricText]);
  const parsedTranslatedLyric = useMemo(() => parseLyric(translatedLyricText), [translatedLyricText]);
  const lyricLines = useMemo(
    () => {
      if (lyricDisplayMode === 'translated') {
        return resolveLyricPair(parsedTranslatedLyric, ['暂无中文歌词', '当前歌曲没有翻译歌词'], currentTime);
      }

      if (lyricDisplayMode === 'bilingual') {
        return resolveBilingualLyricPair(parsedLyric, parsedTranslatedLyric, currentTime);
      }

      return resolveLyricPair(parsedLyric, ['暂无原文歌词', '等待歌曲开始播放'], currentTime);
    },
    [currentTime, lyricDisplayMode, parsedLyric, parsedTranslatedLyric],
  );
  const isLiked = currentSong ? resolveLiked(currentSong) : false;
  const likePending = currentSong ? Boolean(likePendingByKey[getSongLikeKey(currentSong)]) : false;

  const spectrumLevels = useMemo(() => {
    if (!isPlaying && !isLoading) {
      return Array.from({ length: SPECTRUM_BAR_COUNT }, () => 0);
    }

    const seed = Math.floor((currentTime / 120) + spectrumTick + ((currentIndex + 1) * 7));
    return Array.from({ length: SPECTRUM_BAR_COUNT }, (_, index) => {
      const wave = Math.abs(Math.sin((seed + index * 3) / 4));
      const shimmer = Math.abs(Math.cos((seed + index * 5) / 6));
      const base = isLoading ? 3 : 1;
      return Math.max(base, Math.min(10, Math.round((wave * 6) + (shimmer * 3) + 1)));
    });
  }, [currentIndex, currentTime, isLoading, isPlaying, spectrumTick]);

  const commitVolume = useCallback((nextPercent: number) => {
    const safePercent = Math.max(0, Math.min(100, Math.round(nextPercent)));
    const nextVolume = safePercent / 100;
    setVolume(nextVolume);
    if (safePercent <= 0) {
      setIsMuted(true);
      return;
    }
    if (isMuted) {
      setIsMuted(false);
    }
  }, [isMuted, setIsMuted, setVolume]);

  const updateVolumeFromPoint = useCallback((clientX: number, clientY: number) => {
    if (!knobRef.current) {
      return;
    }

    const rect = knobRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;

    let normalized = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (normalized < 0) {
      normalized += 360;
    }
    const signed = normalized > 180 ? normalized - 360 : normalized;
    const clamped = Math.max(KNOB_MIN_ANGLE, Math.min(KNOB_MAX_ANGLE, signed));
    const nextPercent = ((clamped - KNOB_MIN_ANGLE) / (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE)) * 100;
    commitVolume(nextPercent);
  }, [commitVolume]);

  const handleKnobPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerId = event.pointerId;
    knobRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(pointerId);
    updateVolumeFromPoint(event.clientX, event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateVolumeFromPoint(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [updateVolumeFromPoint]);

  const handleToggleLike = useCallback(() => {
    if (!currentSong || likePending) {
      return;
    }
    void toggleSongLike(currentSong, { targetLike: !isLiked });
  }, [currentSong, isLiked, likePending, toggleSongLike]);

  return (
    <DeckShell>
      <div className="am-retro-player__layout">
        <DeckDisplay
          coverUrl={coverUrl}
          titleLabel={titleLabel}
          artistLabel={artistLabel}
          isPlaying={isPlaying}
          isLoading={isLoading}
          spectrumLevels={spectrumLevels}
          lyricLines={lyricLines}
          lyricDisplayMode={lyricDisplayMode}
        />

        <div className="am-retro-player__mid">
          <DeckTransportControls
            disabled={!hasSong}
            isPlaying={isPlaying}
            isLoading={isLoading}
            lyricDisplayMode={lyricDisplayMode}
            modeControls={(
              <DeckModeControls
                hasSong={hasSong}
                playMode={playMode}
                isMuted={isMuted}
                isLiked={isLiked}
                likePending={likePending}
                embedded
                onSetPlayMode={setPlayMode}
                onToggleMute={toggleMute}
                onToggleLike={handleToggleLike}
              />
            )}
            onOpenLibrary={onOpenLibrary}
            onPrevious={playPrevious}
            onTogglePlay={togglePlay}
            onNext={playNext}
            onLyricDisplayModeChange={setLyricDisplayMode}
          />
        </div>

        <div className="am-retro-player__bottom">
          <DeckVolumeKnob
            volumePercent={volumePercent}
            knobAngle={knobAngle}
            isMuted={isMuted}
            disabled={!hasSong}
            onPointerDown={handleKnobPointerDown}
          />
          <DeckProgressDial
            progressPercent={progressPercent}
            currentLabel={currentLabel}
            durationLabel={durationLabel}
            duration={duration}
            currentTime={currentTime}
            disabled={!hasSong}
            onSeek={seekTo}
          />
          <div className="am-retro-player__platform-switches-dock" aria-label="平台连接状态">
            <PlatformPowerSwitch
              label="QQ"
              accent="green"
              active={isQQConnected}
              disabled={!localApiReady && !isQQConnected}
              onToggle={onTogglePlatform ? () => onTogglePlatform('qq') : undefined}
            />
            <PlatformPowerSwitch
              label="NCM"
              accent="red"
              active={isNeteaseConnected}
              disabled={!localApiReady && !isNeteaseConnected}
              onToggle={onTogglePlatform ? () => onTogglePlatform('netease') : undefined}
            />
          </div>
        </div>
      </div>
    </DeckShell>
  );
}
