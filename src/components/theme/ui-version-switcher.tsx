interface UiVersionSwitcherProps {
  className?: string;
  compact?: boolean;
  align?: 'left' | 'right';
  open?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  triggerLabel?: string;
}

/**
 * Legacy shim kept only to avoid breaking stale imports after the app was
 * consolidated into a single Deck UI. New code should not use this component.
 */
export function UiVersionSwitcher(_: UiVersionSwitcherProps) {
  return null;
}
