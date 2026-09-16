import { useCallback, useEffect, useRef } from 'react';

interface DragOptions {
  readonly onMove: (event: PointerEvent) => void;
  readonly onEnd?: (event?: Event) => void;
  readonly cursor?: string;
}
interface DragStart {
  readonly pointerId?: number;
}

// One session owns the listeners and one animation frame. Starting another drag
// releases the previous one before applying its cursor or scheduling more work.
export function usePointerDrag() {
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  return useCallback((event: DragStart, options: DragOptions): void => {
    stopRef.current?.();
    stopRef.current = startPointerDrag(event, options, () => {
      stopRef.current = null;
    });
  }, []);
}

function startPointerDrag(event: DragStart, options: DragOptions, release: () => void): () => void {
  const previousCursor = document.body.style.cursor;
  if (options.cursor) {
    document.body.style.cursor = options.cursor;
  }
  let frame: number | null = null;
  let latest: PointerEvent | null = null;
  const matches = (next: Event): boolean =>
    !('pointerId' in next) ||
    next.pointerId == null ||
    event.pointerId == null ||
    next.pointerId === event.pointerId;
  const apply = (): void => {
    frame = null;
    if (!latest) {
      return;
    }
    const next = latest;
    latest = null;
    options.onMove(next);
  };
  const move = (next: PointerEvent): void => {
    if (!matches(next)) {
      return;
    }
    latest = next;
    if (frame === null) {
      frame = requestAnimationFrame(apply);
    }
  };
  const stop = (next?: Event): void => {
    if (next && !matches(next)) {
      return;
    }
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    apply();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('blur', stop);
    if (options.cursor) {
      document.body.style.cursor = previousCursor;
    }
    release();
    options.onEnd?.(next);
  };
  const up = (next: PointerEvent): void => {
    if (!matches(next)) {
      return;
    }
    latest = next;
    stop(next);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
  return stop;
}
