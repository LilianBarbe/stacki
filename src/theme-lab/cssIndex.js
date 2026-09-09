// Theme Lab — a live index of the app's own stylesheets, read through the CSSOM.
//
// Answers three questions the token file alone cannot:
//   • who consumes a variable?  (every rule whose value says `var(--x)`, plus,
//     transitively, every rule reading an alias that resolves to --x)
//   • what does an element read?  (every matched declaration carrying a var(),
//     with the alias chain unwound down to the literal value)
//   • which rules style an element?  (every matched rule with all of its
//     declarations, in cascade order, each still attached to its live CSSOM
//     rule so a value can be changed in place)
//
// Only same-origin sheets are readable; that is every sheet Vite injects, in
// dev and in a packaged build alike.

const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const DECL_RE = /(^|;)\s*([A-Za-z-]+[A-Za-z0-9_-]*)\s*:\s*([^;]+)/g;

// Properties a child takes from its parent when it does not set them itself.
const INHERITED = new Set([
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-transform', 'cursor', 'visibility',
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// {file: absolute path (dev) or href, sheet: short display name}
function sheetIdentity(sheet) {
  const node = sheet.ownerNode;
  const id = node?.dataset?.viteDevId || node?.getAttribute?.('href') || '';
  const m = id.match(/([^/]+\/)?([^/]+\.css)/);
  const short = m ? (m[1] ? m[1] + m[2] : m[2]) : id || 'inline';
  return { file: id, sheet: short };
}

// A selector reduced to what `Element.matches` can answer statically: state
// pseudo-classes (:hover, :focus…) and pseudo-elements (::before) go, structural
// ones (:not, :where, :first-child, :root) stay. Returns '' when nothing usable is left.
const STATE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|visited|link|placeholder-shown|target|read-only|indeterminate|empty)\b/g;
const plainCache = new Map();
export function plainSelector(selector) {
  if (plainCache.has(selector)) return plainCache.get(selector);
  let s = selector
    .replace(/::[A-Za-z-]+(\([^)]*\))?/g, '')
    .replace(STATE_PSEUDO, '')
    .replace(/:not\(\s*\)/g, '')
    .replace(/:where\(\s*\)/g, '')
    .replace(/:is\(\s*\)/g, '');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const ok = [];
  for (const p of parts) {
    try {
      document.querySelector(p);
      ok.push(p);
    } catch {
      /* not a selector we can evaluate — skip this part */
    }
  }
  const out = ok.join(', ');
  plainCache.set(selector, out);
  return out;
}

// Does the selector carry a state (:hover, :focus…) or a pseudo-element?
export function selectorState(selector) {
  const states = [...selector.matchAll(/::?[A-Za-z-]+/g)].map((m) => m[0]).filter((p) => STATE_PSEUDO.test(p) || p.startsWith('::'));
  STATE_PSEUDO.lastIndex = 0;
  return [...new Set(states)].join(' ');
}

// (ids, classes+attributes+pseudo-classes, elements) — an approximation that
// treats :not()/:is() as one class and ignores :where(), enough to order rules.
export function specificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;
  const s = selector
    .replace(/:where\([^)]*\)/g, '')
    .replace(/:(not|is|has)\([^)]*\)/g, () => {
      b++;
      return '';
    })
    .replace(/\[[^\]]*\]/g, () => {
      b++;
      return '';
    })
    .replace(/#[\w-]+/g, () => {
      a++;
      return '';
    })
    .replace(/\.[\w-]+/g, () => {
      b++;
      return '';
    })
    .replace(/::[\w-]+/g, () => {
      c++;
      return '';
    })
    .replace(/:[\w-]+(\([^)]*\))?/g, () => {
      b++;
      return '';
    });
  for (const m of s.matchAll(/(^|[\s>+~])([a-zA-Z][\w-]*)/g)) if (m[2]) c++;
  return a * 10000 + b * 100 + c;
}

export function buildIndex() {
  const rules = []; // {selector, plain, sheet, file, ordinal, rule, decls: [{prop, value, important, refs}]}
  const usages = new Map(); // var -> [{rule, prop, value}]
  const definitions = new Map(); // var -> [{rule, value}]
  const ordinals = new Map(); // `${file}\n${selector}` -> count

  const visit = (list, identity) => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) {
        const text = rule.style.cssText;
        const decls = [];
        for (const m of text.matchAll(DECL_RE)) {
          const prop = m[2];
          let value = m[3].trim();
          const important = /!important$/.test(value);
          if (important) value = value.replace(/\s*!important$/, '');
          decls.push({ prop, value, important, refs: [...value.matchAll(VAR_RE)].map((r) => r[1]) });
        }
        const key = `${identity.file}\n${rule.selectorText}`;
        const ordinal = ordinals.get(key) || 0;
        ordinals.set(key, ordinal + 1);
        const entry = {
          selector: rule.selectorText,
          plain: plainSelector(rule.selectorText),
          sheet: identity.sheet,
          file: identity.file,
          ordinal,
          rule,
          decls,
          specificity: specificity(rule.selectorText),
          order: rules.length,
        };
        for (const d of decls) {
          if (d.prop.startsWith('--')) push(definitions, d.prop, { rule: entry, value: d.value, refs: d.refs });
          for (const ref of d.refs) push(usages, ref, { rule: entry, prop: d.prop, value: d.value });
        }
        rules.push(entry);
        if (rule.cssRules?.length) visit(rule.cssRules, identity);
      } else if (rule.cssRules) {
        visit(rule.cssRules, identity);
      }
    }
  };

  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    if (sheet.ownerNode?.closest?.('[data-theme-lab]')) continue;
    const identity = sheetIdentity(sheet);
    if (/theme-lab\.css$/.test(identity.file)) continue;
    visit(list, identity);
  }
  return { rules, usages, definitions, builtAt: Date.now() };
}

