import { ancestorChain } from './editorTree.js';

// ---------------------------------------------------------------------------
// Renaming a loop variable
//
// `services.map((service) => …)` — renaming `service` has to follow every
// reference below it, or the loop's own children stop compiling. Text-level
// rewriting, since the children hold code as strings.
// ---------------------------------------------------------------------------

const MAP_HEAD_RE = /^([\s\S]+?)\.map\(\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*=>\s*\($/;

export function splitMapHead(head) {
  const m = String(head).trim().match(MAP_HEAD_RE);
  return m ? { data: m[1].trim(), item: m[2], index: m[3] || '' } : null;
}

// Whole identifier only: `service` but never the `service` in `x.service`
// (a property of something else) or in `services`.
const escapeIdentifier = (name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identifierPattern = (name, flags) =>
  new RegExp(`(?<![.\\w$])${escapeIdentifier(name)}(?![\\w$])`, flags);
const renameIdent = (code, from, to) =>
  String(code ?? '').replace(identifierPattern(from, 'g'), () => to);

// Text nodes are prose with {expressions} in it — rewrite only the braces,
// so a loop variable named `title` doesn't rewrite the word in a sentence.
const renameInBraces = (text, from, to) =>
  String(text ?? '').replace(/\{([^{}]*)\}/g, (_, inner) => `{${renameIdent(inner, from, to)}}`);

export function renameLoopVar(nodes, from, to) {
  for (const n of nodes) {
    if (n.kind === 'map') {
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
        if (p.item === from || p.index === from) continue;
        if (Array.isArray(n.body)) n.body = n.body.map((line) => renameIdent(line, from, to));
      } else {
        n.head = renameIdent(n.head, from, to); // custom head — best effort
      }
    } else if (n.kind === 'expr') {
      n.value = renameIdent(n.value, from, to);
    } else if (n.kind === 'cond') {
      n.test = renameIdent(n.test, from, to);
    } else if (n.kind === 'text') {
      n.value = renameInBraces(n.value, from, to);
    }
    for (const [key, v] of Object.entries(n.props || {})) {
      if (v?.type === 'expr') n.props[key] = { ...v, value: renameIdent(v.value, from, to) };
    }
    if (Array.isArray(n.children)) renameLoopVar(n.children, from, to);
  }
}


// `data.map((item[, index]) => (` → its pieces, or null when the head is
// hand-written code the loop editor can't model.
export const parseLoopHead = splitMapHead;

// Whether `expr` reads from the variable `v` (`service`, `service.tags`) —
// not merely contains its letters (`services`, `x.service`).
const readsVar = (expr, v) =>
  identifierPattern(v).test(String(expr || ''));

// Switching a loop's data source orphans any loop beneath it that reads from
// the item — `service.tags.map(...)` under `services.map((service) => …)`
// would call .map on undefined once the parent points somewhere else. Those
// loops are repointed at an empty array: still valid code, renders nothing,
// and the child markup is preserved for re-pointing by hand.
export function disconnectDependentLoops(list, vars) {
  for (const n of list || []) {
    if (!Array.isArray(n.children)) continue;
    if (n.kind === 'map') {
      const h = parseLoopHead(n.head);
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
      if (rest.length) disconnectDependentLoops(n.children, rest);
    } else if (n.kind === 'cond') {
      // Same for a condition reading the item: false renders the else branch
      // instead of throwing.
      if (vars.some((v) => readsVar(n.test, v))) n.test = 'false';
      disconnectDependentLoops(n.children, vars);
    } else {
      disconnectDependentLoops(n.children, vars);
    }
  }
}

// The loop variables in scope at a node: every enclosing map's item/index.
export function loopVarsAt(nodes, id) {
  const vars = (ancestorChain(nodes, id) || []).slice(0, -1).flatMap((node) => {
    const head = node.kind === 'map' ? parseLoopHead(node.head) : null;
    return [head?.item, head?.index].filter(Boolean);
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
export function stripLostBindings(node, vars) {
  if (!vars.length) return 0;
  let removed = 0;
  const walk = (n, vars) => {
    for (const [k, v] of Object.entries(n.props || {})) {
      if (v?.type === 'expr' && vars.some((x) => readsVar(v.value, x))) {
        delete n.props[k];
        removed++;
      }
    }
    // A dropped binding leaves placeholder text rather than a hole, so the
    // element stays visible and editable on the canvas.
    if (n.kind === 'expr' && vars.some((x) => readsVar(n.value, x))) {
      removed++;
      n.kind = 'text';
      n.value = UNBOUND_TEXT;
      delete n.head;
      delete n.children;
      return;
    }
    if (n.kind === 'text' && n.value.includes('{')) {
      const next = n.value.replace(/\{([^{}]*)\}/g, (whole, inner) =>
        vars.some((x) => readsVar(inner, x)) ? UNBOUND_TEXT : whole
      );
      if (next !== n.value) {
        removed++;
        n.value = next;
      }
    }
    if (n.kind === 'map') {
      const h = parseLoopHead(n.head);
      if (h && vars.some((x) => readsVar(h.data, x))) {
        n.head = `[].map((${h.item}${h.index ? `, ${h.index}` : ''}) => (`;
        removed++;
      }
      vars = vars.filter((v) => v !== h?.item && v !== h?.index);
      if (!vars.length) return;
      if (Array.isArray(n.body)) {
        // This loop can still run (its own data may be fine), so a
        // declaration reading a lost variable would throw. Dropping the line
        // would orphan whatever reads the name it declares — so keep the
        // binding and swap what it's assigned, the same placeholder a lost
        // text binding gets.
        n.body = n.body.map((line) => {
          if (!vars.some((x) => readsVar(line, x))) return line;
          const decl = line.match(/^((?:const|let)\s+[^=]+=\s*)/);
          if (!decl) return line;
          removed++;
          return `${decl[1]}'${UNBOUND_TEXT}';`;
        });
      }
    }
    // A condition on a variable that's gone would throw; false keeps the
    // markup and renders the else branch.
    if (n.kind === 'cond' && vars.some((x) => readsVar(n.test, x))) {
      n.test = 'false';
      removed++;
    }
    if (Array.isArray(n.children)) {
      n.children.forEach((child) => walk(child, vars));
    }
  };
  walk(node, vars);
  return removed;
}
