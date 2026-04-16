/**
 * 音效播放工具 — 预加载 Audio 实例，确保即时响应。
 * 音频文件放在 public/sfx/ 下，通过 Vite 静态资源服务。
 */

const cache = new Map<string, HTMLAudioElement>();

/** 各音效的音量映射（0.0 ~ 1.0） */
const SFX_VOLUME: Record<SfxName, number> = {
  'button-click': 0.25,
  'tape-insert': 1.0,
};

/** 获取或创建缓存的 Audio 实例，并重置播放进度 */
function getAudio(url: string, volume: number): HTMLAudioElement {
  let audio = cache.get(url);
  if (!audio) {
    audio = new Audio(url);
    cache.set(url, audio);
  }
  audio.currentTime = 0;
  audio.volume = volume;
  return audio;
}

export type SfxName = 'button-click' | 'tape-insert';

/** 播放指定音效，被浏览器自动播放策略拦截时静默忽略 */
export function playSfx(name: SfxName): void {
  getAudio(`/sfx/${name}.wav`, SFX_VOLUME[name]).play().catch(() => {
    /* autoplay blocked or audio unavailable */
  });
}
