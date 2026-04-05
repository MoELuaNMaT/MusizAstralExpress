export function canUseTauriInvoke(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof tauriInternals?.invoke === 'function';
}

export function isDevRuntime(): boolean {
  return Boolean(import.meta.env?.DEV);
}

function readDevLitePreference(): boolean | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const queryValue = new URLSearchParams(window.location.search).get('devLite');
  if (queryValue === '1' || queryValue === 'true') {
    return true;
  }
  if (queryValue === '0' || queryValue === 'false') {
    return false;
  }

  const stored = window.localStorage.getItem('allmusic_dev_lite');
  if (stored === '1' || stored === 'true') {
    return true;
  }
  if (stored === '0' || stored === 'false') {
    return false;
  }

  return null;
}

export function isDevLiteMode(): boolean {
  const preferred = readDevLitePreference();
  if (typeof preferred === 'boolean') {
    return preferred;
  }
  return isDevRuntime();
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isIpadDesktopUserAgent(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isMobile(): boolean {
  return isMobileUserAgent() || isIpadDesktopUserAgent();
}

export function isLikelyTauriMobileRuntime(): boolean {
  return canUseTauriInvoke() && isMobile();
}
