// ---------------------------------------------------------------------------
// Renaming a loop variable
//
// `services.map((service) => …)` — renaming `service` has to follow every
// reference below it, or the loop's own children stop compiling. Text-level
// rewriting, since the children hold code as strings.
// ---------------------------------------------------------------------------

import { LIMITS } from '../shared/limits';
import { assert } from '../shared/assert';

// The live tree as the loop tools need it: the mutable in-session shape.
// Boundary code uses the readonly PageNode contract; this local mirror exists
// because these tools rewrite nodes in place (including kind changes), and the
// diff-mapping editor core (docs/diff-mapping-editor-core.md) replaces this
// whole layer — per the migration plan, minimal fidelity, no deep design here.
interface LiveNode {
  kind?: string;
  id?: string;
  head?: string;
  body?: unknown; // string[] for statement bodies; narrowed before use
  value?: string;
  test?: string;
  props?: Record<string, LiveProp>;
  children?: LiveNode[] | null;
}

interface LiveProp {
  type?: string;
  value?: string;
}

const MAP_HEAD_RE = /^([\s\S]+?)\.map\(\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*=>\s*\($/;

interface LoopHead {
  data: string;
  item: string;
  index: string;
}

export function splitMapHead(head: unknown): LoopHead | null {
  const m = String(head).trim().match(MAP_HEAD_RE);
  const data = m?.[1];
  const item = m?.[2];
  if (!m || data === undefined || item === undefined) {
    return null;
  }
  return { data: data.trim(), item, index: m[3] || '' };
}

// Whole identifier only: `service` but never the `service` in `x.service`
// (a property of something else) or in `services`.
const escapeIdentifier = (name: string): string => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identifierPattern = (name: string, flags?: string): RegExp =>
  new RegExp(`(?<![.\\w$])${escapeIdentifier(name)}(?![\\w$])`, flags);
const renameIdent = (code: unknown, from: string, to: string): string =>
  String(code ?? '').replace(identifierPattern(from, 'g'), () => to);

// Text nodes are prose with {expressions} in it — rewrite only the braces,
// so a loop variable named `title` doesn't rewrite the word in a sentence.
const renameInBraces = (text: unknown, from: string, to: string): string =>
  String(text ?? '').replace(/\{([^{}]*)\}/g, (_, inner) => `{${renameIdent(inner, from, to)}}`);

export function renameLoopVar(nodes: readonly LiveNode[], from: string, to: string): void {
  for (const n of nodes) {
    if (n.kind === 'map' && n.head !== undefined) {
      const p = splitMapHead(n.head);
      if (p) {
        // Only the data expression is a reference; the parameters are this
        // loop's own declarations.
        const data = renameIdent(p.data, from, to);
        if (data !== p.data) {
          n.head = `${data}.map((${p.item}${p.index ? `, ${p.index}` : ''}) => (`;
        }
        // Declarations in a statement-body loop read the outer item as
        // freely as the markup does.
        // A nested loop that re-declares the name shadows the outer one, so
        // everything below it means something else by it.
        if (p.item === from || p.index === from) {
          continue;
        }
        if (Array.isArray(n.body)) {
          const lines: unknown[] = n.body;
          n.body = lines.map((line) => renameIdent(line, from, to));
        }
      } else {
        n.head = renameIdent(n.head, from, to); // custom head — best effort
      }
    } else if (n.kind === 'expr' && n.value !== undefined) {
      n.value = renameIdent(n.value, from, to);
    } else if (n.kind === 'cond' && n.test !== undefined) {
      n.test = renameIdent(n.test, from, to);
    } else if (n.kind === 'text' && n.value !== undefined) {
      n.value = renameInBraces(n.value, from, to);
    }
    const props = n.props;
    if (props) {
      for (const [key, v] of Object.entries(props)) {
        if (v?.type === 'expr' && v.value !== undefined) {
          props[key] = { ...v, value: renameIdent(v.value, from, to) };
        }
      }
    }
    if (Array.isArray(n.children)) {
      renameLoopVar(n.children, from, to);
    }
  }
}

// `data.map((item[, index]) => (` → its pieces, or null when the head is
// hand-written code the loop editor can't model.
export const parseLoopHead = splitMapHead;

// Whether `expr` reads from the variable `v` (`service`, `service.tags`) —
// not merely contains its letters (`services`, `x.service`).
const readsVar = (expr: unknown, v: string): boolean =>
  identifierPattern(v).test(String(expr || ''));

// Switching a loop's data source orphans any loop beneath it that reads from
// the item — `service.tags.map(...)` under `services.map((service) => …)`
// would call .map on undefined once the parent points somewhere else. Those
// loops are repointed at an empty array: still valid code, renders nothing,
// and the child markup is preserved for re-pointing by hand.
export function disconnectDependentLoops(list: readonly LiveNode[] | undefined, vars: readonly string[]): void {
  for (const n of list ?? []) {
    if (!Array.isArray(n.children)) {
      continue;
    }
    if (n.kind === 'map') {
      const h = n.head !== undefined ? parseLoopHead(n.head) : null;
      if (h && vars.some((v) => readsVar(h.data, v))) {
        n.head = `[].map((${h.item}${h.index ? `, ${h.index}` : ''}) => (`;
      }
      // The declarations are left alone: an empty list never calls the
      // callback, so nothing in there can run, and the code is still what the
      // user wrote for when they point it at data again.
      // A nested loop that reuses the name shadows it, so anything deeper
      // refers to the inner one and is still valid.
      const shadowed = new Set([h?.item, h?.index].filter(Boolean));
      const rest = vars.filter((v) => !shadowed.has(v));
      if (rest.length) {
        disconnectDependentLoops(n.children, rest);
      }
    } else if (n.kind === 'cond') {
      // Same for a condition reading the item: false renders the else branch
      // instead of throwing.
      if (n.test !== undefined && vars.some((v) => readsVar(n.test, v))) {
        n.test = 'false';
      }
      disconnectDependentLoops(n.children, vars);
    } else {
      disconnectDependentLoops(n.children, vars);
    }
  }
}

// Path from the roots to `id`, inclusive — the local, LiveNode-typed walk.
// editorTree's ancestorChain does this for the readonly contract; the loop
// tools mutate what they find, so they keep their own (the diff-mapping core
// retires this module; do not unify them).
function findPath(nodes: readonly LiveNode[], id: string, trail: readonly LiveNode[], depth: number): LiveNode[] | null {
  // The parser caps nesting at parserDepthMax; a live tree can never be
  // deeper than the parse that produced it.
  assert(depth <= LIMITS.treeDepthMax, `findPath: depth ${depth} exceeds parser cap`);
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === id) {
      return next;
    }
    if (Array.isArray(node.children)) {
      const hit = findPath(node.children, id, next, depth + 1);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

// The loop variables in scope at a node: every enclosing map's item/index.
export function loopVarsAt(nodes: readonly LiveNode[], id: string): string[] {
  const path = findPath(nodes, id, [], 0) ?? [];
  const vars = path.slice(0, -1).flatMap((node) => {
    const head = node.kind === 'map' && node.head !== undefined ? parseLoopHead(node.head) : null;
    return [head?.item, head?.index].filter((v): v is string => Boolean(v));
  });
  return [...new Set(vars)];
}

// What a dropped binding is replaced with, so the element keeps rendering
// something you can select and retype.
const UNBOUND_TEXT = 'content';

// Moving or pasting a node out of its loop leaves its bindings pointing at a
// variable that no longer exists — `{service.text}` becomes a hard
// ReferenceError that blanks the whole page. Replace exactly those bindings:
// `{…}` children and interpolations become placeholder text, expression props
// are dropped (a stale `href="content"` would just be a broken link), and
// nested loops that read from the departed item are pointed at an empty
// array.
export function stripLostBindings(node: LiveNode, vars: readonly string[]): number {
  if (!vars.length) {
    return 0;
  }
  let removed = 0;
  const walk = (n: LiveNode, active: readonly string[]): void => {
    const props = n.props;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v?.type === 'expr' && v.value !== undefined && active.some((x) => readsVar(v.value, x))) {
          delete props[k];
          removed++;
        }
      }
    }
    // A dropped binding leaves placeholder text rather than a hole, so the
    // element stays visible and editable on the canvas.
    if (n.kind === 'expr' && n.value !== undefined && active.some((x) => readsVar(n.value, x))) {
      removed++;
      n.kind = 'text';
      n.value = UNBOUND_TEXT;
      delete n.head;
      delete n.children;
      return;
    }
    if (n.kind === 'text' && n.value !== undefined && n.value.includes('{')) {
      const next = n.value.replace(/\{([^{}]*)\}/g, (whole, inner) =>
        active.some((x) => readsVar(inner, x)) ? UNBOUND_TEXT : whole,
      );
      if (next !== n.value) {
        removed++;
        n.value = next;
      }
    }
    let remaining = active;
    if (n.kind === 'map' && n.head !== undefined) {
      const h = parseLoopHead(n.head);
      if (h && remaining.some((x) => readsVar(h.data, x))) {
        n.head = `[].map((${h.item}${h.index ? `, ${h.index}` : ''}) => (`;
        removed++;
      }
      remaining = remaining.filter((v) => v !== h?.item && v !== h?.index);
      if (!remaining.length) {
        return;
      }
      if (Array.isArray(n.body)) {
        // This loop can still run (its own data may be fine), so a
        // declaration reading a lost variable would throw. Dropping the line
        // would orphan whatever reads the name it declares — so keep the
        // binding and swap what it's assigned, the same placeholder a lost
        // text binding gets.
        const lines: unknown[] = n.body;
        n.body = lines.map((line) => {
          const text = String(line ?? '');
          if (!remaining.some((x) => readsVar(text, x))) {
            return line;
          }
          const decl = text.match(/^((?:const|let)\s+[^=]+=\s*)/);
          if (!decl) {
            return line;
          }
          removed++;
          return `${decl[1]}'${UNBOUND_TEXT}';`;
        });
      }
    }
    // A condition on a variable that's gone would throw; false keeps the
    // markup and renders the else branch.
    if (n.kind === 'cond' && n.test !== undefined && remaining.some((x) => readsVar(n.test, x))) {
      n.test = 'false';
      removed++;
    }
    if (Array.isArray(n.children)) {
      n.children.forEach((child) => walk(child, remaining));
    }
  };
  walk(node, vars);
  return removed;
}

export type { LiveNode, LiveProp, LoopHead };
