import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import './player4.css';
import { NeonPlaylistView } from './neon-playlist-view';

import { useSongLikeAction } from '@/hooks/useSongLikeAction';
import { useAudioPlayer, useAudioSpectrum } from '@/hooks/useAudioPlayer';
import { useHomeData } from '@/hooks/useHomeData';
import { useHomeHandlers } from '@/hooks/useHomeHandlers';
import { normalizeImageUrl } from '@/lib/image-url';
import { canUseTauriInvoke, isLikelyTauriMobileRuntime } from '@/lib/runtime';
import {
  analyzeLyrics,
  getNextLyricDisplayMode,
  resolveLyricDisplayLines,
  resolvePreferredLyricMode,
  type LyricDisplayMode as ImportedLyricDisplayMode,
} from '@/lib/lyrics';
import { formatDuration } from '@/lib/utils';
import { playSfx } from '@/lib/sfx';
import { authService } from '@/services/auth.service';
import { libraryService } from '@/services/library.service';
import { useAlertStore, useAuthStore, useLocalApiStatusStore, usePlayerStore, useSongLikeStore } from '@/stores';
import type { MusicPlatform, UnifiedPlaylist, UnifiedSong } from '@/types';
import { platformIconUrlMap } from '@/constants/home.constants';
import { getSongLikeKey } from '@/utils/home.utils';

type Player4View = 'deck' | 'playlist';
type Player4Tape = 'liked-stack' | 'daily-stack' | 'search' | 'history';
type LikedTapeSource = 'mixed' | 'qq-liked' | 'netease-liked';
type DailyTapeSource = 'merged' | 'netease' | 'qq';
type TapeThemeKey =
  | LikedTapeSource
  | 'daily-merged'
  | 'daily-netease'
  | 'daily-qq'
  | 'search'
  | 'history';
type LyricDisplayMode = ImportedLyricDisplayMode;

interface TapeTheme {
  title: string;
  color: string;
  gradient: string;
  tapeLabel: string;
}

interface VolumeSegmentSpec {
  active: boolean;
  path: string;
  tone: 'green' | 'yellow' | 'red';
}

interface AuthOverlayProps {
  platform: MusicPlatform | null;
  onClose: () => void;
  onSuccess?: (
    platform: MusicPlatform,
    markTaskReady: (task: 'playlist' | 'daily') => void,
  ) => Promise<void> | void;
}

type WindowControlTone = 'green' | 'yellow' | 'red';

const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;
const LYRIC_ANGLE: Record<LyricDisplayMode, number> = {
  original: -120,
  chinese: 0,
  bilingual: 120,
};
const LIKED_SOURCE_ORDER: LikedTapeSource[] = ['mixed', 'qq-liked', 'netease-liked'];
const DAILY_SOURCE_ORDER: DailyTapeSource[] = ['merged', 'netease', 'qq'];
const TAPE_THEME: Record<TapeThemeKey, TapeTheme> = {
  mixed: { title: '双平台我喜欢', color: '#e06b3c', gradient: 'linear-gradient(135deg, #e06b3c, #5f1038)', tapeLabel: 'Hybrid Likes' },
  'qq-liked': { title: 'QQ 我喜欢', color: '#38f9d7', gradient: 'linear-gradient(135deg, #43e97b, #38f9d7)', tapeLabel: 'QQ Favorites' },
  'netease-liked': { title: '网易云我喜欢', color: '#ff6b6b', gradient: 'linear-gradient(135deg, #ff6b6b, #c44569)', tapeLabel: 'NCM Favorites' },
  'daily-merged': { title: '今日混合推荐', color: '#00f2fe', gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)', tapeLabel: 'Daily Drive' },
  'daily-netease': { title: '网易云今日推荐', color: '#ff7b7b', gradient: 'linear-gradient(135deg, #ff7b7b, #ff4d6d)', tapeLabel: 'NCM Daily' },
  'daily-qq': { title: 'QQ 今日推荐', color: '#6fffe9', gradient: 'linear-gradient(135deg, #43e97b, #62f4d6)', tapeLabel: 'QQ Daily' },
  search: { title: '搜索台', color: '#f6d365', gradient: 'linear-gradient(135deg, #f6d365, #fda085)', tapeLabel: 'Signal Search' },
  history: { title: '播放历史', color: '#9ad0ec', gradient: 'linear-gradient(135deg, #9ad0ec, #3d5a80)', tapeLabel: 'Playback Log' },
};

function cycleTapeSource<T extends string>(current: T, order: readonly T[]): T {
  const activeIndex = order.indexOf(current);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  return order[(safeIndex + 1) % order.length] ?? order[0];
}

type DotCoord = [number, number];

const ICON_PATTERNS: Record<WindowControlTone, DotCoord[]> = {
  green: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  yellow: [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 0], [1, 4],
    [2, 0], [2, 4],
    [3, 0], [3, 4],
    [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
  ],
  red: [[0, 0], [0, 4], [1, 1], [1, 3], [2, 2], [3, 1], [3, 3], [4, 0], [4, 4]],
};

function WindowControlButton({
  tone,
  title,
  onClick,
}: {
  tone: WindowControlTone;
  title: string;
  onClick: () => void;
}) {
  const dots = ICON_PATTERNS[tone];

  return (
    <button type="button" className={`window-control-btn ${tone}`} title={title} aria-label={title} onClick={onClick}>
      <span className="window-control-pixel-grid">
        {dots.map(([row, col], index) => (
          <span
            key={index}
            className="window-control-pixel"
            style={{ gridRow: row + 1, gridColumn: col + 1 }}
          />
        ))}
      </span>
    </button>
  );
}

function WindowControlCluster() {
  const handleWindowAction = useCallback(async (action: 'minimize' | 'close') => {
    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      if (action === 'minimize') {
        await currentWindow.minimize();
        return;
      }

      await currentWindow.close();
    } catch (error) {
      console.error(`[ALLMusic] window action failed: ${action}`, error);
    }
  }, []);

  return (
    <div className="window-control-cluster" role="group" aria-label="窗口控制">
      <WindowControlButton tone="green" title="最小化窗口" onClick={() => void handleWindowAction('minimize')} />
      <WindowControlButton tone="yellow" title="预留按钮" onClick={() => {}} />
      <WindowControlButton tone="red" title="关闭窗口" onClick={() => void handleWindowAction('close')} />
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + (radius * Math.cos(angleRad)), y: cy + (radius * Math.sin(angleRad)) };
}

