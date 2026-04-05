import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useAlertStore, type AlertLevel } from '@/stores';

const levelClassMap: Record<AlertLevel, { border: string; badge: string; panel: string }> = {
  error: {
    border: 'border-rose-400/60',
    badge: 'bg-rose-500/20 text-rose-200 border-rose-300/40',
    panel: 'bg-slate-900/95',
  },
  warning: {
    border: 'border-amber-400/60',
    badge: 'bg-amber-500/20 text-amber-200 border-amber-300/40',
    panel: 'bg-slate-900/95',
  },
  info: {
    border: 'border-cyan-400/60',
    badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-300/40',
    panel: 'bg-slate-900/95',
  },
  success: {
    border: 'border-emerald-400/60',
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-300/40',
    panel: 'bg-slate-900/95',
  },
};

const levelLabelMap: Record<AlertLevel, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
  success: '成功',
};

function formatAlertTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(timestamp);
  } catch {
    return '';
  }
}

export function GlobalAlertModal() {
  const queue = useAlertStore((state) => state.queue);
  const dismissCurrent = useAlertStore((state) => state.dismissCurrent);
  const clearAlerts = useAlertStore((state) => state.clearAlerts);

  const currentAlert = queue[0] || null;
  const queueCount = queue.length;

  useEffect(() => {
    if (!currentAlert || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissCurrent();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [currentAlert, dismissCurrent]);

  if (!currentAlert) {
    return null;
  }

  const levelClass = levelClassMap[currentAlert.level];
  const levelLabel = levelLabelMap[currentAlert.level];
  const createdAtLabel = formatAlertTime(currentAlert.createdAt);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          dismissCurrent();
        }
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        className={`w-full max-w-lg rounded-2xl border px-5 py-4 text-slate-100 shadow-2xl ${levelClass.border} ${levelClass.panel}`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${levelClass.badge}`}>
                {levelLabel}
              </span>
              {queueCount > 1 && (
                <span className="text-xs text-slate-400">
                  待处理 {queueCount} 条
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold">{currentAlert.title}</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissCurrent}
            className="h-8 min-h-0 min-w-0 rounded-full px-2 text-xs"
          >
            关闭
          </Button>
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
          {currentAlert.message}
        </p>

        {(currentAlert.source || createdAtLabel) && (
          <p className="mt-3 text-xs text-slate-400">
            {currentAlert.source ? `来源：${currentAlert.source}` : ''}
            {currentAlert.source && createdAtLabel ? ' · ' : ''}
            {createdAtLabel ? `时间：${createdAtLabel}` : ''}
          </p>
        )}

        {currentAlert.detail && (
          <details className="mt-3 rounded-lg border border-slate-700/80 bg-black/15 p-2 text-xs text-slate-300">
            <summary className="cursor-pointer select-none text-slate-200">查看详情</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{currentAlert.detail}</pre>
          </details>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {queueCount > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAlerts}
              className="h-9 min-h-0 rounded-full px-3 text-xs"
            >
              清空全部
            </Button>
          )}
          {currentAlert.onAction && currentAlert.actionLabel && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                try {
                  currentAlert.onAction?.();
                } catch (error) {
                  console.error('[ALLMusic][AlertModal] action failed:', error);
                } finally {
                  dismissCurrent();
                }
              }}
              className="h-9 min-h-0 rounded-full px-3 text-xs"
            >
              {currentAlert.actionLabel}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
