import { Button } from '@/components/ui/button';
import { text } from '@/constants/home.constants';
import type { PanelTab } from '@/constants/home.constants';

interface MobileBottomNavProps {
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
}

export function MobileBottomNav({ panelTab, setPanelTab }: MobileBottomNavProps) {
  return (
    <nav
      className="am-home-bottom-tabs fixed left-0 right-0 z-40 px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.8rem)' }}
      aria-label="页面主导航"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/85 p-2 backdrop-blur">
        <Button
          variant={panelTab === 'playlists' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setPanelTab('playlists')}
          aria-label={text.panelTabPlaylists}
        >
          {text.panelTabPlaylists}
        </Button>
        <Button
          variant={panelTab === 'daily' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setPanelTab('daily')}
          aria-label={text.panelTabDaily}
        >
          {text.panelTabDaily}
        </Button>
        <Button
          variant={panelTab === 'history' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setPanelTab('history')}
          aria-label={text.panelTabHistory}
        >
          {text.panelTabHistory}
        </Button>
      </div>
    </nav>
  );
}

export type { MobileBottomNavProps };
