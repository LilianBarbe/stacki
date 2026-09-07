// Giving a component back to the page.
//
// The inverse of componentFile.js, and not its mirror image. Making a component
// MOVES markup: the page keeps `<Card />`, the new file gets the nodes exactly
// as they were written, and a `const { title } = Astro.props;` is added on top.
// Nothing is rewritten, which is why that direction is short.
//
// Coming back, the markup has to be rewritten. `{title}` inside the component
// means whatever the instance passed, `<slot />` means whatever the instance
// wrapped, and the imports the component leaned on have to be re-aimed at the
// page's folder. Each of those is a place to be quietly wrong, and being
// quietly wrong here means editing somebody's page into something that no
// longer renders.
//
// So this refuses more than it accepts, and says which of them it did.
//
// What it takes:
//   - a component whose frontmatter is imports and one destructure off
//     Astro.props, and nothing else. Anything computed up there would have to
//     be carried into the page's own frontmatter, where it can collide with a
//     name already in use — a merge this does not attempt.
//   - props that stand alone: `{title}`, or `href={title}`. A prop caught up in
//     an expression (`{title.toUpperCase()}`) would need the expression rewritten
//     rather than a value put in place of a name.
//   - one unnamed <slot />, or none.
//
// Everything else comes back as { ok: false, reason } with the page untouched.

const path = require('path');
const { parsePage } = require('./astroParser');

const toPosix = (p) => p.split(path.sep).join('/');

// `const { a, b = 'x' } = Astro.props;` and nothing else. The names, and the
// defaults for the ones that have a plain literal for a default — a default
// that is an expression is left out, so a prop relying on it is missing rather
// than guessed at.
const DESTRUCTURE = /^const\s*\{([^}]*)\}\s*=\s*Astro\.props\s*;?$/;

