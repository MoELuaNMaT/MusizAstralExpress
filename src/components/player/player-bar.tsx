import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore, usePlayerStore } from '@/stores';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { libraryService } from '@/services/library.service';
import { formatDuration } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TimedLyricLine {
  timeMs: number;
  text: string;
}

interface ParsedLyric {
  lines: TimedLyricLine[];
  hasTimeline: boolean;
}

type LyricDisplayMode = 'original' | 'translated' | 'bilingual';

const LYRIC_DISPLAY_MODE_STORAGE_KEY = 'allmusic_lyric_display_mode_v1';

const lyricDisplayModeLabelMap: Record<LyricDisplayMode, string> = {
  original: '原',
  translated: '译',
  bilingual: '同',
};

const playModeLabelMap = {
  sequential: '顺序播放',
  loop: '列表循环',
  shuffle: '随机播放',
  'loop-one': '单曲循环',
} as const;

const playModeOrder = ['sequential', 'loop', 'shuffle', 'loop-one'] as const;

interface IconProps {
  className?: string;
}

function PrevIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 19L4 12l7-7v14Z" />
      <path d="M20 5v14" />
    </svg>
  );
}

function NextIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 19l7-7-7-7v14Z" />
      <path d="M4 5v14" />
    </svg>
  );
}

function PlayIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5.5a1 1 0 0 1 1.52-.86l9 6a1 1 0 0 1 0 1.72l-9 6A1 1 0 0 1 8 17.5v-12Z" />
    </svg>
  );
}

function PauseIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="7" y="5" width="4" height="14" rx="1" />
      <rect x="13" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function RepeatIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ShuffleIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5" />
      <path d="M4 20l6.5-6.5" />
      <path d="M21 3l-8.5 8.5" />
      <path d="M16 21h5v-5" />
      <path d="M21 21l-8.5-8.5" />
      <path d="M4 4l3 3" />
    </svg>
  );
}

function ListIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

function RepeatOneIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <path d="M12 8v8" />
    </svg>
  );
}

function VolumeIcon({ className = 'h-4 w-4', level = 1, muted = false }: IconProps & { level?: number; muted?: boolean }) {
  if (muted || level === 0) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5L6 9H3v6h3l5 4V5Z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H3v6h3l5 4V5Z" />
      {level >= 0.1 && <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
      {level >= 0.6 && <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />}
    </svg>
  );
}

function QueueIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
    </svg>
  );
}

function InfoIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function RetryIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.4-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function toMillis(minute: string, second: string, decimal: string | undefined): number {
  const min = Number(minute);
  const sec = Number(second);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) {
    return 0;
  }

  let ms = 0;
  if (decimal) {
    const normalized = decimal.padEnd(3, '0').slice(0, 3);
    ms = Number(normalized);
  }

  return min * 60 * 1000 + sec * 1000 + ms;
}

function parseLyric(rawLyric: string): ParsedLyric {
  const lyric = rawLyric.trim();
  if (!lyric) {
    return { lines: [], hasTimeline: false };
  }

  const timeTagRegex = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  const timedLines: TimedLyricLine[] = [];
  const plainLines: string[] = [];

  for (const rawLine of lyric.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const matches = Array.from(line.matchAll(timeTagRegex));
    const text = line.replace(timeTagRegex, '').trim();

    if (matches.length === 0) {
      if (text) {
        plainLines.push(text);
      }
      continue;
    }

    if (!text) {
      continue;
    }

    for (const match of matches) {
      const [, minute, second, decimal] = match;
      timedLines.push({
        timeMs: toMillis(minute, second, decimal),
        text,
      });
    }
  }

  if (timedLines.length > 0) {
    timedLines.sort((a, b) => a.timeMs - b.timeMs);
    return { lines: timedLines, hasTimeline: true };
  }

  return {
    lines: plainLines.map((text, index) => ({ timeMs: index * 1000, text })),
    hasTimeline: false,
  };
}

function getActiveLyricIndex(parsedLyric: ParsedLyric, currentTimeMs: number): number {
  if (!parsedLyric.hasTimeline || parsedLyric.lines.length === 0) {
    return -1;
  }

  for (let i = 0; i < parsedLyric.lines.length; i += 1) {
    const next = parsedLyric.lines[i + 1];
    if (!next || currentTimeMs < next.timeMs) {
      return i;
    }
  }

  return parsedLyric.lines.length - 1;
}

