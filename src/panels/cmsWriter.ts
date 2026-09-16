import type { Collection } from '../cmsSchema';
import { reassemble } from '../cmsSchema';
import { writeCms } from '../cmsBridge';
import { assert } from '../../shared/assert';
import { BOUNDARY_LIMITS } from '../../shared/boundary';
import { LIMITS } from '../../shared/limits';

export interface CmsUndo {
  readonly label: string;
  readonly coalesceKey: string;
  readonly undo: () => Promise<void>;
  readonly redo: () => Promise<void>;
}
interface WriterOptions {
  readonly projectPath: string;
  readonly rel: string;
  readonly report: (message: string) => void;
  readonly refresh: () => Promise<void>;
  readonly saved: () => void;
  readonly record: (command: CmsUndo) => void;
}
type Snapshot =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly collection: Collection;
      readonly data: unknown;
    };
type WriteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'queued'; readonly items: readonly unknown[] }
  | {
      readonly kind: 'writing';
      readonly promise: Promise<boolean>;
      pending: readonly unknown[] | undefined;
    };
const SAVE_DELAY_MS = 400;

export function createCmsWriter(options: WriterOptions) {
  return new CmsWriter(options);
}

// One writer belongs to one file. Mutation stays private here. A burst replaces
// one queued snapshot; serialized writes cannot overwrite a newer edit on disk.
class CmsWriter {
  private snapshot: Snapshot = { kind: 'empty' };
  private state: WriteState = { kind: 'idle' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private editRevision = 0;
  constructor(private readonly options: WriterOptions) {}

  accept(collection: Collection, data: unknown): void {
    assert(this.state.kind === 'idle', 'CMS load: cannot replace unsaved data');
    assert(collection.rel === this.options.rel, 'CMS load: snapshot belongs to another file');
    this.snapshot = { kind: 'ready', collection, data };
  }
  revision(): number {
    return this.editRevision;
  }
  queue(items: readonly unknown[]): void {
    assert(this.snapshot.kind === 'ready', 'CMS edit: a loaded snapshot is required');
    assert(items.length <= BOUNDARY_LIMITS.itemsMax, 'CMS edit: item limit exceeded');
    this.editRevision++;
    assert(Number.isSafeInteger(this.editRevision), 'CMS edit: revision limit exceeded');
    if (this.state.kind === 'writing') {
      this.state.pending = items;
    } else {
      this.state = { kind: 'queued', items };
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY_MS);
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.state.kind === 'idle') {
      return Promise.resolve(true);
    }
    if (this.state.kind === 'writing') {
      return this.state.promise;
    }
    const items = this.state.items;
    const promise = Promise.resolve().then(() => this.drain(items));
    this.state = { kind: 'writing', promise, pending: undefined };
    return promise;
  }
  private async drain(initial: readonly unknown[]): Promise<boolean> {
    let items = initial;
    for (let iteration = 0; iteration < LIMITS.saveDrainMax; iteration++) {
      assert(this.snapshot.kind === 'ready', 'CMS save: a loaded snapshot is required');
      const before = this.snapshot.data;
      const after = reassemble(this.snapshot.collection, items);
      const result = await writeCms(this.options.projectPath, this.options.rel, after);
      assert(this.state.kind === 'writing', 'CMS save: active write lost its state');
      if (!result.ok) {
        this.state = { kind: 'queued', items: this.state.pending ?? items };
        this.report(result.error);
        return false;
      }
      this.snapshot = { ...this.snapshot, data: after };
      this.record(before, after);
      this.options.saved();
      if (this.state.pending === undefined) {
        this.state = { kind: 'idle' };
        return true;
      }
      items = this.state.pending;
      this.state.pending = undefined;
    }
    assert(false, 'CMS save: drain limit exceeded');
  }
  private record(before: unknown, after: unknown): void {
    this.options.record({
      label: 'content edit',
      coalesceKey: `cms:${this.options.rel}`,
      undo: () => this.restore(before),
      redo: () => this.restore(after),
    });
  }
  private async restore(value: unknown): Promise<void> {
    // Undo shares the write slot with edits. An edit arriving during a restore
    // becomes the next snapshot, rather than racing another disk write.
    for (let attempt = 0; attempt < LIMITS.saveDrainMax; attempt++) {
      if (!(await this.flush())) {
        return;
      }
      if (this.state.kind !== 'idle') {
        continue;
      }
      const promise = Promise.resolve().then(() => this.restoreSnapshot(value));
      this.state = { kind: 'writing', promise, pending: undefined };
      if (!(await promise)) {
        return;
      }
      await this.options.refresh();
      this.options.saved();
      return;
    }
    assert(false, 'CMS restore: drain limit exceeded');
  }
  private async restoreSnapshot(value: unknown): Promise<boolean> {
    const result = await writeCms(this.options.projectPath, this.options.rel, value);
    assert(this.state.kind === 'writing', 'CMS restore: active write lost its state');
    const pending = this.state.pending;
    this.state = pending === undefined ? { kind: 'idle' } : { kind: 'queued', items: pending };
    if (!result.ok) {
      this.report(result.error);
      return false;
    }
    assert(this.snapshot.kind === 'ready', 'CMS restore: loaded snapshot is required');
    this.snapshot = { ...this.snapshot, data: value };
    return this.flush();
  }
  private report(error: string): void {
    // A collection deliberately deleted during a pending edit needs no toast.
    if (!/no longer exists/.test(error)) {
      this.options.report(error);
    }
  }
}
