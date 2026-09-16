import type { Result } from '../../shared/result';
import type { Collection } from '../cmsSchema';
import type { DeclaredTypes } from './cmsTypes';
import type { createCmsWriter } from './cmsWriter';
import { collectionOf } from '../cmsSchema';
import { readCms, readCmsMeta } from '../cmsBridge';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';

export interface CmsSnapshot {
  readonly collection: Collection;
  readonly items: readonly unknown[];
  readonly declared: DeclaredTypes;
}
interface ReaderOptions {
  readonly projectPath: string;
  readonly rel: string;
  readonly writer: ReturnType<typeof createCmsWriter>;
  readonly publish: (result: Result<CmsSnapshot, string>) => void;
  readonly report: (message: string) => void;
}
type ReadState =
  | { readonly kind: 'idle' | 'disposed' }
  | {
      readonly kind: 'reading';
      readonly promise: Promise<void>;
      pending: boolean;
    };

export function createCmsReader(options: ReaderOptions) {
  return new CmsReader(options);
}
export function cmsCollection(rel: string, data: unknown, error?: string): Collection {
  const slash = rel.lastIndexOf('/');
  const file = { rel, name: rel.slice(slash + 1), dir: slash < 0 ? '' : rel.slice(0, slash) };
  return error === undefined ? collectionOf({ ...file, data }) : collectionOf({ ...file, error });
}

// One active read and one pending refresh bound watcher bursts. The writer's
// revision prevents a read that started before an edit from replacing that edit.
class CmsReader {
  private state: ReadState = { kind: 'idle' };
  constructor(private readonly options: ReaderOptions) {}
  refresh(): Promise<void> {
    if (this.state.kind === 'disposed') {
      return Promise.resolve();
    }
    if (this.state.kind === 'reading') {
      this.state.pending = true;
      return this.state.promise;
    }
    const promise = Promise.resolve().then(() => this.drain());
    this.state = { kind: 'reading', promise, pending: false };
    return promise;
  }
  dispose(): void {
    this.state = { kind: 'disposed' };
  }
  private disposed(): boolean {
    return this.state.kind === 'disposed';
  }
  private async drain(): Promise<void> {
    for (let iteration = 0; iteration < LIMITS.rescanChainMax; iteration++) {
      if (this.disposed()) {
        return;
      }
      assert(this.state.kind === 'reading', 'CMS read: drain requires a request');
      this.state.pending = false;
      if (!(await this.options.writer.flush())) {
        this.state = { kind: 'idle' };
        return;
      }
      if (this.disposed()) {
        return;
      }
      await this.read();
      if (this.disposed()) {
        return;
      }
      assert(this.state.kind === 'reading', 'CMS read: request lost during read');
      if (!this.state.pending) {
        this.state = { kind: 'idle' };
        return;
      }
    }
    // A sustained watcher stream yields after a bounded batch and retains one refresh.
    this.state = { kind: 'idle' };
    queueMicrotask(() => {
      if (!this.disposed()) {
        void this.refresh();
      }
    });
  }
  private async read(): Promise<void> {
    const { writer, projectPath, rel, publish, report } = this.options;
    const revision = writer.revision();
    const [content, metadata] = await Promise.all([
      readCms(projectPath, rel),
      readCmsMeta(projectPath),
    ]);
    if (this.disposed()) {
      return;
    }
    if (revision !== writer.revision()) {
      return;
    }
    if (!content.ok) {
      publish(content);
      return;
    }
    const collection = cmsCollection(rel, content.value.data);
    writer.accept(collection, content.value.data);
    if (!metadata.ok) {
      report(metadata.error);
    }
    publish({
      ok: true,
      value: {
        collection,
        items: collection.items,
        declared: metadata.ok ? (metadata.value.meta[rel] ?? {}) : {},
      },
    });
  }
}