function findClosestLyricText(parsedLyric: ParsedLyric, timeMs: number, indexHint: number): string {
  if (parsedLyric.lines.length === 0) {
    return '';
  }

  const byIndex = parsedLyric.lines[indexHint];
  if (byIndex) {
    return byIndex.text;
  }

  let closest = parsedLyric.lines[0];
  let minDiff = Math.abs(closest.timeMs - timeMs);
  for (let i = 1; i < parsedLyric.lines.length; i += 1) {
    const current = parsedLyric.lines[i];
    const diff = Math.abs(current.timeMs - timeMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = current;
    }
  }
  return closest.text;
}

function resolveLyricPair(
  parsedLyric: ParsedLyric,
  activeIndex: number,
  currentTimeMs: number,
  fallbackText: string,
): [string, string] {
  if (parsedLyric.lines.length === 0) {
    return [fallbackText, ''];
  }

  if (parsedLyric.hasTimeline && activeIndex >= 0) {
    const currentLine = parsedLyric.lines[activeIndex]?.text || fallbackText;
    const nextLine = parsedLyric.lines[activeIndex + 1]?.text || currentLine;
    return [currentLine, nextLine];
  }

  const currentLineIndex = Math.floor(currentTimeMs / 3000) % parsedLyric.lines.length;
  const nextLineIndex = (currentLineIndex + 1) % parsedLyric.lines.length;
  return [
    parsedLyric.lines[currentLineIndex]?.text || fallbackText,
    parsedLyric.lines[nextLineIndex]?.text || parsedLyric.lines[currentLineIndex]?.text || fallbackText,
  ];
}

function PlayModeIcon({ mode, className = 'h-4 w-4' }: { mode: keyof typeof playModeLabelMap; className?: string }) {
  if (mode === 'shuffle') {
    return <ShuffleIcon className={className} />;
  }
  if (mode === 'loop-one') {
    return <RepeatOneIcon className={className} />;
  }
  if (mode === 'sequential') {
    return <ListIcon className={className} />;
  }
  return <RepeatIcon className={className} />;
}