function describeRingArcPath(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function PlayModeIcon({ mode }: { mode: 'loop' | 'shuffle' | 'loop-one' | 'sequential' | 'like' | 'mute' }) {
  if (mode === 'loop') {
    return (
      <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
        <path d="M17.4 2.5l4.1 4.1-4.1 4.1V8.3H8.2c-1.9 0-3.3 1.4-3.3 3.3v0.1H2.5v-0.1c0-3.2 2.6-5.7 5.7-5.7h9.2V2.5zM6.6 21.5l-4.1-4.1 4.1-4.1v2.4h9.2c1.9 0 3.3-1.4 3.3-3.3v-0.1h2.4v0.1c0 3.2-2.6 5.7-5.7 5.7H6.6v3.4z" fill="currentColor" />
      </svg>
    );
  }

  if (mode === 'shuffle') {
    return (
      <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
        <path d="M16.9 3h4.1v4.1h-2.3V6.8l-4 4-1.7-1.7 3.9-3.9h-0.1V3zM16.9 16.9h0.1l-3.9-3.9 1.7-1.7 4 4v-0.3H21V21h-4.1v-2.3zM3 5.7h3.4l3.1 3.1-1.7 1.7-2.4-2.4H3V5.7zM3 18.3h2.4l7.8-7.8 1.7 1.7-8.5 8.5H3v-2.4z" fill="currentColor" />
      </svg>
    );
  }

  if (mode === 'loop-one') {
    return (
      <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
        <path d="M17.4 2.5l4.1 4.1-4.1 4.1V8.3H8.2c-1.9 0-3.3 1.4-3.3 3.3v0.1H2.5v-0.1c0-3.2 2.6-5.7 5.7-5.7h9.2V2.5zM6.6 21.5l-4.1-4.1 4.1-4.1v2.4h9.2c1.9 0 3.3-1.4 3.3-3.3v-0.1h2.4v0.1c0 3.2-2.6 5.7-5.7 5.7H6.6v3.4zM11 8.2h2.2v7.6H11zM9.1 9.9L12 7l2.9 2.9-1.6 1.6-1.3-1.3-1.3 1.3-1.6-1.6z" fill="currentColor" />
      </svg>
    );
  }

  if (mode === 'sequential') {
    return (
      <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
        <rect x="3" y="4.5" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
        <rect x="3" y="10.4" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
        <rect x="3" y="16.3" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
        <rect x="8" y="5" width="13" height="2.4" rx="1.2" fill="currentColor" />
        <rect x="8" y="10.9" width="13" height="2.4" rx="1.2" fill="currentColor" />
        <rect x="8" y="16.8" width="13" height="2.4" rx="1.2" fill="currentColor" />
      </svg>
    );
  }

  if (mode === 'like') {
    return (
      <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
        <path d="M12 20.8l-1.3-1.2C5.6 14.9 2.5 12 2.5 8.5A4.7 4.7 0 017.2 3.8c1.8 0 3.5.9 4.8 2.4 1.3-1.5 3-2.4 4.8-2.4a4.7 4.7 0 014.7 4.7c0 3.5-3.1 6.4-8.2 11.1L12 20.8z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="mode-icon" aria-hidden="true">
      <path d="M10.8 4.4v15.2L5.8 15H2.6V9h3.2l5-4.6z" fill="currentColor" />
      <path d="M16.2 8.7l1.7-1.7 2.2 2.2L22.3 7l1.7 1.7-2.2 2.2 2.2 2.2-1.7 1.7-2.2-2.2-2.2 2.2-1.7-1.7 2.2-2.2-2.2-2.2z" fill="currentColor" />
    </svg>
  );
}

function ModeSlotButton({
  slotKey,
  label,
  accent,
  active,
  disabled,
  onClick,
  children,
}: {
  slotKey: string;
  label: string;
  accent: 'green' | 'red';
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const previousActiveRef = useRef(active);
  const timeoutIdsRef = useRef<number[]>([]);
  const [phase, setPhase] = useState<'idle' | 'pressing' | 'hold' | 'rebound'>('idle');
  const [lit, setLit] = useState(active);

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
      setLit(false);
      setPhase('pressing');
      timeoutIdsRef.current.push(window.setTimeout(() => setPhase('hold'), 140));
      timeoutIdsRef.current.push(window.setTimeout(() => {
        setLit(true);
        setPhase('rebound');
      }, 420));
      timeoutIdsRef.current.push(window.setTimeout(() => setPhase('idle'), 560));
    } else {
      setLit(false);
      setPhase('idle');
    }

    previousActiveRef.current = active;
    return clearTimers;
  }, [active]);

  return (
    <div className={`mode-slot ${accent} ${active ? 'active' : ''} ${lit ? 'lit' : ''}`} data-slot={slotKey}>
      <span className="mode-led" />
      <span className="mode-label">{label}</span>
      <button
        type="button"
        className={`mode-btn ${active ? `active phase-${phase}` : ''}`}
        onClick={() => { playSfx('button-click'); onClick(); }}
        disabled={disabled}
      >
        {children}
      </button>
    </div>
  );
}

