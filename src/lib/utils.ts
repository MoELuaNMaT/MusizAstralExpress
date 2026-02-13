import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format duration (ms) to readable time
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Generate unique ID for unified song
 */
export function generateSongId(platform: string, originalId: string): string {
  return `${platform}_${originalId}`;
}

/**
 * Parse unified song ID to get platform and original ID
 */
export function parseSongId(id: string): { platform: string; originalId: string } {
  const [platform, ...rest] = id.split('_');
  return { platform, originalId: rest.join('_') };
}

/**
 * Get platform display name
 */
export function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    netease: '网易云音乐',
    qq: 'QQ音乐',
    merged: '合并',
  };
  return names[platform] || platform;
}

/**
 * Get platform color for UI
 */
export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    netease: '#ec4141',
    qq: '#31c27c',
    merged: '#6b7280',
  };
  return colors[platform] || '#6b7280';
}
