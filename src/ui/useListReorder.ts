import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, MutableRefObject, RefCallback } from 'react';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';

interface ReorderOptions {
  readonly count: number;
  readonly onMove: (source: number, target: number) => void;
  readonly disabled?: boolean;
}
interface ReorderState {
  readonly rows: MutableRefObject<(HTMLElement | null)[]>;
  readonly start: MutableRefObject<{ readonly index: number; readonly y: number } | null>;
  readonly from: number | null;
  readonly to: number | null;
  readonly setFrom: (value: number | null) => void;
  readonly setTo: (value: number | null) => void;
  readonly indexAt: (clientY: number) => number;
  readonly finish: () => void;
}
type RowProps = HTMLAttributes<HTMLElement> & { readonly ref: RefCallback<HTMLElement> };

// The renderer owns one gesture and at most one element slot per bounded row.
// Drop indices are measured before removal, preserving the editor's splice API.
export default function useListReorder({ count, onMove, disabled = false }: ReorderOptions) {
  assert(Number.isSafeInteger(count), 'Reorder count must be a safe integer');
  assert(count >= 0, 'Reorder count must be nonnegative');
  assert(count <= LIMITS.scanEntriesMax, 'Reorder count exceeds bounds');
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const start = useRef<{ readonly index: number; readonly y: number } | null>(null);
  const finish = useCallback(() => {
    start.current = null;
    setFrom(null);
    setTo(null);
  }, []);
  const indexAt = useCallback(
    (clientY: number): number => {
      for (let index = 0; index < count; index++) {
        const element = rows.current[index];
        if (!element) {
          continue;
        }
        const rectangle = element.getBoundingClientRect();
        if (clientY < rectangle.top + rectangle.height / 2) {
          return index;
        }
      }
      return count;
    },
    [count],
  );
  const state = { rows, start, from, to, setFrom, setTo, indexAt, finish };
  useReorderEvents(state, onMove);
  useReorderCursor(from);
  useEffect(() => {
    rows.current.length = Math.min(rows.current.length, count + 1);
  }, [count]);
  return {
    dragIndex: from,
    dropIndex: to,
    rowProps: (index: number) => reorderRowProps(index, state, { disabled }),
    slotProps: (index: number) => ({ ref: reorderRowRef(rows, index) }),
    rowClass: (index: number) => reorderRowClass(index, { from, to, count }),
  };
}

function useReorderEvents(state: ReorderState, onMove: ReorderOptions['onMove']): void {
  const { start, from, to, setFrom, setTo, indexAt, finish } = state;
  useEffect(() => {
    if (start.current === null && from === null) {
      return undefined;
    }
    const move = (event: PointerEvent): void => {
      if (from === null) {
        if (!start.current || Math.abs(event.clientY - start.current.y) < 4) {
          return;
        }
        setFrom(start.current.index);
      }
      event.preventDefault();
      setTo(indexAt(event.clientY));
    };
    const up = (event: PointerEvent): void => {
      const target = from === null ? null : indexAt(event.clientY);
      finish();
      if (from !== null && target !== null) {
        onMove(from, target);
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        finish();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', key);
    };
    // Arming a click changes `to`, so stable onMove callbacks still install
    // listeners before the first move crosses the drag threshold.
  }, [start, from, to, setFrom, setTo, indexAt, onMove, finish]);
}

function useReorderCursor(from: number | null): void {
  useEffect(() => {
    if (from === null) {
      return undefined;
    }
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [from]);
}

function reorderRowRef(rows: ReorderState['rows'], index: number): RefCallback<HTMLElement> {
  assert(Number.isSafeInteger(index), 'Reorder index must be a safe integer');
  assert(index >= 0, 'Reorder index must be nonnegative');
  assert(index <= LIMITS.scanEntriesMax, 'Reorder index exceeds bounds');
  return (element) => {
    rows.current[index] = element;
  };
}

function reorderRowProps(
  index: number,
  state: ReorderState,
  options: { readonly disabled: boolean },
): RowProps {
  return {
    ref: reorderRowRef(state.rows, index),
    onPointerDown: (event) => {
      if (options.disabled || event.button !== 0) {
        return;
      }
      const control =
        event.target instanceof Element
          ? event.target.closest('button, input, textarea, select, a')
          : null;
      if (control && !control.hasAttribute('data-drag-through')) {
        return;
      }
      state.start.current = { index, y: event.clientY };
      state.setTo(index);
    },
    onClickCapture: (event) => {
      if (state.from !== null) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

function reorderRowClass(
  index: number,
  state: {
    readonly from: number | null;
    readonly to: number | null;
    readonly count: number;
  },
): string {
  if (state.from === null || state.to === null) {
    return '';
  }
  const marks: string[] = [];
  if (state.to === index) {
    marks.push('drop-before');
  }
  if (state.to === state.count && index === state.count - 1) {
    marks.push('drop-after');
  }
  if (state.from === index) {
    marks.push('is-dragging');
  }
  return marks.join(' ');
}
