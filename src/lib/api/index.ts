/**
 * Unified API layer (legacy)
 *
 * NOTE:
 * - The current production path uses `src/services/auth.service.ts` and
 *   `src/services/library.service.ts`.
 * - Adapters in `src/lib/api/*` are kept for compatibility and future refactor,
 *   but they are not the active runtime entry.
 */

export { BaseApiAdapter } from './base';

/** @deprecated Use service layer in `src/services/*` instead. */
export { neteaseAdapter, NeteaseAdapter } from './netease/adapter';

/** @deprecated Use service layer in `src/services/*` instead. */
export { qqMusicAdapter, QQMusicAdapter } from './qq/adapter';