function Player4AuthOverlay({ platform, onClose, onSuccess }: AuthOverlayProps) {
  const setUser = useAuthStore((state) => state.setUser);
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const authStageRef = useRef<'qr' | 'sync' | 'success' | 'error'>('qr');
  const onCloseRef = useRef(onClose);
  const onSuccessRef = useRef(onSuccess);
  const syncProgressRef = useRef(0);
  const phaseTargetRef = useRef(0);
  const phaseCurrentRef = useRef(Math.PI);
  const amplitudeTargetRef = useRef(45);
  const amplitudeCurrentRef = useRef(15);
  const syncLockingRef = useRef(false);
  const syncWaveTickRef = useRef(0);

  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [screenMode, setScreenMode] = useState<'qr' | 'sync' | 'success' | 'error'>('qr');
  const [statusText, setStatusText] = useState('');
  const [ledState, setLedState] = useState<[boolean, boolean]>([false, false]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#39ff14';
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const y = (height / 2) + (Math.sin(x * 0.05 + phaseTargetRef.current) * amplitudeTargetRef.current);
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    const progress = syncProgressRef.current;
    const seekingDrift = Math.sin(syncWaveTickRef.current * 0.08) * (1 - progress) * 1.4;
    const amplitudeDrift = (1 - progress) * (8 + (Math.sin(syncWaveTickRef.current * 0.05) * 5));
    const currentPhase = phaseCurrentRef.current + ((phaseTargetRef.current - phaseCurrentRef.current) * progress) + seekingDrift;
    const currentAmplitude = amplitudeCurrentRef.current + ((amplitudeTargetRef.current - amplitudeCurrentRef.current) * progress) + amplitudeDrift;

    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const baseY = (height / 2) + (Math.sin(x * 0.05 + currentPhase) * currentAmplitude);
      const noise = (Math.random() - 0.5) * 5 * (1 - progress);
      const y = baseY + noise;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    phaseTargetRef.current -= 0.1;
    phaseCurrentRef.current -= 0.1;
    syncWaveTickRef.current += 1;
    if (syncLockingRef.current) {
      syncProgressRef.current = Math.min(1, syncProgressRef.current + 0.012);
    } else {
      syncProgressRef.current = 0.16 + (((Math.sin(syncWaveTickRef.current * 0.08) + 1) / 2) * 0.1);
    }
    animationRef.current = window.requestAnimationFrame(drawWaveform);
  }, []);

  useEffect(() => {
    if (screenMode !== 'sync') {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    syncProgressRef.current = 0.18;
    phaseTargetRef.current = 0;
    phaseCurrentRef.current = Math.PI;
    amplitudeTargetRef.current = 45;
    amplitudeCurrentRef.current = 15;
    syncWaveTickRef.current = 0;
    syncLockingRef.current = false;
    drawWaveform();

    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [drawWaveform, screenMode]);

  useEffect(() => {
    if (!platform) {
      abortRef.current?.abort();
      abortRef.current = null;
      setQrCodeUrl(null);
      setScreenMode('qr');
      authStageRef.current = 'qr';
      setStatusText('');
      setLedState([false, false]);
      syncLockingRef.current = false;
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setQrCodeUrl(null);
    setScreenMode('qr');
    authStageRef.current = 'qr';
    setStatusText('等待扫码连接');
    setLedState([false, false]);
    syncLockingRef.current = false;

    const start = async () => {
      const loginTask = platform === 'netease'
        ? authService.neteaseQRCodeLogin.bind(authService)
        : authService.qqQRCodeLogin.bind(authService);

      try {
        const result = await loginTask(
          (url) => {
            if (controller.signal.aborted) {
              return;
            }
            if (authStageRef.current !== 'qr') {
              return;
            }
            setQrCodeUrl(url);
            setScreenMode('qr');
          },
          (status) => {
            if (controller.signal.aborted) {
              return;
            }
            setStatusText(status);

            if (/已扫码|确认|授权/.test(status)) {
              authStageRef.current = 'sync';
              setScreenMode((prev) => (prev === 'success' ? prev : 'sync'));
              return;
            }

            if (/过期|等待扫码/.test(status)) {
              if (authStageRef.current !== 'qr') {
                return;
              }
              setScreenMode('qr');
              setLedState([false, false]);
              syncLockingRef.current = false;
            }
          },
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        if (!result.success || !result.user || !result.cookie) {
          setScreenMode('error');
          setStatusText(result.error || '二维码登录失败');
          return;
        }

        await setUser(platform, result.user, result.cookie);
        await Promise.resolve();
        await sleep(0);
        setStatusText('登录成功，正在同步资料源');
        setScreenMode('sync');
        authStageRef.current = 'sync';
        setLedState([false, false]);
        syncLockingRef.current = true;

        await onSuccessRef.current?.(platform, (task) => {
          setLedState((previous) => (task === 'playlist'
            ? [true, previous[1]]
            : [previous[0], true]));
        });

        if (controller.signal.aborted) {
          return;
        }

        setScreenMode('success');
        authStageRef.current = 'success';
        setStatusText('资料同步完成');
        await sleep(700);
        onCloseRef.current();
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        syncLockingRef.current = false;
        setScreenMode('error');
        authStageRef.current = 'error';
        setStatusText(error instanceof Error ? error.message : '二维码登录失败');
      }
    };

    void start();

    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [platform, setUser]);

  if (!platform) {
    return null;
  }

  const title = platform === 'netease' ? 'NCM LINK' : 'QQ LINK';
  const showText = screenMode === 'success' || screenMode === 'error';
  const screenText = screenMode === 'success' ? 'SUCCESS' : screenMode === 'error' ? 'FAILED' : '';
  const effectiveStatusText = statusText || (screenMode === 'sync' ? '等待账号确认' : '等待扫码连接');

  return (
    <div
      className="osc-overlay active"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          abortRef.current?.abort();
          onCloseRef.current();
        }
      }}
    >
      <div className="osc-device-shell osc-plastic-texture">
        <button
          type="button"
          className="osc-close"
          onClick={() => {
            abortRef.current?.abort();
            onCloseRef.current();
          }}
          aria-label="关闭扫码弹层"
        >
          ×
        </button>
        <div className="osc-front-bezel osc-plastic-texture">
          <div className="osc-crt-recess">
            <div className="osc-crt-screen">
              <div className="osc-grid-fisheye" />
              <div className="osc-scanlines" />
              <div className="osc-crt-glare" />
              <div className="osc-screen-content">
                {screenMode === 'qr' && (
                  qrCodeUrl ? (
                    <div className="osc-qr-code" title={statusText || '扫码登录'}>
                      <img src={qrCodeUrl} alt="登录二维码" />
                    </div>
                  ) : (
                    <div className="osc-qr-loading" aria-live="polite">
                      <span>LOADING QR</span>
                    </div>
                  )
                )}
                {screenMode === 'sync' && <canvas ref={canvasRef} className="osc-wave" />}
                {showText && <div className="osc-crt-text">{screenText}</div>}
                <div className="osc-status-line">{effectiveStatusText}</div>
              </div>
            </div>
          </div>
          <div className="osc-bottom-panel">
            <div className="osc-brand-text">
              <div className="osc-brand-logo">RetroAuth</div>
              <div className="osc-brand-model">{title}</div>
            </div>
            <div className="osc-indicator-group">
              <div className="osc-led-container">
                <div className={`osc-led ${ledState[0] ? 'active' : ''}`} />
                <div className="osc-led-label">LIKED</div>
              </div>
              <div className="osc-led-container">
                <div className={`osc-led ${ledState[1] ? 'active' : ''}`} />
                <div className="osc-led-label">DAILY</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RetroShell() {
  const data = useHomeData();
  const handlers = useHomeHandlers(data);
  const pushAlert = useAlertStore((state) => state.pushAlert);
  const resolveLiked = useSongLikeStore((state) => state.resolveLiked);
  const likePendingByKey = useSongLikeStore((state) => state.pendingByKey);
  const { toggleSongLike } = useSongLikeAction();
  const { seekTo } = useAudioPlayer();

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

  const localApiServiceState = useLocalApiStatusStore((state) => state.serviceState);

  const [currentView, setCurrentView] = useState<Player4View>('deck');
  const [activeTape, setActiveTape] = useState<Player4Tape>('liked-stack');
  const [likedSource, setLikedSource] = useState<LikedTapeSource>('mixed');
  const [dailySource, setDailySource] = useState<DailyTapeSource>('merged');

  const [authOverlayPlatform, setAuthOverlayPlatform] = useState<MusicPlatform | null>(null);
  const [tapeEjected, setTapeEjected] = useState(false);
  const [deckTransitionBusy, setDeckTransitionBusy] = useState(false);
  const [lyricText, setLyricText] = useState('');
  const [translatedLyricText, setTranslatedLyricText] = useState('');
  const [lyricDisplayMode, setLyricDisplayMode] = useState<LyricDisplayMode>('bilingual');
  const [lyricKnobAngle, setLyricKnobAngle] = useState(() => LYRIC_ANGLE.bilingual);
  const [spectrumTick, setSpectrumTick] = useState(0);
  const [lyricLoadState, setLyricLoadState] = useState<'idle' | 'loading' | 'loaded'>('idle');
  const [surfaceScale, setSurfaceScale] = useState(1);

  const lyricRequestSeqRef = useRef(0);
  const lyricModeSyncRef = useRef<string | null>(null);
  const windowAspectRatioSyncRef = useRef<string | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const scaledSurfaceRef = useRef<HTMLElement | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const lastLoadedPlaylistIdRef = useRef<string | null>(null);


  const currentSongId = currentSong?.id ?? null;
  const hasAnyAuthenticatedPlatform = Boolean(
    (data.users.qq && data.cookies.qq) || (data.users.netease && data.cookies.netease),
  );
  const isQQConnected = Boolean(data.users.qq && data.cookies.qq && localApiServiceState.qq === 'ready');
  const isNeteaseConnected = Boolean(data.users.netease && data.cookies.netease && localApiServiceState.netease === 'ready');
  const currentLikeKey = currentSong ? getSongLikeKey(currentSong) : null;
  const isCurrentLiked = currentSong ? resolveLiked(currentSong) : false;
  const isCurrentLiking = currentLikeKey ? Boolean(likePendingByKey[currentLikeKey]) : false;

  const playlistByTape = useMemo(
    () => ({
      mixed: data.playlists.find((playlist) => playlist.platform === 'merged' && playlist.type === 'liked') ?? null,
      'qq-liked': data.playlists.find((playlist) => playlist.platform === 'qq' && playlist.type === 'liked') ?? null,
      'netease-liked': data.playlists.find((playlist) => playlist.platform === 'netease' && playlist.type === 'liked') ?? null,
    }),
    [data.playlists],
  );

  const preferredLikedSource = useMemo<LikedTapeSource | null>(() => {
    if (playlistByTape.mixed) {
      return 'mixed';
    }
    if (playlistByTape['netease-liked']) {
      return 'netease-liked';
    }
    if (playlistByTape['qq-liked']) {
      return 'qq-liked';
    }
    return null;
  }, [playlistByTape]);

  const activeThemeKey = useMemo<TapeThemeKey>(() => {
    if (activeTape === 'liked-stack') {
      return likedSource;
    }
    if (activeTape === 'daily-stack') {
      return `daily-${dailySource}` as const;
    }
    return activeTape;
  }, [activeTape, dailySource, likedSource]);

  const activeTheme = TAPE_THEME[activeThemeKey];
  const rootThemeStyle = useMemo(
    () => ({
      '--theme-color': activeTheme.color,
      '--theme-gradient': activeTheme.gradient,
    }) as CSSProperties,
    [activeTheme.color, activeTheme.gradient],
  );

  const activePlaylist = useMemo<UnifiedPlaylist | null>(() => {
    if (activeTape !== 'liked-stack') {
      return null;
    }

    if (likedSource === 'qq-liked') {
      return playlistByTape['qq-liked'];
    }
    if (likedSource === 'netease-liked') {
      return playlistByTape['netease-liked'];
    }
    return playlistByTape.mixed;
  }, [activeTape, likedSource, playlistByTape]);

  useEffect(() => {
    if (!preferredLikedSource) {
      return;
    }

    setLikedSource((previous) => {
      if (previous === 'mixed' && playlistByTape.mixed) {
        return previous;
      }
      if (previous === 'qq-liked' && playlistByTape['qq-liked']) {
        return previous;
      }
      if (previous === 'netease-liked' && playlistByTape['netease-liked']) {
        return previous;
      }
      return preferredLikedSource;
    });
  }, [playlistByTape, preferredLikedSource]);

  useEffect(() => {
    if (data.dailySourceTab === dailySource) {
      return;
    }
    data.setDailySourceTab(dailySource);
  }, [dailySource, data]);

  useEffect(() => {
    if (currentView !== 'playlist' || hasAnyAuthenticatedPlatform) {
      return;
    }

    setCurrentView('deck');
    setTapeEjected(false);
  }, [currentView, hasAnyAuthenticatedPlatform]);

  useEffect(() => {
    if (!currentSong) {
      lyricRequestSeqRef.current += 1;
      setLyricText('');
      setTranslatedLyricText('');
      setLyricLoadState('idle');
      lyricModeSyncRef.current = null;
      return;
    }

    // API 未就绪时跳过歌词加载，避免 bootstrap 期间产生 ERR_CONNECTION_REFUSED
    const songPlatform = currentSong.platform as 'netease' | 'qq';
    if (localApiServiceState[songPlatform] !== 'ready') {
      return;
    }

    const requestSeq = lyricRequestSeqRef.current + 1;
    lyricRequestSeqRef.current = requestSeq;
    setLyricLoadState('loading');
    lyricModeSyncRef.current = null;

    const loadLyrics = async (song: UnifiedSong) => {
      try {
        const result = await libraryService.loadSongLyrics(song, {
          neteaseCookie: data.cookies.netease,
          qqCookie: data.cookies.qq,
        });

        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setLyricText(result.lyric || '');
        setTranslatedLyricText(result.translatedLyric || '');
        setLyricLoadState('loaded');
      } catch {
        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }
        setLyricText('');
        setTranslatedLyricText('');
        setLyricLoadState('loaded');
      }
    };

    void loadLyrics(currentSong);
  }, [currentSong, data.cookies.netease, data.cookies.qq, localApiServiceState]);

  useEffect(() => {
    if (!isPlaying && !isLoading && !deckTransitionBusy) {
      setSpectrumTick(0);
      return;
    }

    const timer = window.setInterval(() => {
      setSpectrumTick((prev) => prev + 1);
    }, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, [deckTransitionBusy, isLoading, isPlaying]);

  // 从 data 解构出 effect 实际需要的原子值，避免 data 对象引用变化导致无限循环
  const selectedPlaylistId = data.selectedPlaylist?.id ?? null;
  const playlistDetailSongsLength = data.playlistDetailSongs.length;
  const isDailyLoading = data.isDailyLoading;
  const dailySongsLength = data.dailySongs.length;
  const loadPlaylistDetail = data.loadPlaylistDetail;
  const loadDailyRecommendations = data.loadDailyRecommendations;

  useEffect(() => {
    if (currentView !== 'playlist') {
      return;
    }

    if (activeTape === 'daily-stack') {
      if (!isDailyLoading && dailySongsLength === 0) {
        void loadDailyRecommendations();
      }
      return;
    }

    if (!activePlaylist) {
      return;
    }

    if (likedSource === 'qq-liked' && !isQQConnected) {
      return;
    }

    if (likedSource === 'netease-liked' && !isNeteaseConnected) {
      return;
    }

    // 用 ref 做同步守卫，避免 React 异步状态更新导致重复加载
    if (lastLoadedPlaylistIdRef.current === activePlaylist.id) {
      return;
    }
    lastLoadedPlaylistIdRef.current = activePlaylist.id;
    void loadPlaylistDetail(activePlaylist);
  }, [activePlaylist, activeTape, currentView, dailySongsLength, isDailyLoading, isNeteaseConnected, isQQConnected, likedSource, loadDailyRecommendations, loadPlaylistDetail, playlistDetailSongsLength, selectedPlaylistId]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const lyricAnalysis = useMemo(
    () => analyzeLyrics(lyricText, translatedLyricText),
    [lyricText, translatedLyricText],
  );
  const availableLyricModes = lyricAnalysis.availableModes;

  useEffect(() => {
    if (!currentSong?.id || lyricLoadState !== 'loaded') {
      return;
    }

    const preferredMode = lyricAnalysis.preferredMode;
    if (!preferredMode) {
      return;
    }

    const syncKey = `${currentSong.id}:${lyricAnalysis.availability}`;
    if (lyricModeSyncRef.current === syncKey) {
      return;
    }

    setLyricDisplayMode(preferredMode);
    setLyricKnobAngle((previousAngle) => {
      let nextAngle = LYRIC_ANGLE[preferredMode];
      while (nextAngle - previousAngle > 180) {
        nextAngle -= 360;
      }
      while (nextAngle - previousAngle < -180) {
        nextAngle += 360;
      }
      return nextAngle;
    });
    lyricModeSyncRef.current = syncKey;
  }, [
    currentSong?.id,
    lyricAnalysis,
    lyricLoadState,
  ]);

  const lyricLines = useMemo(() => {
    const resolvedMode = resolvePreferredLyricMode(lyricDisplayMode, lyricAnalysis) || lyricDisplayMode;
    return resolveLyricDisplayLines(resolvedMode, lyricAnalysis, currentTime);
  }, [currentTime, lyricAnalysis, lyricDisplayMode]);

  const updateSurfaceScale = useCallback(() => {
    const stageNode = stageRef.current;
    const surfaceNode = scaledSurfaceRef.current;
    if (!stageNode || !surfaceNode) {
      return;
    }

    const stageWidth = stageNode.clientWidth;
    const stageHeight = stageNode.clientHeight;
    const surfaceWidth = surfaceNode.offsetWidth;
    const surfaceHeight = surfaceNode.offsetHeight;
    if (!stageWidth || !stageHeight || !surfaceWidth || !surfaceHeight) {
      return;
    }

    const nextScale = Math.min(stageWidth / surfaceWidth, stageHeight / surfaceHeight);
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return;
    }

    setSurfaceScale((previousScale) => (
      Math.abs(previousScale - nextScale) > 0.001 ? nextScale : previousScale
    ));

    if (!canUseTauriInvoke() || isLikelyTauriMobileRuntime()) {
      return;
    }

    const ratioSignature = `${surfaceWidth}x${surfaceHeight}`;
    if (windowAspectRatioSyncRef.current === ratioSignature) {
      return;
    }

    windowAspectRatioSyncRef.current = ratioSignature;
    void invoke('sync_main_window_aspect_ratio', {
      width: surfaceWidth,
      height: surfaceHeight,
    }).catch((error) => {
      console.warn('[ALLMusic] failed to sync window aspect ratio:', error);
    });
  }, []);

  useLayoutEffect(() => {
    let frameId: number | null = null;
    const scheduleMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSurfaceScale();
      });
    };

    scheduleMeasure();

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });

    if (stageRef.current) {
      resizeObserver.observe(stageRef.current);
    }
    if (scaledSurfaceRef.current) {
      resizeObserver.observe(scaledSurfaceRef.current);
    }

    window.addEventListener('resize', scheduleMeasure);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [currentView, updateSurfaceScale]);

  const simulatedSpectrumBars = useMemo(() => {
    const playingLike = isPlaying || isLoading || deckTransitionBusy;
    if (!playingLike) {
      return Array.from({ length: 20 }, () => ({ level: 0, peakLevel: 0, tone: 'cyan' as const }));
    }

    const seed = Math.floor((currentTime / 120) + spectrumTick + ((currentIndex + 1) * 7));
    return Array.from({ length: 20 }, (_, index) => {
      const wave = Math.abs(Math.sin((seed + index * 3) / 4));
      const shimmer = Math.abs(Math.cos((seed + index * 5) / 6));
      const base = isLoading || deckTransitionBusy ? 3 : 1;
      const level = Math.max(base, Math.min(12, Math.round((wave * 8) + (shimmer * 4) + 1)));
      const tone = level >= 10 ? 'red' : level >= 6 ? 'yellow' : level >= 3 ? 'green' : 'cyan';
      return {
        level,
        peakLevel: level,
        tone,
      };
    });
  }, [currentIndex, currentTime, deckTransitionBusy, isLoading, isPlaying, spectrumTick]);
  const { bars: realSpectrumBars, available: realSpectrumAvailable } = useAudioSpectrum({
    barCount: 20,
    segmentCount: 12,
    enabled: true,
  });
  const spectrumBars = realSpectrumAvailable ? realSpectrumBars : simulatedSpectrumBars;

  const volumePercent = isMuted ? 0 : Math.round(volume * 100);
  const knobAngle = KNOB_MIN_ANGLE + (((KNOB_MAX_ANGLE - KNOB_MIN_ANGLE) * volumePercent) / 100);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const currentLabel = formatDuration(currentTime);
  const durationLabel = formatDuration(duration);
  const groovePath = useMemo(() => describeRingArcPath(60, 60, 34, 52, 225, 495), []);
  const activeRingCount = isMuted ? 0 : Math.ceil((volumePercent / 100) * 15);

  const ringSegments = useMemo<VolumeSegmentSpec[]>(
    () => Array.from({ length: 15 }, (_, index) => {
      const startAngle = 225 + (index * 18);
      const endAngle = 240 + (index * 18);
      return {
        active: index < activeRingCount,
        path: describeRingArcPath(60, 60, 38, 48, startAngle, endAngle),
        tone: index < 5 ? 'green' : index < 11 ? 'yellow' : 'red',
      };
    }),
    [activeRingCount],
  );

  const titleLabel = currentSong?.name || 'INSERT TRACK TO START';
  const artistLabel = currentSong?.artist || 'READY FOR PLAYBACK';
  const currentPlatform = currentSong?.platform === 'netease' || currentSong?.platform === 'qq' ? currentSong.platform : null;
  const coverUrl = normalizeImageUrl(currentSong?.coverUrl);
  const coverStyle = useMemo<CSSProperties>(() => {
    if (coverUrl) {
      return { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url("${coverUrl}")` };
    }
    return { '--cover-a': '#5f1038', '--cover-b': '#e06b3c' } as CSSProperties;
  }, [coverUrl]);

  const activeSongs = useMemo<UnifiedSong[]>(() => {
    if (activeTape === 'search') {
      return data.filteredSearchResults;
    }
    if (activeTape === 'daily-stack') {
      return data.activeDailySongs;
    }
    if (activeTape === 'history') {
      return data.playerHistory;
    }
    if (activePlaylist && data.selectedPlaylist?.id === activePlaylist.id) {
      return data.playlistDetailSongs;
    }
    return [];
  }, [activePlaylist, activeTape, data.activeDailySongs, data.filteredSearchResults, data.playerHistory, data.playlistDetailSongs, data.selectedPlaylist?.id]);

  const openPlaylistView = useCallback(() => {
    if (!hasAnyAuthenticatedPlatform) {
      pushAlert({
        level: 'warning',
        title: '请先登录账号',
        message: '当前没有可用登录账号，禁止打开歌单资料库。',
        source: 'player4.library.auth-required',
        dedupeKey: 'player4-library-auth-required',
      });
      return;
    }

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    setTapeEjected(true);
    playSfx('tape-insert');
    transitionTimerRef.current = window.setTimeout(() => {
      setCurrentView('playlist');
      transitionTimerRef.current = null;
    }, 600);
  }, [hasAnyAuthenticatedPlatform, pushAlert]);

  const returnToDeckWithInsert = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }

    setDeckTransitionBusy(true);
    setCurrentView('deck');
    setTapeEjected(true);
    playSfx('tape-insert');
    transitionTimerRef.current = window.setTimeout(() => {
      playSfx('tape-insert');
      setTapeEjected(false);
      transitionTimerRef.current = window.setTimeout(() => {
        setDeckTransitionBusy(false);
        transitionTimerRef.current = null;
      }, 520);
    }, 50);
  }, []);

  /** 上一首/下一首：弹出磁带 → 切歌 → 插入磁带 */
  const playTrackWithTapeTransition = useCallback((direction: 'next' | 'prev') => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    setTapeEjected(true);
    playSfx('tape-insert');
    transitionTimerRef.current = window.setTimeout(() => {
      // 磁带弹出后切换曲目（此时磁带已遮住封面，用户看不到切换）
      if (direction === 'next') {
        playNext();
      } else {
        playPrevious();
      }
      // 短暂延迟后插入磁带
      transitionTimerRef.current = window.setTimeout(() => {
        playSfx('tape-insert');
        setTapeEjected(false);
        transitionTimerRef.current = null;
      }, 150);
    }, 350);
  }, [playNext, playPrevious]);

  const handleTapeSelect = useCallback((nextTape: Player4Tape) => {
    if (nextTape === activeTape) {
      if (nextTape === 'liked-stack') {
        setLikedSource((prev) => cycleTapeSource(prev, LIKED_SOURCE_ORDER));
      } else if (nextTape === 'daily-stack') {
        setDailySource((prev) => cycleTapeSource(prev, DAILY_SOURCE_ORDER));
      }
      return;
    }

    setActiveTape(nextTape);
  }, [activeTape]);

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
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const dx = clientX - centerX;
    const dy = clientY - centerY;

    let normalized = ((Math.atan2(dy, dx) * 180) / Math.PI) + 90;
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

  const handleTogglePlatform = useCallback(async (platform: MusicPlatform) => {
    const connected = platform === 'qq' ? isQQConnected : isNeteaseConnected;

    if (connected) {
      await data.removeUser(platform);
      return;
    }

    if (!data.isLocalApiReady) {
      pushAlert({
        level: 'warning',
        title: '本地服务尚未就绪',
        message: '本地 API 启动完成前，扫码登录入口不可用。',
        source: `player4.auth.pending.${platform}`,
        dedupeKey: `player4-auth-pending:${platform}`,
      });
      return;
    }

    setAuthOverlayPlatform(platform);
  }, [data, isNeteaseConnected, isQQConnected, pushAlert]);

  const handlePlaySongs = useCallback((songs: UnifiedSong[], index: number) => {
    if (songs.length === 0 || index < 0 || index >= songs.length) {
      return;
    }
    handlers.handlePlaySong(songs, index, { forcePlay: true });
    returnToDeckWithInsert();
  }, [handlers, returnToDeckWithInsert]);

  const handleCurrentLike = useCallback(() => {
    if (!currentSong || isCurrentLiking) {
      return;
    }
    void toggleSongLike(currentSong, { targetLike: !isCurrentLiked });
  }, [currentSong, isCurrentLiked, isCurrentLiking, toggleSongLike]);

  const moveLyricKnobToMode = useCallback((
    nextMode: LyricDisplayMode,
    motion: 'nearest' | 'clockwise' = 'nearest',
  ) => {
    if (!availableLyricModes.includes(nextMode)) {
      return;
    }

    setLyricDisplayMode(nextMode);
    setLyricKnobAngle((previousAngle) => {
      const targetBaseAngle = LYRIC_ANGLE[nextMode];

      if (motion === 'clockwise') {
        let nextAngle = targetBaseAngle;
        while (nextAngle <= previousAngle) {
          nextAngle += 360;
        }
        return nextAngle;
      }

      let nextAngle = targetBaseAngle;
      while (nextAngle - previousAngle > 180) {
        nextAngle -= 360;
      }
      while (nextAngle - previousAngle < -180) {
        nextAngle += 360;
      }
      return nextAngle;
    });
  }, [availableLyricModes]);

  const handleAuthSuccess = useCallback(async (
    platform: MusicPlatform,
    markTaskReady: (task: 'playlist' | 'daily') => void,
  ) => {
    await Promise.all([
      data.loadPlaylists().then((result) => {
        if (!result.success) {
          throw new Error(result.warnings[0] || '喜欢歌单同步失败');
        }

        const hasLikedPlaylist = result.playlists.some((item) => item.platform === platform && item.type === 'liked');
        if (!hasLikedPlaylist) {
          throw new Error(platform === 'qq' ? 'QQ 我喜欢歌单尚未同步完成' : '网易云我喜欢歌单尚未同步完成');
        }

        markTaskReady('playlist');
        return result;
      }),
      data.loadDailyRecommendations({ forceRefresh: true }).then((result) => {
        if (!result.success) {
          throw new Error(result.warnings[0] || '今日推荐同步失败');
        }

        const hasPlatformDaily = result.songs.some((song) => song.platform === platform);
        if (!hasPlatformDaily && result.warnings.length > 0) {
          throw new Error(result.warnings[0] || '今日推荐尚未同步完成');
        }

        markTaskReady('daily');
        return result;
      }),
    ]);
  }, [data]);

  if (!data.mounted && data.isLoading) {
    return (
      <div className="player4-app">
        <div className="player4-stage">
          <div className="deck">
            <div className="badge-row">
              <div className="badge-drag-region" data-tauri-drag-region>
                <span className="badge">ALLMusic Retro Deck</span>
              </div>
              <WindowControlCluster />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player4-app" style={rootThemeStyle}>
      <main className="player4-stage" ref={stageRef}>
        <div className="player4-scale-frame" style={{ '--player-scale': String(surfaceScale) } as CSSProperties}>
        {currentView === 'deck' && (
          <section className="deck" aria-label="ALLMusic 复古车机播放器" ref={scaledSurfaceRef}>
            <div className="badge-row">
              <div className="badge-drag-region" data-tauri-drag-region>
                <span className="badge">ALLMusic Retro Deck</span>
              </div>
              <WindowControlCluster />
            </div>
            <div className="shell">
              <section className="top">
                <div className="panel cassette">
                  <div className="small-label">Memory Stop System</div>
                  <div className="cassette-window">
                    <div className={`tape-wrapper ${tapeEjected ? 'ejected' : ''}`}>
                      <div className="cover" style={coverStyle}>
                        <span className="cover-copy">{currentSong?.album || activeTheme.tapeLabel}</span>
                      </div>
                      <div className="tape-pack left"><div className={`reel ${(isPlaying && !isLoading && !deckTransitionBusy) ? 'spinning' : ''}`} /></div>
                      <div className="tape-pack right"><div className={`reel ${(isPlaying && !isLoading && !deckTransitionBusy) ? 'spinning' : ''}`} /></div>
                    </div>
                  </div>
                  <div className="small-label state">
                    {deckTransitionBusy || isLoading ? 'BUFFER...' : currentSong ? (isPlaying ? 'PLAY ▷' : 'PAUSE ▌▌') : 'IDLE'}
                  </div>
                </div>

                <div className="vfd">
                  <div className="screen-copy">
                    <div className="track-title" title={titleLabel}>{titleLabel}</div>
                    <div className="track-row">
                      <span className="track-artist" title={artistLabel}>{artistLabel}</span>
                      <span className={`track-state ${isPlaying && !deckTransitionBusy ? 'live' : ''}`}>
                        {deckTransitionBusy || isLoading ? 'LOADING' : isPlaying ? 'LIVE' : 'IDLE'}
                      </span>
                    </div>
                    <div className={`lyrics lyric-view ${lyricDisplayMode}`}>
                      <div className="lyric-stack">
                        <p className="lyric-line primary">{lyricLines[0]}</p>
                        <p className="lyric-line secondary">{lyricLines[1]}</p>
                      </div>
                    </div>
                  </div>
                  <div className="vfd-sidecar">
                    <div className="vfd-sidecar-top">
                      {currentPlatform && (
                        <div className={`platform-vfd-logo ${currentPlatform}`}>
                          <img src={platformIconUrlMap[currentPlatform]} alt={currentPlatform === 'qq' ? 'QQ 音乐' : '网易云音乐'} />
                          <span>{currentPlatform === 'qq' ? 'QQ' : 'NCM'}</span>
                        </div>
                      )}
                    </div>
                    <div className="spectrum" aria-hidden="true">
                      {spectrumBars.map((bar, index) => (
                        <div
                          key={`spectrum-${index}`}
                          className={`spec-bar ${!isPlaying && !isLoading && !deckTransitionBusy ? 'idle' : ''}`}
                          style={{ '--peak-level': String(bar.peakLevel) } as CSSProperties}
                        >
                          <span className={`spec-bar-cap ${bar.tone} ${bar.peakLevel > 0.2 ? 'visible' : ''}`} />
                          <div className="spec-bar-body">
                            {Array.from({ length: 12 }, (_, segmentIndex) => {
                              const filledSegments = bar.level <= 0.16
                                ? 0
                                : Math.max(1, Math.min(12, Math.floor(bar.level + 0.28)));
                              const active = segmentIndex < filledSegments;
                              const headIndex = active
                                ? Math.max(0, Math.min(11, filledSegments - 1))
                                : -1;
                              const crestIndex = headIndex > 0 ? headIndex - 1 : -1;
                              const isHead = active && segmentIndex === headIndex;
                              const isCrest = active && segmentIndex === crestIndex;
                              const trailDepth = headIndex >= 0 ? Math.max(0, headIndex - segmentIndex) : 0;
                              const segOpacity = isHead
                                ? 1
                                : isCrest
                                  ? 0.9
                                  : active
                                  ? Math.max(0.24, 0.66 - (trailDepth * 0.06))
                                  : 1;
                              const segBrightness = isHead
                                ? 1.38
                                : isCrest
                                  ? 1.16
                                  : active
                                  ? Math.max(0.5, 0.8 - (trailDepth * 0.05))
                                  : 1;
                              const segSaturation = isHead
                                ? 1.22
                                : isCrest
                                  ? 1.04
                                  : active
                                  ? Math.max(0.38, 0.7 - (trailDepth * 0.05))
                                  : 1;
                              const tone = segmentIndex >= 10 ? 'red' : segmentIndex >= 6 ? 'yellow' : segmentIndex >= 3 ? 'green' : 'cyan';
                              return (
                                <span
                                  key={`seg-${index}-${segmentIndex}`}
                                  className={`seg ${active ? `on ${tone}` : ''} ${isHead ? 'head' : isCrest ? 'crest' : active ? 'tail' : ''}`}
                                  style={active
                                    ? ({
                                      '--seg-active-opacity': String(segOpacity),
                                      '--seg-brightness': String(segBrightness),
                                      '--seg-saturation': String(segSaturation),
                                    } as CSSProperties)
                                    : undefined}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="transport">
                <div className="transport-segment controls">
                  <div className="transport-buttons">
                    <button type="button" className="transport-btn" title="上一首" onClick={() => playTrackWithTapeTransition('prev')} disabled={!currentSong}>
                      <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M7 5h2v14H7zM11 12l8 6V6z" fill="currentColor" /></svg>
                    </button>
                    <button type="button" className={`transport-btn primary ${isPlaying ? 'playing' : ''}`} title="播放/暂停" onClick={togglePlay} disabled={!currentSong}>
                      <span className="play-led" />
                      {isPlaying ? (
                        <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
                      )}
                    </button>
                    <button type="button" className="transport-btn" title="下一首" onClick={() => playTrackWithTapeTransition('next')} disabled={!currentSong}>
                      <svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><path d="M15 12L7 6v12zM17 5h2v14h-2z" fill="currentColor" /></svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="eject-btn"
                    title={hasAnyAuthenticatedPlatform ? '弹出磁带并选择资料源' : '请先登录至少一个音乐平台'}
                    onClick={openPlaylistView}
                    disabled={!hasAnyAuthenticatedPlatform}
                  >
                    ⏏ EJECT
                  </button>
                </div>

                <div className="transport-segment">
                  <div className="mode-grid">
                    <ModeSlotButton slotKey="loop" label="LIST" accent="green" active={playMode === 'loop'} onClick={() => setPlayMode('loop')}><PlayModeIcon mode="loop" /></ModeSlotButton>
                    <ModeSlotButton slotKey="shuffle" label="SHUF" accent="green" active={playMode === 'shuffle'} onClick={() => setPlayMode('shuffle')}><PlayModeIcon mode="shuffle" /></ModeSlotButton>
                    <ModeSlotButton slotKey="loop-one" label="ONE" accent="green" active={playMode === 'loop-one'} onClick={() => setPlayMode('loop-one')}><PlayModeIcon mode="loop-one" /></ModeSlotButton>
                    <ModeSlotButton slotKey="sequential" label="SEQ" accent="green" active={playMode === 'sequential'} onClick={() => setPlayMode('sequential')}><PlayModeIcon mode="sequential" /></ModeSlotButton>
                    <ModeSlotButton slotKey="liked" label="LIKE" accent="red" active={isCurrentLiked} disabled={!currentSong || isCurrentLiking} onClick={handleCurrentLike}><PlayModeIcon mode="like" /></ModeSlotButton>
                    <ModeSlotButton slotKey="muted" label="MUTE" accent="green" active={isMuted} disabled={!currentSong} onClick={toggleMute}><PlayModeIcon mode="mute" /></ModeSlotButton>
                  </div>
                </div>

                <div className="transport-segment">
                  <div className="lyric-selector" role="radiogroup" aria-label="歌词模式">
                    <button
                      type="button"
                      className="lyric-knob"
                      onClick={() => {
                        const nextMode = getNextLyricDisplayMode(lyricDisplayMode, availableLyricModes);
                        if (nextMode) {
                          moveLyricKnobToMode(nextMode, 'clockwise');
                        }
                      }}
                      disabled={!currentSong || availableLyricModes.length === 0}
                    >
                      <div className="knob" style={{ transform: `rotate(${lyricKnobAngle}deg)` }} />
                    </button>
                    <button
                      type="button"
                      className={`lyric-mark orig ${lyricDisplayMode === 'original' ? 'active' : ''}`}
                      onClick={() => moveLyricKnobToMode('original')}
                      disabled={!currentSong || !availableLyricModes.includes('original')}
                    >
                      <span className="lyric-led" />
                      <span>ORIG</span>
                    </button>
                    <button
                      type="button"
                      className={`lyric-mark cn ${lyricDisplayMode === 'chinese' ? 'active' : ''}`}
                      onClick={() => moveLyricKnobToMode('chinese')}
                      disabled={!currentSong || !availableLyricModes.includes('chinese')}
                    >
                      <span className="lyric-led" />
                      <span>CN</span>
                    </button>
                    <button
                      type="button"
                      className={`lyric-mark ab ${lyricDisplayMode === 'bilingual' ? 'active' : ''}`}
                      onClick={() => moveLyricKnobToMode('bilingual')}
                      disabled={!currentSong || !availableLyricModes.includes('bilingual')}
                    >
                      <span className="lyric-led" />
                      <span>A+B</span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="bottom">
                <div ref={knobRef} className="knob-shell" onPointerDown={currentSong ? handleKnobPointerDown : undefined}>
                  <svg className="ring-svg" viewBox="0 0 120 120" aria-hidden="true">
                    <path className="ring-groove" d={groovePath} />
                    {ringSegments.map((segment, index) => <path key={`ring-${index}`} className={`ring-seg ${segment.tone} ${segment.active ? 'on' : 'off'}`} d={segment.path} />)}
                  </svg>
                  <div className="knob" style={{ transform: `rotate(${knobAngle}deg)` }} />
                  <div className="knob-caption">{String(Math.min(volumePercent, 99)).padStart(2, '0')}</div>
                </div>

                <div className="dial">
                  <div className="dial-lamp" />
                  <div className="dial-needle" style={{ left: `calc(24px + (${progressPercent} * (100% - 48px) / 100))` }} />
                  <div className="dial-track">
                    <div className="dial-scale" />
                  </div>
                  <input className="dial-input" type="range" min={0} max={duration || 0} value={Math.min(currentTime, duration || 0)} disabled={!currentSong || duration <= 0} onChange={(event) => seekTo(Number(event.target.value))} />
                  <div className="dial-time"><span>{currentLabel}</span><span>{durationLabel}</span></div>
                </div>

                <div className="switch-dock">
                  <div className="switch-slot green">
                    <div className="rocker-housing">
                      <button type="button" className="rocker-switch" role="switch" aria-checked={isQQConnected} onClick={() => void handleTogglePlatform('qq')}>
                        <div className="rocker-face"><span className="rocker-mark">I</span><span className="rocker-mark">O</span></div>
                      </button>
                    </div>
                    <span className="switch-label">QQ</span>
                  </div>
                  <div className="switch-slot red">
                    <div className="rocker-housing">
                      <button type="button" className="rocker-switch" role="switch" aria-checked={isNeteaseConnected} onClick={() => void handleTogglePlatform('netease')}>
                        <div className="rocker-face"><span className="rocker-mark">I</span><span className="rocker-mark">O</span></div>
                      </button>
                    </div>
                    <span className="switch-label">NCM</span>
                  </div>
                </div>
              </section>
            </div>
          </section>
        )}
        </div>
      </main>

      {currentView === 'playlist' && (
        <NeonPlaylistView
          activeTape={activeTape}
          onSelectTape={(tape) => handleTapeSelect(tape as Player4Tape)}
          songs={activeSongs}
          currentSongId={currentSongId}
          isPlaying={isPlaying}
          onPlaySong={(index) => handlePlaySongs(activeSongs, index)}
          resolveLiked={resolveLiked}
          likingSongIds={data.likingSongIds}
          onLikeSong={handlers.handleLikeSongAction}
          onReturnToDeck={returnToDeckWithInsert}
          likedSource={likedSource}
          dailySource={dailySource}
          keyword={data.keyword}
          setKeyword={data.setKeyword}
          isSearching={data.isSearching}
          searchPlatformFilter={data.searchPlatformFilter}
          setSearchPlatformFilter={(v) => data.setSearchPlatformFilter(v as 'all' | 'netease' | 'qq')}
          searchSuggestions={data.searchSuggestions}
          searchHistory={data.searchHistory}
          searchWarnings={data.searchWarnings}
          searchError={data.searchError}
          onSearch={handlers.handleSearch}
          onApplySearchKeyword={handlers.handleApplySearchKeyword}
          onClearSearchHistory={handlers.handleClearSearchHistory}
        />
      )}

      <Player4AuthOverlay platform={authOverlayPlatform} onClose={() => setAuthOverlayPlatform(null)} onSuccess={handleAuthSuccess} />
    </div>
  );
}
