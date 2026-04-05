import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { THEME_OPTIONS, useThemeStore } from '@/stores/theme.store';

interface ThemeSwitcherProps {
  className?: string;
  compact?: boolean;
  align?: 'left' | 'right';
}

export function ThemeSwitcher({ className, compact = false, align = 'right' }: ThemeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentTheme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const activeTheme = useMemo(() => {
    return THEME_OPTIONS.find((option) => option.id === currentTheme) || THEME_OPTIONS[0];
  }, [currentTheme]);

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

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Button
        variant="ghost"
        size="sm"
        className="am-ui-version-switcher shrink-0"
        title="切换主题"
        aria-label="切换主题"
        onClick={() => setOpen((prev) => !prev)}
      >
        {compact ? '🎨' : `🎨 ${activeTheme.label}`}
      </Button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-[95] mt-2 w-[18.5rem] rounded-xl border border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur',
            align === 'left' ? 'left-0' : 'right-0'
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">主题外观</p>
            <p className="text-[11px] text-slate-400">共 {THEME_OPTIONS.length} 种</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((option) => {
              const selected = option.id === currentTheme;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left transition',
                    selected
                      ? 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                      : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-violet-300/60 hover:bg-slate-800/80'
                  )}
                  onClick={() => {
                    setTheme(option.id);
                    setOpen(false);
                  }}
                >
                  <p className="text-sm font-semibold">{option.icon} {option.label}</p>
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