function push(map, key, item) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(item);
}

// Does this value read `name` (exactly, not a longer name sharing the prefix)?
export function readsVar(value, name) {
  return new RegExp(`var\\(\\s*${escapeRe(name)}\\s*[,)]`).test(value);
}

// Every declaration that ends up reading `name`: direct `var(--name)` reads, and
// reads of any alias whose definition points back at it. `via` names the alias
// for the indirect ones.
export function consumersOf(index, name) {
  const out = [];
  const visited = new Set();
  const walk = (n, via) => {
    if (visited.has(n)) return;
    visited.add(n);
    for (const u of index.usages.get(n) || []) {
      if (u.prop.startsWith('--')) continue; // alias definitions are followed below, not listed
      out.push({ ...u, via });
    }
    for (const [alias, defs] of index.definitions) {
      if (alias === n) continue;
      if (defs.some((d) => readsVar(d.value, n))) walk(alias, via || alias);
    }
  };
  walk(name, null);
  return out;
}

// Elements a set of declarations paints — for the highlight overlay.
export function elementsFor(consumers, limit = 600) {
  const set = new Set();
  const seen = new Set();
  for (const c of consumers) {
    const sel = c.rule.plain;
    if (!sel || seen.has(sel)) continue;
    seen.add(sel);
    let nodes;
    try {
      nodes = document.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (el.closest('[data-theme-lab]')) continue;
      set.add(el);
      if (set.size >= limit) return [...set];
    }
  }
  return [...set];
}

// The definition of `name` that applies to `el`: the nearest ancestor (self
// first) matched by a rule declaring it; an inline declaration on that node wins.
function definitionFor(index, name, el) {
  const defs = index.definitions.get(name) || [];
  for (let node = el; node; node = node.parentElement) {
    const inline = node.style?.getPropertyValue(name);
    if (inline) return { value: inline.trim(), selector: node === document.documentElement ? 'inline on <html> (Theme Lab edit)' : 'inline style', sheet: '', node };
    let hit = null;
    for (const d of defs) {
      if (!d.rule.plain) continue;
      try {
        if (node.matches(d.rule.plain)) hit = d; // last matching rule wins (source order)
      } catch {
        /* ignore */
      }
    }
    if (hit) return { value: hit.value, selector: hit.rule.selector, sheet: hit.rule.sheet, node };
  }
  return null;
}

// Unwind `name` for `el`: [{name, value, selector, sheet}] down to a literal.
export function resolveChain(index, name, el, depth = 0) {
  const def = definitionFor(index, name, el);
  if (!def) return [{ name, value: null, selector: '(undefined)', sheet: '' }];
  const step = { name, value: def.value, selector: def.selector, sheet: def.sheet };
  const refs = [...def.value.matchAll(VAR_RE)].map((m) => m[1]);
  if (!refs.length || depth > 12) return [step];
  const chain = [step];
  for (const ref of refs) chain.push(...resolveChain(index, ref, el, depth + 1));
  return chain;
}

export function computedVar(el, name) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function matchedRules(index, node) {
  const out = [];
  for (const rule of index.rules) {
    if (!rule.plain) continue;
    try {
      if (node.matches(rule.plain)) out.push(rule);
    } catch {
      /* ignore */
    }
  }
  // Cascade order, winners first: higher specificity, then later in source.
  return out.sort((x, y) => y.specificity - x.specificity || y.order - x.order);
}

// Everything that styles `el`: its matched rules with every declaration, and
// for inherited properties it does not set, the nearest ancestor's rules.
export function stylesFor(index, el) {
  const decorate = (rule, node, filter) => ({
    rule,
    from: node === el ? null : node,
    decls: rule.decls
      .filter((d) => !filter || filter.has(d.prop))
      .map((d) => ({
        ...d,
        chains: d.refs.map((ref) => ({ ref, chain: resolveChain(index, ref, node), computed: computedVar(node, ref) })),
      })),
  });

  const own = matchedRules(index, el).map((r) => decorate(r, el, null));
  const ownProps = new Set(own.flatMap((r) => r.decls.map((d) => d.prop)));
  const inherited = [];
  for (let node = el.parentElement, hops = 1; node && hops < 40; node = node.parentElement, hops++) {
    for (const r of matchedRules(index, node)) {
      const props = new Set(r.decls.map((d) => d.prop).filter((p) => INHERITED.has(p) && !ownProps.has(p)));
      if (!props.size) continue;
      inherited.push(decorate(r, node, props));
      for (const p of props) ownProps.add(p);
    }
  }
  return { own, inherited };
}

export function describeElement(el) {
  if (!el || el === document.documentElement) return 'html';
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].filter((c) => !/^is-|^has-/.test(c)).slice(0, 3).join('.');
  const state = [...el.classList].filter((c) => /^is-|^has-/.test(c)).slice(0, 2).join('.');
  return tag + (cls ? '.' + cls : '') + (state ? ' .' + state : '');
}
