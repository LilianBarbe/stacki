// Read-only tree queries. Mutation code uses the live readers; rendering builds
// one index per immutable model so hovering and selecting never rescan it.

import type { PageNode } from '../shared/dist/page-node.js';

interface TreeEntry {
  node: PageNode;
  list: readonly PageNode[];
  index: number;
  parent: TreeEntry | null;
  path?: string;
}

interface Frame {
  list: readonly PageNode[];
  index: number;
  parent: TreeEntry | null;
}

function* entries(nodes: readonly PageNode[] | null | undefined): Generator<TreeEntry> {
  const stack: Frame[] = [{ list: nodes ?? [], index: 0, parent: null }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      break;
    }
    if (frame.index >= frame.list.length) {
      stack.pop();
      continue;
    }
    const index = frame.index++;
    const node = frame.list[index];
    if (node === undefined) {
      continue;
    }
    const entry: TreeEntry = { node, list: frame.list, index, parent: frame.parent };
    yield entry;
    if ('children' in node && Array.isArray(node.children) && node.children.length) {
      stack.push({ list: node.children, index: 0, parent: entry });
    }
  }
}

function findEntry(nodes: readonly PageNode[] | null | undefined, id: string): TreeEntry | null {
  for (const entry of entries(nodes)) {
    if (entry.node.id === id) {
      return entry;
    }
  }
  return null;
}

function trailOf<T>(entry: TreeEntry | null, pick: (entry: TreeEntry) => T): T[] | null {
  if (!entry) {
    return null;
  }
  const trail: T[] = [];
  for (let current: TreeEntry | null = entry; current; current = current.parent) {
    trail.push(pick(current));
  }
  return trail.reverse();
}

export const findNodeById = (nodes: readonly PageNode[] | null | undefined, id: string): PageNode | null =>
  findEntry(nodes, id)?.node || null;
export const findParentNode = (nodes: readonly PageNode[] | null | undefined, id: string): PageNode | null =>
  findEntry(nodes, id)?.parent?.node || null;
export const pathOfNode = (nodes: readonly PageNode[] | null | undefined, id: string): number[] | null =>
  trailOf(findEntry(nodes, id), (entry) => entry.index);
export const ancestorChain = (nodes: readonly PageNode[] | null | undefined, id: string): PageNode[] | null =>
  trailOf(findEntry(nodes, id), (entry) => entry.node);

export function findParentList(
  model: { readonly nodes: readonly PageNode[] },
  id: string,
): { list: readonly PageNode[]; index: number } | null {
  const found = findEntry(model.nodes, id);
  return found ? { list: found.list, index: found.index } : null;
}

export function isDescendantOf(candidateParent: PageNode, id: string): boolean {
  const children = 'children' in candidateParent ? candidateParent.children : null;
  return candidateParent.id === id || !!findNodeById(children, id);
}

export function nodeAtPath(nodes: readonly PageNode[] | null | undefined, trail: readonly number[]): PageNode | null {
  let list = nodes;
  let node: PageNode | null = null;
  for (const i of trail) {
    node = list?.[i] ?? null;
    if (!node) {
      return null;
    }
    list = 'children' in node ? node.children : null;
  }
  return node;
}

interface TreeIndex {
  readonly byId: Map<string, TreeEntry>;
  readonly byPath: Map<string, PageNode>;
  readonly sectionIds: string[];
  node(id: string): PageNode | null;
  parent(id: string): PageNode | null;
  path(id: string): string | null;
  ancestors(id: string): PageNode[] | null;
}

export function createTreeIndex(nodes: readonly PageNode[]): TreeIndex {
  const byId = new Map<string, TreeEntry>();
  const byPath = new Map<string, PageNode>();
  const sectionIds: string[] = [];
  for (const entry of entries(nodes)) {
    entry.path = entry.parent ? `${entry.parent.path}.${entry.index}` : String(entry.index);
    byId.set(entry.node.id, entry);
    byPath.set(entry.path, entry.node);
    if (entry.node.kind === 'component' || entry.node.kind === 'element' || entry.node.kind === 'raw') {
      const id = entry.node.props?.['id'];
      if (id?.type === 'string' && id.value) {
        sectionIds.push(id.value);
      }
    }
  }
  return {
    byId,
    byPath,
    sectionIds,
    node: (id) => byId.get(id)?.node || null,
    parent: (id) => byId.get(id)?.parent?.node || null,
    path: (id) => byId.get(id)?.path ?? null,
    ancestors: (id) => trailOf(byId.get(id) ?? null, (entry) => entry.node),
  };
}

export type { TreeEntry, TreeIndex };
