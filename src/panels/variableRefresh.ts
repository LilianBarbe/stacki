import type { Result } from '../../shared/result';
import type { VariablesSnapshot } from '../variablesBridge';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { readCSSVariables } from '../variablesBridge';

type ReadState =
  | { readonly kind: 'idle' | 'disposed' }
  | { readonly kind: 'reading'; readonly promise: Promise<void>; pending: boolean };

// Watchers and edits share one read and one pending refresh. Mutation is confined
// to this coordinator; disposed project instances can never publish another result.
export function createVariableRefresh(
  projectPath: string,
  publish: (result: Result<VariablesSnapshot, string>) => void,
) {
  let state: ReadState = { kind: 'idle' };
  const disposed = () => state.kind === 'disposed';
  const drain = async () => {
    for (let iteration = 0; iteration < LIMITS.rescanChainMax; iteration++) {
      if (disposed()) {
        return;
      }
      assert(state.kind === 'reading', 'Variable refresh: drain requires a request');
      state.pending = false;
      const result = await readCSSVariables(projectPath);
      if (disposed()) {
        return;
      }
      assert(state.kind === 'reading', 'Variable refresh: request lost during read');
      publish(result);
      if (disposed()) {
        return;
      }
      if (!state.pending) {
        state = { kind: 'idle' };
        return;
      }
    }
    // Yield a sustained watcher stream after a bounded batch, retaining one follow-up.
    state = { kind: 'idle' };
    queueMicrotask(() => {
      if (!disposed()) {
        void refresh();
      }
    });
  };
  const refresh = (): Promise<void> => {
    if (state.kind === 'disposed') {
      return Promise.resolve();
    }
    if (state.kind === 'reading') {
      state.pending = true;
      return state.promise;
    }
    const promise = Promise.resolve().then(drain);
    state = { kind: 'reading', promise, pending: false };
    return promise;
  };
  const dispose = () => {
    state = { kind: 'disposed' };
  };
  return { refresh, dispose };
}