export function PlayerBar() {
  const [showQueue, setShowQueue] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCoverExpanded, setIsCoverExpanded] = useState(false);
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [detailLyric, setDetailLyric] = useState('');
  const [detailTranslatedLyric, setDetailTranslatedLyric] = useState('');
  const [detailLyricError, setDetailLyricError] = useState<string | null>(null);
  const [isDetailLyricLoading, setIsDetailLyricLoading] = useState(false);
  const [barOriginalLyric, setBarOriginalLyric] = useState('');
  const [barTranslatedLyric, setBarTranslatedLyric] = useState('');
  const [lyricDisplayMode, setLyricDisplayMode] = useState<LyricDisplayMode>(() => {
    if (typeof window === 'undefined') {
      return 'bilingual';
    }
    const storedMode = window.localStorage.getItem(LYRIC_DISPLAY_MODE_STORAGE_KEY);
    return storedMode === 'original' || storedMode === 'translated' || storedMode === 'bilingual'
      ? storedMode
      : 'bilingual';
  });

  const cookies = useAuthStore((state) => state.cookies);

  const currentSong = usePlayerStore((state) => state.currentSong);
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playMode = usePlayerStore((state) => state.playMode);
  const volume = usePlayerStore((state) => state.volume);
  const isMuted = usePlayerStore((state) => state.isMuted);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const isLoading = usePlayerStore((state) => state.isLoading);
  const error = usePlayerStore((state) => state.error);

  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playAt = usePlayerStore((state) => state.playAt);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const setIsMuted = usePlayerStore((state) => state.setIsMuted);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const setPlayMode = usePlayerStore((state) => state.setPlayMode);

  const { seekTo, retryCurrent } = useAudioPlayer();

  const lyricRequestSeqRef = useRef(0);
  const barLyricRequestSeqRef = useRef(0);
  const activeLyricLineRef = useRef<HTMLParagraphElement | null>(null);
  const volumePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isVolumePanelOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (volumePanelRef.current && !volumePanelRef.current.contains(target)) {
        setIsVolumePanelOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVolumePanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVolumePanelOpen]);

  const playModeLabel = playModeLabelMap[playMode];
  const progressMax = Math.max(duration, 0);
  const progressValue = Math.min(Math.max(currentTime, 0), progressMax || 0);

  const currentPositionLabel = useMemo(() => formatDuration(progressValue), [progressValue]);
  const durationLabel = useMemo(() => formatDuration(progressMax), [progressMax]);

  const parsedOriginalLyric = useMemo(() => parseLyric(detailLyric), [detailLyric]);
  const parsedTranslatedLyric = useMemo(() => parseLyric(detailTranslatedLyric), [detailTranslatedLyric]);
  const parsedBarOriginalLyric = useMemo(() => parseLyric(barOriginalLyric), [barOriginalLyric]);
  const parsedBarTranslatedLyric = useMemo(() => parseLyric(barTranslatedLyric), [barTranslatedLyric]);
  const coverMarqueeText = useMemo(() => {
    if (!currentSong) {
      return 'ALLMusic Glam Mode';
    }
    return `${currentSong.name} - ${currentSong.artist || '未知歌手'} · 双平台聚合播放中`;
  }, [currentSong]);

  const activeOriginalLyricIndex = useMemo(
    () => getActiveLyricIndex(parsedOriginalLyric, currentTime),
    [currentTime, parsedOriginalLyric],
  );
  const activeTranslatedLyricIndex = useMemo(
    () => getActiveLyricIndex(parsedTranslatedLyric, currentTime),
    [currentTime, parsedTranslatedLyric],
  );
  const activeBarOriginalLyricIndex = useMemo(
    () => getActiveLyricIndex(parsedBarOriginalLyric, currentTime),
    [currentTime, parsedBarOriginalLyric],
  );
  const activeBarTranslatedLyricIndex = useMemo(
    () => getActiveLyricIndex(parsedBarTranslatedLyric, currentTime),
    [currentTime, parsedBarTranslatedLyric],
  );

  const detailDisplayLines = useMemo(() => {
    if (lyricDisplayMode === 'original') {
      return parsedOriginalLyric.lines.map((line) => ({
        timeMs: line.timeMs,
        line1: line.text,
        line2: '',
      }));
    }
    if (lyricDisplayMode === 'translated') {
      return parsedTranslatedLyric.lines.map((line) => ({
        timeMs: line.timeMs,
        line1: line.text,
        line2: '',
      }));
    }

    if (parsedOriginalLyric.lines.length > 0) {
      return parsedOriginalLyric.lines.map((line, index) => ({
        timeMs: line.timeMs,
        line1: line.text,
        line2: findClosestLyricText(parsedTranslatedLyric, line.timeMs, index),
      }));
    }

    return parsedTranslatedLyric.lines.map((line, index) => ({
      timeMs: line.timeMs,
      line1: findClosestLyricText(parsedOriginalLyric, line.timeMs, index),
      line2: line.text,
    }));
  }, [lyricDisplayMode, parsedOriginalLyric, parsedTranslatedLyric]);

  const activeDetailLyricIndex = useMemo(() => {
    if (lyricDisplayMode === 'original') {
      return activeOriginalLyricIndex;
    }
    if (lyricDisplayMode === 'translated') {
      return activeTranslatedLyricIndex;
    }
    return parsedOriginalLyric.lines.length > 0 ? activeOriginalLyricIndex : activeTranslatedLyricIndex;
  }, [activeOriginalLyricIndex, activeTranslatedLyricIndex, lyricDisplayMode, parsedOriginalLyric.lines.length]);

  const barOriginalPair = useMemo(
    () => resolveLyricPair(parsedBarOriginalLyric, activeBarOriginalLyricIndex, currentTime, ''),
    [activeBarOriginalLyricIndex, currentTime, parsedBarOriginalLyric],
  );
  const barTranslatedPair = useMemo(
    () => resolveLyricPair(parsedBarTranslatedLyric, activeBarTranslatedLyricIndex, currentTime, ''),
    [activeBarTranslatedLyricIndex, currentTime, parsedBarTranslatedLyric],
  );

  const barLyricLines = useMemo(() => {
    const originalLine = barOriginalPair[0] || '';
    const translatedLine = barTranslatedPair[0] || '';

    if (lyricDisplayMode === 'original') {
      return {
        line1: originalLine || translatedLine || '♪ 暂无歌词',
        line2: '',
      };
    }

    if (lyricDisplayMode === 'translated') {
      return {
        line1: translatedLine || originalLine || '♪ 暂无歌词',
        line2: '',
      };
    }

    const line1 = originalLine || translatedLine || '♪ 暂无歌词';
    const line2 = translatedLine && translatedLine !== line1 ? translatedLine : '';
    return { line1, line2 };
  }, [barOriginalPair, barTranslatedPair, lyricDisplayMode]);

  const closeDetail = useCallback(() => {
    lyricRequestSeqRef.current += 1;
    setIsDetailOpen(false);
  }, []);

  const openDetail = useCallback(() => {
    if (!currentSong) {
      return;
    }
    setShowQueue(false);
    setIsDetailOpen(true);
  }, [currentSong]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(LYRIC_DISPLAY_MODE_STORAGE_KEY, lyricDisplayMode);
  }, [lyricDisplayMode]);

  useEffect(() => {
    if (!currentSong) {
      closeDetail();
    }
  }, [closeDetail, currentSong]);

  useEffect(() => {
    if (!currentSong) {
      barLyricRequestSeqRef.current += 1;
      setBarOriginalLyric('');
      setBarTranslatedLyric('');
      return;
    }

    const requestSeq = barLyricRequestSeqRef.current + 1;
    barLyricRequestSeqRef.current = requestSeq;

    const loadBarLyric = async () => {
      try {
        const result = await libraryService.loadSongLyrics(currentSong, {
          neteaseCookie: cookies.netease,
          qqCookie: cookies.qq,
        });

        if (barLyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setBarOriginalLyric(result.lyric || '');
        setBarTranslatedLyric(result.translatedLyric || '');
      } catch {
        if (barLyricRequestSeqRef.current !== requestSeq) {
          return;
        }
        setBarOriginalLyric('');
        setBarTranslatedLyric('');
      }
    };

    void loadBarLyric();
  }, [cookies.netease, cookies.qq, currentSong]);

  useEffect(() => {
    if (!isDetailOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDetail();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDetail, isDetailOpen]);

  useEffect(() => {
    if (!isDetailOpen || !currentSong) {
      return;
    }

    const requestSeq = lyricRequestSeqRef.current + 1;
    lyricRequestSeqRef.current = requestSeq;

    setDetailLyric('');
    setDetailTranslatedLyric('');
    setDetailLyricError(null);
    setIsDetailLyricLoading(true);

    const loadLyrics = async () => {
      try {
        const result = await libraryService.loadSongLyrics(currentSong, {
          neteaseCookie: cookies.netease,
          qqCookie: cookies.qq,
        });

        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setDetailLyric(result.lyric);
        setDetailTranslatedLyric(result.translatedLyric);
        const shouldShowWarning = !result.lyric && !result.translatedLyric && Boolean(result.warning);
        setDetailLyricError(shouldShowWarning ? (result.warning || null) : null);
      } catch (loadError) {
        if (lyricRequestSeqRef.current !== requestSeq) {
          return;
        }

        setDetailLyricError(loadError instanceof Error ? loadError.message : '歌词加载失败，请稍后重试。');
      } finally {
        if (lyricRequestSeqRef.current === requestSeq) {
          setIsDetailLyricLoading(false);
        }
      }
    };

    void loadLyrics();
  }, [cookies.netease, cookies.qq, currentSong, isDetailOpen]);

  useEffect(() => {
    if (!isDetailOpen || activeDetailLyricIndex < 0) {
      return;
    }

    activeLyricLineRef.current?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }, [activeDetailLyricIndex, isDetailOpen]);

  const handlePlayModeSwitch = () => {
    const current = playModeOrder.indexOf(playMode);
    const next = playModeOrder[(current + 1) % playModeOrder.length];
    setPlayMode(next);
  };

  if (!currentSong && queue.length === 0) {
    return null;
  }

  return (
    <>
      {isDetailOpen && currentSong && (
        <div
          className="fixed inset-x-0 bottom-[8.75rem] top-[4.5rem] z-[45] overflow-y-auto bg-slate-950/92 px-3 py-3 backdrop-blur-sm md:px-6 md:py-4"
          onClick={closeDetail}
        >
          <div
            className="mx-auto flex h-full min-h-0 max-w-7xl flex-col rounded-xl border border-slate-700 bg-slate-900/80 p-4 md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
              <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-100">播放详情</p>
                  <p className="truncate text-xs text-slate-400">ESC 可关闭</p>
                </div>
                <Button variant="ghost" size="sm" onClick={closeDetail}>
                  关闭
                </Button>
              </div>

              <div className="min-h-0 grid flex-1 grid-cols-1 gap-6 md:grid-cols-[360px_minmax(0,1fr)]">
                <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 p-6">
                  <div className="relative h-64 w-64 md:h-72 md:w-72">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/30 via-blue-500/20 to-emerald-500/20 blur-2xl" />
                    <img
                      src={currentSong.coverUrl || 'https://p.qlogo.cn/gh/0/0/100'}
                      alt={currentSong.name}
                      className="relative z-10 h-full w-full rounded-full border-4 border-slate-700 object-cover shadow-2xl animate-[spin_18s_linear_infinite]"
                      style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                    />
                  </div>

                  <div className="am-cover-marquee mt-4 w-full" aria-label="播放封面滚动字幕">
                    <div className="am-cover-marquee-track">
                      <span>{coverMarqueeText}</span>
                      <span aria-hidden="true">{coverMarqueeText}</span>
                    </div>
                  </div>

                  <div className="mt-6 w-full space-y-1 text-center">
                    <p className="truncate text-lg font-semibold text-slate-100">{currentSong.name}</p>
                    <p className="truncate text-sm text-slate-300">{currentSong.artist || '未知歌手'}</p>
                    <p className="truncate text-xs text-slate-400">专辑：{currentSong.album || '未知专辑'}</p>
                  </div>
                </div>

                <div className="flex min-h-0 h-full flex-col rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-4 md:px-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200">滚动歌词</p>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 p-0.5">
                        {(Object.keys(lyricDisplayModeLabelMap) as LyricDisplayMode[]).map((mode) => (
                          <Button
                            key={mode}
                            variant={lyricDisplayMode === mode ? 'primary' : 'ghost'}
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setLyricDisplayMode(mode)}
                            title={`切换为${lyricDisplayModeLabelMap[mode]}歌词`}
                          >
                            {lyricDisplayModeLabelMap[mode]}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">{currentPositionLabel} / {durationLabel}</p>
                    </div>
                  </div>

                  {isDetailLyricLoading ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-300">正在加载歌词...</div>
                  ) : detailLyricError ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-rose-300">{detailLyricError}</div>
                  ) : detailDisplayLines.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-400">暂无歌词</div>
                  ) : (
                    <div className="am-hide-scrollbar min-h-0 flex-1 overflow-y-auto pr-2">
                      <div className="space-y-2 py-24">
                        {detailDisplayLines.map((line, index) => {
                          const active = index === activeDetailLyricIndex;
                          const hasSecondLine = lyricDisplayMode === 'bilingual' && Boolean(line.line2);
                          return (
                            <div
                              key={`${line.timeMs}_${line.line1}_${line.line2}_${index}`}
                              ref={active ? activeLyricLineRef : null}
                              className={`text-center transition-all ${
                                active
                                  ? 'scale-[1.02]'
                                  : ''
                              }`}
                            >
                              <p className={`text-sm leading-7 transition-all ${
                                active
                                  ? 'font-semibold text-emerald-300'
                                  : 'text-slate-300'
                              }`}
                              >
                                {line.line1}
                              </p>
                              {hasSecondLine && (
                                <p className={`text-xs leading-6 transition-all ${
                                  active
                                    ? 'text-cyan-200'
                                    : 'text-slate-400'
                                }`}
                                >
                                  {line.line2}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Detail Playback Controls */}
                <div className="mt-4 border-t border-slate-700 pt-4 md:mt-6">
                  <div className="am-player-detail-controls-wrap mx-auto max-w-2xl">
                    <div className="flex flex-col items-center gap-4 md:gap-6">
                      <div className="flex w-full items-center gap-3">
                        <span className="w-10 text-right text-xs font-mono text-slate-400">{currentPositionLabel}</span>
                        <input
                          type="range"
                          min={0}
                          max={progressMax || 0}
                          value={progressValue}
                          onChange={(event) => seekTo(Number(event.target.value))}
                          className="am-player-progress-range flex-1"
                        />
                        <span className="w-10 text-xs font-mono text-slate-400">{durationLabel}</span>
                      </div>
                      <div className="flex w-full flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-2 md:gap-4">
                          <Button variant="ghost" size="sm" onClick={playPrevious} className="h-10 w-10 p-0" title="上一首">
                            <PrevIcon className="h-6 w-6" />
                          </Button>
                          <Button variant="primary" size="sm" onClick={togglePlay} disabled={isLoading} className="h-14 w-14 rounded-full p-0 shadow-lg" title={isPlaying ? '暂停' : '播放'}>
                            {isLoading ? '…' : isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={playNext} className="h-10 w-10 p-0" title="下一首">
                            <NextIcon className="h-6 w-6" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 md:gap-8">
                          <Button variant="ghost" size="sm" onClick={handlePlayModeSwitch} className="flex h-auto flex-col items-center gap-1 py-1" title={playModeLabel}>
                            <PlayModeIcon mode={playMode} className="h-5 w-5" />
                            <span className="text-[10px] font-bold uppercase tracking-tighter opacity-70">{playModeLabel}</span>
                          </Button>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={toggleMute} className="h-9 w-9 p-0" title={isMuted ? '取消静音' : '静音'}>
                              <VolumeIcon className="h-5 w-5" level={volume} muted={isMuted} />
                            </Button>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={isMuted ? 0 : Math.round(volume * 100)}
                              onChange={(event) => {
                                const v = Number(event.target.value) / 100;
                                setVolume(v);
                                if (v > 0 && isMuted) setIsMuted(false);
                              }}
                              className="am-player-volume-range w-24 md:w-32"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      )}

      <div className="am-player-shell fixed bottom-0 left-0 right-0 z-50 border-t border-slate-700 bg-slate-900/95 backdrop-blur">
        <div className="container mx-auto space-y-1 px-4 py-2">
          {error && (
            <div className="flex items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <span className="truncate">{error}</span>
              <Button variant="ghost" size="sm" onClick={retryCurrent} className="inline-flex items-center gap-1">
                <RetryIcon className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          )}

          {currentSong && (
            <div className="flex flex-col gap-1 lg:flex-row lg:items-end">
              <button
                type="button"
                onClick={openDetail}
                className={`group relative flex min-w-0 items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-900/65 px-2 py-1.5 text-left transition-[padding,background-color,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-violet-400/45 hover:bg-slate-800/80 lg:min-h-[92px] lg:w-[360px] lg:overflow-visible ${
                  isCoverExpanded ? 'lg:pl-[14.5rem]' : 'lg:pl-[10.75rem]'
                }`}
                title="打开播放详情"
              >
                <span
                  className={`hidden lg:block absolute h-[22rem] w-[22rem] cursor-pointer transition-[left,top,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isCoverExpanded
                      ? '-top-[13.25rem] left-0 scale-100 opacity-100'
                      : '-top-[11.75rem] left-[-12.5rem] scale-[0.98] opacity-95'
                  }`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsCoverExpanded((prev) => !prev);
                  }}
                  title={isCoverExpanded ? '点击恢复歌词信息布局' : '点击展开完整旋转封面'}
                >
                  <span className="absolute inset-0 rounded-full bg-violet-400/30 blur-3xl" />
                  <img
                    src={currentSong.coverUrl || 'https://p.qlogo.cn/gh/0/0/100'}
                    alt={currentSong.name}
                    className="relative h-full w-full rounded-full border-4 border-violet-300/70 object-cover shadow-[0_0_55px_rgba(167,139,250,0.6)] animate-[spin_18s_linear_infinite]"
                    style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                  />
                </span>
                <img
                  src={currentSong.coverUrl || 'https://p.qlogo.cn/gh/0/0/100'}
                  alt={currentSong.name}
                  className="h-12 w-12 rounded-md object-cover lg:hidden animate-[spin_18s_linear_infinite]"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                />
                <div
                  className={`min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:pt-2 ${
                    isCoverExpanded
                      ? 'lg:max-w-0 lg:scale-90 lg:-translate-x-2 lg:opacity-0'
                      : 'lg:max-w-[12.5rem] lg:scale-100 lg:translate-x-0 lg:opacity-100'
                  }`}
                >
                  <p className="truncate text-base font-semibold text-slate-100 md:text-lg">{currentSong.name}</p>
                  <p className="truncate text-sm text-slate-400 md:text-base">{currentSong.artist || '未知歌手'}</p>
                </div>
              </button>

              <div className="flex-1 min-w-0 space-y-2 lg:-translate-y-3">
                <div className="space-y-0.5 text-center lg:mb-1" aria-label="播放栏歌词">
                  <p className="truncate text-sm font-semibold tracking-wide text-emerald-200 md:text-base">
                    {barLyricLines.line1}
                  </p>
                  {lyricDisplayMode === 'bilingual' && barLyricLines.line2 ? (
                    <p className="truncate text-xs tracking-wide text-cyan-200 md:text-sm">
                      {barLyricLines.line2}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-right text-xs text-slate-400">{currentPositionLabel}</span>
                  <input
                    type="range"
                    min={0}
                    max={progressMax || 0}
                    value={progressValue}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    className="am-player-progress-range flex-1"
                  />
                  <span className="w-12 text-xs text-slate-400">{durationLabel}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePlayModeSwitch}
                    className="inline-flex items-center gap-1"
                    title={playModeLabel}
                    aria-label={playModeLabel}
                  >
                    <PlayModeIcon mode={playMode} />
                    <span className="hidden md:inline">{playModeLabel}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={playPrevious}
                    className="h-9 w-9 p-0 inline-flex items-center justify-center"
                    title="上一首"
                    aria-label="上一首"
                  >
                    <PrevIcon />
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={togglePlay}
                    disabled={isLoading}
                    className="h-10 w-10 rounded-full p-0 inline-flex items-center justify-center"
                    title={isPlaying ? '暂停' : '播放'}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    {isLoading ? '…' : isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={playNext}
                    className="h-9 w-9 p-0 inline-flex items-center justify-center"
                    title="下一首"
                    aria-label="下一首"
                  >
                    <NextIcon />
                  </Button>
                  <div ref={volumePanelRef} className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsVolumePanelOpen((prev) => !prev)}
                      className="h-8 w-8 p-0"
                      title="音量"
                      aria-label="音量"
                      aria-expanded={isVolumePanelOpen}
                    >
                      <VolumeIcon className="h-4 w-4 shrink-0 text-slate-300" level={volume} muted={isMuted} />
                    </Button>
                    {isVolumePanelOpen && (
                      <div className="absolute bottom-full left-1/2 z-20 mb-2 w-44 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/95 p-2 shadow-xl">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={isMuted ? 0 : Math.round(volume * 100)}
                          onChange={(event) => {
                            const v = Number(event.target.value) / 100;
                            setVolume(v);
                            if (v <= 0 && !isMuted) {
                              setIsMuted(true);
                            }
                            if (v > 0 && isMuted) {
                              setIsMuted(false);
                            }
                          }}
                          className="am-player-volume-range w-full"
                        />
                        <p className="mt-1 text-right text-[11px] text-slate-400">
                          {isMuted ? 0 : Math.round(volume * 100)}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 lg:w-[260px] lg:pl-2">
                <div className="flex items-center justify-center lg:justify-end">
                  <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 p-0.5">
                    {(Object.keys(lyricDisplayModeLabelMap) as LyricDisplayMode[]).map((mode) => (
                      <Button
                        key={mode}
                        variant={lyricDisplayMode === mode ? 'primary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setLyricDisplayMode(mode)}
                        title={`切换为${lyricDisplayModeLabelMap[mode]}歌词`}
                      >
                        {lyricDisplayModeLabelMap[mode]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3 lg:justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openDetail}
                    className="h-8 w-8 p-0 inline-flex items-center justify-center"
                    title="详情"
                    aria-label="详情"
                  >
                    <InfoIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowQueue((prev) => !prev)}
                    className="inline-flex items-center gap-1 px-2.5"
                    title={`队列(${queue.length})`}
                    aria-label={`队列(${queue.length})`}
                  >
                    <QueueIcon />
                    <span className="hidden sm:inline">队列</span>
                    <span className="text-xs">({queue.length})</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearQueue}
                    className="h-8 w-8 p-0 inline-flex items-center justify-center"
                    title="清空队列"
                    aria-label="清空队列"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showQueue && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/70 p-2">
              {queue.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-400">播放队列为空。</p>
              ) : (
                queue.map((song, index) => {
                  const active = index === currentIndex;
                  return (
                    <div
                      key={`${song.id}_${index}`}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                        active ? 'bg-blue-500/20 text-blue-100' : 'text-slate-300 hover:bg-slate-800/70'
                      }`}
                    >
                      <button type="button" className="flex-1 truncate text-left" onClick={() => playAt(index)}>
                        {active ? '▶ ' : ''}
                        {song.name} - {song.artist || '未知歌手'}
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-300 inline-flex items-center justify-center"
                        onClick={() => removeFromQueue(index)}
                        title="移出队列"
                        aria-label="移出队列"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
