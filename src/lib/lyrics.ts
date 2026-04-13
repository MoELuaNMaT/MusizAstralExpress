export type LyricDisplayMode = 'original' | 'chinese' | 'bilingual';
export type LyricAvailability = 'bilingual' | 'chinese-only' | 'original-only' | 'none';

export interface TimedLyricLine {
  timeMs: number;
  text: string;
}

export interface ParsedLyric {
  lines: TimedLyricLine[];
  hasTimeline: boolean;
}

export interface LyricAnalysis {
  availability: LyricAvailability;
  availableModes: LyricDisplayMode[];
  preferredMode: LyricDisplayMode | null;
  original: ParsedLyric;
  chinese: ParsedLyric;
  isOriginalChineseDominant: boolean;
}

const LYRIC_TIME_TAG_REGEX = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
const LYRIC_META_TAG_REGEX = /^\[(?:ti|ar|al|by|offset|length|re|ve|kana|language):.*\]$/i;
const HAN_CHAR_REGEX = /\p{Script=Han}/gu;
const CONTENT_CHAR_REGEX = /[\p{Letter}\p{Number}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const CHINESE_DOMINANT_THRESHOLD = 0.55;

function toMillis(minute: string, second: string, decimal?: string): number {
  const min = Number(minute);
  const sec = Number(second);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) {
    return 0;
  }

  const ms = decimal ? Number(decimal.padEnd(3, '0').slice(0, 3)) || 0 : 0;
  return (min * 60 * 1000) + (sec * 1000) + ms;
}

function normalizeLyricText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isChineseDominantText(text: string): boolean {
  const normalized = normalizeLyricText(text);
  if (!normalized) {
    return false;
  }

  const contentChars = normalized.match(CONTENT_CHAR_REGEX) || [];
  if (contentChars.length === 0) {
    return false;
  }

  const hanChars = normalized.match(HAN_CHAR_REGEX) || [];
  return (hanChars.length / contentChars.length) >= CHINESE_DOMINANT_THRESHOLD;
}

export function parseLyric(rawLyric: string): ParsedLyric {
  const lyric = rawLyric.trim();
  if (!lyric) {
    return { lines: [], hasTimeline: false };
  }

  const timedLines: TimedLyricLine[] = [];
  const plainLines: string[] = [];

  for (const rawLine of lyric.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || LYRIC_META_TAG_REGEX.test(line)) {
      continue;
    }

    const matches = Array.from(line.matchAll(LYRIC_TIME_TAG_REGEX));
    const text = normalizeLyricText(line.replace(LYRIC_TIME_TAG_REGEX, ''));
    if (!text) {
      continue;
    }

    if (matches.length === 0) {
      plainLines.push(text);
      continue;
    }

    for (const match of matches) {
      const [, minute, second, decimal] = match;
      timedLines.push({ timeMs: toMillis(minute, second, decimal), text });
    }
  }

  if (timedLines.length > 0) {
    timedLines.sort((a, b) => a.timeMs - b.timeMs);
    return { lines: timedLines, hasTimeline: true };
  }

  return {
    lines: plainLines.map((text, index) => ({ timeMs: index * 3000, text })),
    hasTimeline: false,
  };
}

function getActiveLyricIndex(parsedLyric: ParsedLyric, currentTimeMs: number): number {
  if (parsedLyric.lines.length === 0) {
    return -1;
  }

  if (!parsedLyric.hasTimeline) {
    return Math.floor(Math.max(0, currentTimeMs) / 3000) % parsedLyric.lines.length;
  }

  for (let index = 0; index < parsedLyric.lines.length; index += 1) {
    const nextLine = parsedLyric.lines[index + 1];
    if (!nextLine || currentTimeMs < nextLine.timeMs) {
      return index;
    }
  }

  return parsedLyric.lines.length - 1;
}

function resolveLyricPair(parsedLyric: ParsedLyric, emptyLabel: [string, string], currentTimeMs: number): [string, string] {
  if (parsedLyric.lines.length === 0) {
    return emptyLabel;
  }

  const activeIndex = getActiveLyricIndex(parsedLyric, currentTimeMs);
  const currentLine = parsedLyric.lines[activeIndex]?.text || parsedLyric.lines[0].text;
  const nextLine = parsedLyric.lines[(activeIndex + 1) % parsedLyric.lines.length]?.text || currentLine;
  return [currentLine, nextLine];
}

export function analyzeLyrics(originalLyricText: string, chineseLyricText: string): LyricAnalysis {
  const original = parseLyric(originalLyricText);
  const chinese = parseLyric(chineseLyricText);
  const originalText = original.lines.map((line) => line.text).join(' ');
  const isOriginalChineseDominant = original.lines.length > 0 && isChineseDominantText(originalText);

  if (original.lines.length === 0 && chinese.lines.length === 0) {
    return {
      availability: 'none',
      availableModes: [],
      preferredMode: null,
      original,
      chinese,
      isOriginalChineseDominant,
    };
  }

  if (chinese.lines.length > 0 && original.lines.length > 0 && !isOriginalChineseDominant) {
    return {
      availability: 'bilingual',
      availableModes: ['original', 'chinese', 'bilingual'],
      preferredMode: 'bilingual',
      original,
      chinese,
      isOriginalChineseDominant,
    };
  }

  if (chinese.lines.length > 0 || isOriginalChineseDominant) {
    return {
      availability: 'chinese-only',
      availableModes: ['chinese'],
      preferredMode: 'chinese',
      original,
      chinese: chinese.lines.length > 0 ? chinese : original,
      isOriginalChineseDominant,
    };
  }

  return {
    availability: 'original-only',
    availableModes: ['original'],
    preferredMode: 'original',
    original,
    chinese,
    isOriginalChineseDominant,
  };
}

export function resolvePreferredLyricMode(
  currentMode: LyricDisplayMode,
  analysis: LyricAnalysis,
): LyricDisplayMode | null {
  if (analysis.availableModes.includes(currentMode)) {
    return currentMode;
  }
  return analysis.preferredMode;
}

export function getNextLyricDisplayMode(
  currentMode: LyricDisplayMode,
  availableModes: LyricDisplayMode[],
): LyricDisplayMode | null {
  if (availableModes.length === 0) {
    return null;
  }

  const currentIndex = availableModes.indexOf(currentMode);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return availableModes[(safeIndex + 1) % availableModes.length] || availableModes[0];
}

export function resolveLyricDisplayLines(
  mode: LyricDisplayMode,
  analysis: LyricAnalysis,
  currentTimeMs: number,
): [string, string] {
  if (analysis.availability === 'none') {
    return ['暂无歌词', '当前歌曲没有可用歌词'];
  }

  if (mode === 'bilingual' && analysis.availability === 'bilingual') {
    const originalIndex = getActiveLyricIndex(analysis.original, currentTimeMs);
    const chineseIndex = getActiveLyricIndex(analysis.chinese, currentTimeMs);
    const originalLine = analysis.original.lines[originalIndex]?.text || analysis.original.lines[0]?.text || '暂无原文歌词';
    const chineseLine = analysis.chinese.lines[chineseIndex]?.text || analysis.chinese.lines[0]?.text || '暂无中文歌词';
    return [originalLine, chineseLine];
  }

  if (mode === 'chinese') {
    return resolveLyricPair(analysis.chinese, ['暂无中文歌词', '当前歌曲没有中文歌词'], currentTimeMs);
  }

  return resolveLyricPair(analysis.original, ['暂无原文歌词', '等待歌曲开始播放'], currentTimeMs);
}
