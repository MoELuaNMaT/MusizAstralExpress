import { localApiErrorHeadline } from '@/lib/local-api-errors';
import type { LocalApiErrorType, LocalApiMissingRequirement, LocalApiServiceState } from '@/types/bridge.types';

export interface LocalApiOverlayProps {
  visible: boolean;
  percent: number;
  message: string;
  logs: string[];
  failed: boolean;
  errorType: LocalApiErrorType | null;
  missingRequirements: LocalApiMissingRequirement[];
  serviceState: Record<'netease' | 'qq', LocalApiServiceState>;
  isAutoFixing: boolean;
  onAutoFix: () => void;
  onRetry: () => void;
  onDismiss?: () => void;
}

const SERVICE_LABEL: Record<LocalApiServiceState, string> = {
  pending: '等待中',
  starting: '启动中',
  installing: '安装依赖中',
  ready: '已就绪',
  error: '异常',
};

const SERVICE_COLOR: Record<LocalApiServiceState, string> = {
  pending: 'text-slate-300',
  starting: 'text-cyan-300',
  installing: 'text-amber-300',
  ready: 'text-emerald-300',
  error: 'text-rose-300',
};

export function LocalApiOverlay({
  visible,
  percent,
  message,
  logs,
  failed,
  errorType,
  missingRequirements,
  serviceState,
  isAutoFixing,
  onAutoFix,
  onRetry,
  onDismiss,
}: LocalApiOverlayProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/20 bg-slate-900/95 p-5 text-slate-100 shadow-2xl backdrop-blur">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="font-medium">
            {failed ? localApiErrorHeadline(errorType || 'unknown') : '本地 API 启动中'}
          </span>
          <span className="text-xs text-slate-300">{percent}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-2 overflow-hidden rounded-full bg-slate-700/80">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              failed ? 'bg-rose-500' : 'bg-cyan-400'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Status message */}
        <p className={`mt-3 text-sm ${failed ? 'text-rose-300' : 'text-slate-200'}`}>
          {message}
        </p>

        {/* Missing requirements panel */}
        {failed && missingRequirements.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs">
            {missingRequirements.map((item) => (
              <div key={item.key} className="space-y-1">
                <p className="font-medium text-rose-100">{item.title}</p>
                <p className="text-rose-200/90">{item.detail}</p>
                {item.install_url && (
                  <a
                    href={item.install_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-md border border-rose-300/40 bg-rose-300/10 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-300/20"
                  >
                    打开安装指引
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Service state cards */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {(['netease', 'qq'] as const).map((service) => {
            const state = serviceState[service];
            return (
              <div key={service} className="rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2">
                <div className="font-medium uppercase tracking-wide text-slate-200">{service}</div>
                <div className={`mt-1 ${SERVICE_COLOR[state]}`}>{SERVICE_LABEL[state]}</div>
              </div>
            );
          })}
        </div>

        {/* Log output */}
        <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
          {logs.length === 0 ? (
            <div>等待日志输出...</div>
          ) : (
            logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)
          )}
        </div>

        {/* Action buttons (only when failed) */}
        {failed && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                disabled={isAutoFixing}
                className="am-touch-target touch-manipulation rounded-lg border border-slate-400/40 bg-slate-500/20 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-500/30"
              >
                跳过
              </button>
            )}
            {missingRequirements.length > 0 && (
              <button
                type="button"
                onClick={() => void onAutoFix()}
                disabled={isAutoFixing}
                className="am-touch-target touch-manipulation rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAutoFixing ? '自动修复中...' : '自动修复（推荐）'}
              </button>
            )}
            <button
              type="button"
              onClick={onRetry}
              disabled={isAutoFixing}
              className="am-touch-target touch-manipulation rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
            >
              重试启动
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
