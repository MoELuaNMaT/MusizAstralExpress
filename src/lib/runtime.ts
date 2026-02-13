export function canUseTauriInvoke(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriInternals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof tauriInternals?.invoke === 'function';
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isLikelyTauriMobileRuntime(): boolean {
  return canUseTauriInvoke() && isMobileUserAgent();
}
