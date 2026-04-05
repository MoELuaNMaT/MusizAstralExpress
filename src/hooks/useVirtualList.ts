import { useCallback, useEffect, useState } from 'react';

interface UseVirtualListOptions {
  itemCount: number;
  estimatedItemHeight?: number;
  overscan?: number;
  resetKey?: string | number | null;
}

interface UseVirtualListResult {
  containerRef: (node: HTMLDivElement | null) => void;
  measureRef: (node: HTMLDivElement | null) => void;
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  itemHeight: number;
}

const DEFAULT_ESTIMATED_ITEM_HEIGHT = 80;
const DEFAULT_OVERSCAN = 8;

export function useVirtualList({
  itemCount,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  resetKey = null,
}: UseVirtualListOptions): UseVirtualListResult {
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeEstimatedHeight = Math.max(1, Math.round(estimatedItemHeight));

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [measureEl, setMeasureEl] = useState<HTMLDivElement | null>(null);
  const [itemHeight, setItemHeight] = useState(safeEstimatedHeight);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    setItemHeight(safeEstimatedHeight);
  }, [safeEstimatedHeight]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    setMeasureEl(node);
  }, []);

  useEffect(() => {
    if (!measureEl) {
      return;
    }

    const syncMeasuredHeight = () => {
      const measuredHeight = Math.max(
        safeEstimatedHeight,
        Math.ceil(measureEl.getBoundingClientRect().height),
      );
      setItemHeight((prev) => (Math.abs(prev - measuredHeight) >= 1 ? measuredHeight : prev));
    };

    syncMeasuredHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(syncMeasuredHeight);
      observer.observe(measureEl);
    }

    return () => {
      observer?.disconnect();
    };
  }, [measureEl, safeEstimatedHeight]);

  useEffect(() => {
    if (!containerEl) {
      setScrollTop(0);
      setViewportHeight(0);
      return;
    }

    const syncViewport = () => {
      setViewportHeight(containerEl.clientHeight);
    };
    const syncScroll = () => {
      setScrollTop(containerEl.scrollTop);
    };

    syncViewport();
    syncScroll();
    containerEl.addEventListener('scroll', syncScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(syncViewport);
      observer.observe(containerEl);
    }

    return () => {
      containerEl.removeEventListener('scroll', syncScroll);
      observer?.disconnect();
    };
  }, [containerEl]);

  useEffect(() => {
    if (!containerEl) {
      return;
    }
    containerEl.scrollTop = 0;
    setScrollTop(0);
  }, [containerEl, resetKey]);

  const [range, setRange] = useState({ startIndex: 0, endIndex: 0 });

  useEffect(() => {
    if (itemCount <= 0) {
      setRange({ startIndex: 0, endIndex: 0 });
      return;
    }
    const visibleHeight = viewportHeight > 0 ? viewportHeight : itemHeight;
    const rawStart = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.max(1, Math.ceil(visibleHeight / itemHeight));
    const nextStart = Math.max(0, rawStart - safeOverscan);
    const nextEnd = Math.min(itemCount, rawStart + visibleCount + safeOverscan);

    setRange((prev) => {
      if (prev.startIndex === nextStart && prev.endIndex === nextEnd) return prev;
      return { startIndex: nextStart, endIndex: nextEnd };
    });
  }, [itemCount, itemHeight, safeOverscan, scrollTop, viewportHeight]);

  return {
    containerRef,
    measureRef,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    totalHeight: Math.max(0, itemCount * itemHeight),
    itemHeight,
  };
}
