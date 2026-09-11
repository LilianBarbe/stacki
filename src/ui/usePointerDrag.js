import { useCallback, useEffect, useRef } from 'react';

// Own one drag at a time. Window listeners survive leaving the handle, while
// cancellation, lost focus and unmount always release them and restore the cursor.
export function usePointerDrag() {
  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(), []);
  return useCallback((event, { onMove, onEnd, cursor }) => {
    stopRef.current?.();
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    if (cursor) document.body.style.cursor = cursor;
    let frame = null;
    let latest = null;
    const matches = (e) => e.pointerId == null || pointerId == null || e.pointerId === pointerId;
    const apply = () => {
      frame = null;
      if (!latest) return;
      const next = latest;
      latest = null;
      onMove(next);
    };
    const move = (e) => {
      if (!matches(e)) return;
      latest = e;
      if (frame === null) frame = requestAnimationFrame(apply);
    };
    const stop = (e) => {
      if (e && !matches(e)) return;
      if (frame !== null) cancelAnimationFrame(frame);
      if (e?.type === 'pointerup') latest = e;
      apply();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      if (cursor) document.body.style.cursor = previousCursor;
      stopRef.current = null;
      onEnd?.(e);
    };
    stopRef.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  }, []);
}
