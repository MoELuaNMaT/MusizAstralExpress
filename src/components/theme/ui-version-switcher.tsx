import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UI_VERSION_OPTIONS, UI_VERSION_SWITCH_ENABLED, useThemeStore, type UiVersion } from '@/stores/theme.store';

interface UiVersionSwitcherProps {
  className?: string;
  compact?: boolean;
  align?: 'left' | 'right';
  open?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  triggerLabel?: string;
}

type UiBridge = {
  switchUiVersion?: (next: UiVersion) => Promise<void>;
};

function resolveUiBridge(): UiBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as Window & { __ALLMUSIC_BRIDGE__?: UiBridge }).__ALLMUSIC_BRIDGE__ || null;
}

export function UiVersionSwitcher({
  className,
  compact = false,
  align = 'right',
  open: controlledOpen,
  onOpenChange,
  triggerLabel,
}: UiVersionSwitcherProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [switchingVersion, setSwitchingVersion] = useState<UiVersion | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const uiVersion = useThemeStore((state) => state.uiVersion);
  const setUiVersion = useThemeStore((state) => state.setUiVersion);
  const open = controlledOpen ?? uncontrolledOpen;

  if (!UI_VERSION_SWITCH_ENABLED) {
    return null;
  }

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const activeVersion = useMemo(() => (
    UI_VERSION_OPTIONS.find((option) => option.id === uiVersion) || UI_VERSION_OPTIONS[0]
  ), [uiVersion]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSwitchVersion = async (next: UiVersion) => {
    if (next === uiVersion || switchingVersion) {
      setOpen(false);
      return;
    }

    setSwitchingVersion(next);
    try {
      const bridge = resolveUiBridge();
      if (bridge && typeof bridge.switchUiVersion === 'function') {
        await bridge.switchUiVersion(next);
      } else {
        setUiVersion(next);
      }
      setOpen(false);
    } finally {
      setSwitchingVersion(null);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Button
        variant="ghost"
        size="sm"
        className="am-ui-version-switcher shrink-0"
        title={triggerLabel || '切换主题'}
        aria-label={triggerLabel || '切换主题'}
        onClick={() => setOpen(!open)}
        disabled={Boolean(switchingVersion)}
      >
        {compact
          ? '主题'
          : triggerLabel
            ? `🎨 ${triggerLabel}`
            : `🎨 ${activeVersion.label}`}
      </Button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-[95] mt-2 w-[20rem] rounded-xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur',
            align === 'left' ? 'left-0' : 'right-0',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">主题中心</p>
            <p className="text-[11px] text-slate-400">共 {UI_VERSION_OPTIONS.length} 个主题</p>
          </div>
          <p className="mb-2 text-[11px] text-slate-400">当前：{activeVersion.icon} {activeVersion.label}</p>

          <div className="grid grid-cols-1 gap-2">
            {UI_VERSION_OPTIONS.map((option) => {
              const selected = option.id === uiVersion;
              const switching = switchingVersion === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left transition',
                    selected
                      ? 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                      : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-violet-300/60 hover:bg-slate-800/80',
                  )}
                  onClick={() => void handleSwitchVersion(option.id)}
                  disabled={Boolean(switchingVersion)}
                >
                  <p className="text-sm font-semibold">
                    {option.icon} {option.label}
                    {switching ? ' · 切换中...' : ''}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