function readPropNames(extraFrontmatter) {
  const text = String(extraFrontmatter || '').trim();
  if (!text) return { names: [], defaults: new Map() };
  const m = DESTRUCTURE.exec(text);
  if (!m) return null;
  const names = [];
  const defaults = new Map();
  for (const part of m[1].split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf('=');
    const name = (eq === -1 ? piece : piece.slice(0, eq)).trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null; // rest element, renaming, nesting
    names.push(name);
    if (eq !== -1) {
      const literal = piece.slice(eq + 1).trim();
      if (/^(['"]).*\1$/.test(literal) || /^-?\d+(\.\d+)?$/.test(literal) || literal === 'true' || literal === 'false') {
        defaults.set(name, literal);
      }
    }
  }
  return { names, defaults };
}

// A prop's value at this instance, as the thing that replaces the name.
// `{ kind: 'string' | 'expr' | 'bool' }` mirrors what parseAttrs produced, so a
// value can go back into an attribute or into the markup without guessing.
function valueFor(name, instanceProps, defaults) {
  const given = instanceProps ? instanceProps[name] : undefined;
  if (given) {
    if (given.type === 'string') return { kind: 'string', value: given.value };
    if (given.type === 'expr') return { kind: 'expr', value: given.value };
    if (given.type === 'bare') return { kind: 'bool' };
  }
  const fallback = defaults.get(name);
  if (fallback === undefined) return null;
  if (fallback === 'true' || fallback === 'false') return { kind: 'expr', value: fallback };
  if (/^-?\d/.test(fallback)) return { kind: 'expr', value: fallback };
  return { kind: 'string', value: fallback.slice(1, -1) };
}

const isSlot = (node) => node.kind === 'element' && node.name === 'slot';

// Whether a name is still referred to, looking only where a reference could
// be: expression text. Searching the serialized markup instead would call the
// `href` attribute of `<a href="/a">` a surviving `href` prop, since an
// attribute's NAME and a prop's name are spelled alike and mean nothing to each
// other. The leading `.` exclusion keeps `item.title` from counting as `title`.
const referenced = (text, name) =>
  new RegExp(`(^|[^A-Za-z0-9_$.])${name}([^A-Za-z0-9_$]|$)`).test(String(text || ''));

function survivingProp(nodes, names) {
  for (const node of nodes || []) {
    const texts = [];
    if (node.kind === 'expr') texts.push(node.value);
    if (node.kind === 'raw') texts.push(node.inner);
    if (node.kind === 'cond' || node.kind === 'map' || node.kind === 'branch') texts.push(node.value, node.source, node.expr);
    for (const value of Object.values(node.props || {})) {
      if (value?.type === 'expr' || value?.type === 'spread') texts.push(value.value);
    }
    for (const text of texts) {
      const hit = names.find((name) => referenced(text, name));
      if (hit) return hit;
    }
    const deeper = survivingProp(node.children, names);
    if (deeper) return deeper;
  }
  return null;
}

function substitute(nodes, values, slotChildren, state) {
  const out = [];
  for (const node of nodes) {
    if (isSlot(node)) {
      if (node.props && Object.keys(node.props).some((k) => k === 'name')) {
        state.refuse = 'it has a named slot, and only a plain <slot /> can be filled from the page';
        return out;
      }
      state.slots += 1;
      // A slot the instance gave nothing to falls back to whatever the
      // component put between its own <slot> tags, which is already its
      // children — so an empty instance leaves them where they are.
      const filling = slotChildren && slotChildren.length ? slotChildren : node.children || [];
      out.push(...filling.map((child) => ({ ...child })));
      continue;
    }

    const next = { ...node };

    if (node.props) {
      const props = {};
      for (const [key, value] of Object.entries(node.props)) {
        if (value?.type === 'expr' && Object.prototype.hasOwnProperty.call(values, value.value.trim())) {
          const replacement = values[value.value.trim()];
          if (!replacement) {
            state.refuse = `it needs a value for ${value.value.trim()}, and the instance gives none`;
            return out;
          }
          if (replacement.kind === 'string') props[key] = { type: 'string', value: replacement.value };
          else if (replacement.kind === 'bool') props[key] = { type: 'bare' };
          else props[key] = { type: 'expr', value: replacement.value };
          continue;
        }
        props[key] = value;
      }
      next.props = props;
      // The attributes were rewritten, so the line they were written on no
      // longer describes them.
      delete next.attrSource;
    }

    if (node.kind === 'expr') {
      const inner = String(node.value || '').replace(/^\{|\}$/g, '').trim();
      if (Object.prototype.hasOwnProperty.call(values, inner)) {
        const replacement = values[inner];
        if (!replacement) {
          state.refuse = `it needs a value for ${inner}, and the instance gives none`;
          return out;
        }
        if (replacement.kind === 'string') {
          out.push({ ...node, kind: 'text', value: replacement.value });
        } else if (replacement.kind === 'bool') {
          out.push({ ...node, kind: 'expr', value: '{true}' });
        } else {
          out.push({ ...node, kind: 'expr', value: `{${replacement.value}}` });
        }
        continue;
      }
    }

    if (Array.isArray(node.children)) {
      next.children = substitute(node.children, values, slotChildren, state);
      if (state.refuse) return out;
    }
    out.push(next);
  }
  return out;
}

/**
 * The nodes and imports that replace one component instance on a page.
 *
 * `{ ok: true, nodes, imports }`, or `{ ok: false, reason }` — in which case
 * nothing about the page should change. The caller writes; this decides.
 */
function inlineComponent({ componentSource, componentPath, pagePath, instance }) {
  let read;
  try {
    read = parsePage(String(componentSource || ''));
  } catch (err) {
    return { ok: false, reason: `its markup could not be read — ${err.message}` };
  }
  // The same bar the editor holds every page to. A component it cannot model
  // is one whose markup would have to be moved as text, and text moved into a
  // page is exactly what this must not do.
  if (!read.editable) {
    return { ok: false, reason: 'its markup is more than the visual editor can model' };
  }
  const parsed = read.model;

  const props = readPropNames(parsed.extraFrontmatter);
  if (!props) {
    return {
      ok: false,
      reason:
        'its frontmatter does more than take props apart, and carrying that into the page could collide with what the page already declares',
    };
  }

  const values = {};
  for (const name of props.names) values[name] = valueFor(name, instance?.props, props.defaults);

  const state = { refuse: null, slots: 0 };
  const nodes = substitute(parsed.nodes, values, instance?.children || [], state);
  if (state.refuse) return { ok: false, reason: state.refuse };

  // A name that survived is a name that was not standing on its own —
  // `{title.toUpperCase()}`, or a mention inside a bigger expression. Rewriting
  // that needs the expression understood, not a value dropped into it.
  const left = survivingProp(nodes, props.names);
  if (left) {
    return {
      ok: false,
      reason: `${left} is used inside an expression rather than on its own, so there is no single place to put its value`,
    };
  }

  if (instance?.children?.length && state.slots === 0) {
    return { ok: false, reason: 'the instance wraps content and the component has no <slot /> to put it in' };
  }

  // The component's imports, re-aimed. A relative specifier was written from
  // src/components and means something else from the page's folder; anything
  // else — an alias, a bare package, astro:content — means the same everywhere.
  const fromDir = path.dirname(componentPath);
  const pageDir = path.dirname(pagePath);
  const imports = (parsed.imports || []).map((imp) => {
    const spec = String(imp.path || '');
    if (!spec.startsWith('.')) return { ...imp };
    const rel = toPosix(path.relative(pageDir, path.resolve(fromDir, spec)));
    return { ...imp, path: rel.startsWith('.') ? rel : './' + rel };
  });

  return { ok: true, nodes, imports };
}

module.exports = { inlineComponent };
