import { useToastStore, type ToastLevel } from '@/stores';

const levelClassMap: Record<ToastLevel, { border: string; badge: string; panel: string }> = {
  info: {
    border: 'border-cyan-400/70',
    badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-300/40',
    panel: 'bg-slate-900/95',
  },
  success: {
    border: 'border-emerald-400/70',
    badge: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/40',
    panel: 'bg-slate-900/95',
  },
  warning: {
    border: 'border-amber-400/70',
    badge: 'bg-amber-500/20 text-amber-100 border-amber-300/40',
    panel: 'bg-slate-900/95',
  },
  error: {
    border: 'border-rose-400/70',
    badge: 'bg-rose-500/20 text-rose-100 border-rose-300/40',
    panel: 'bg-slate-900/95',
  },
};

const levelLabelMap: Record<ToastLevel, string> = {
  info: '提示',
  success: '成功',
  warning: '注意',
  error: '异常',
};

export function TopToastViewport() {
  const queue = useToastStore((state) => state.queue);
  const removeToast = useToastStore((state) => state.removeToast);

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[75] flex w-full max-w-2xl -translate-x-1/2 flex-col gap-2 px-4">
      {queue.map((item) => {
        const levelStyle = levelClassMap[item.level];
        return (
          <section
            key={item.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl backdrop-blur ${levelStyle.panel} ${levelStyle.border}`}
          >
            <div className="flex items-start gap-3">
              <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${levelStyle.badge}`}>
                {levelLabelMap[item.level]}
              </span>
              <div className="min-w-0 flex-1">
                {item.title && (
                  <p className="truncate text-sm font-semibold text-slate-100">{item.title}</p>
                )}
                <p className={`text-sm text-slate-100 ${item.title ? 'mt-0.5' : ''}`}>
                  {item.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(item.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭提示"
              >
                x
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
