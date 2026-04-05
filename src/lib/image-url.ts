/**
 * 图片 URL 处理工具
 * 统一将 http:// 协议升级为 https://，避免 CSP 混合内容阻止
 */

/**
 * 将图片 URL 从 http:// 升级为 https://
 * 用于解决便携版中 CSP 阻止 http 图片加载的问题
 */
export function normalizeImageUrl(url: string | null | undefined): string {
  if (!url) {
    return '';
  }

  const trimmed = typeof url === 'string' ? url.trim() : String(url);
  if (!trimmed) {
    return '';
  }

  // 将 http:// 升级为 https://
  return trimmed.replace(/^http:\/\//i, 'https://');
}
