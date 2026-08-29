// An imported asset, seen from a data file.
//
//   const SCREENS = [
//     { label: "Daily devotionals", image: dailyDevotionals },
//   ];
//
// `dailyDevotionals` is a name, and the file above it says what the name is:
//
//   import dailyDevotionals from '@/assets/images/app-daily-devotionals.webp';
//
// Read on its own the name says nothing — a word in a code field, which is
// what the CMS showed for a row that is a picture. Read together with the
// import it IS the picture, and swapping it means binding the name to another
// file, or writing a new name and importing that one.
//
// This file holds that reading and that writing, over the file's own text:
// which names are imports, what a new import should be called, where it goes,
// and which specifier to write it with. Nothing here evaluates anything — an
// import is a line, and a line is something a text editor can be sure of.

// `import name from '…'` — the only form a picker can repoint, since the name
// stands for the file itself. `import { a } from` and `import * as ns from`
// name something inside a module, which is not a file to swap.
const DEFAULT_IMPORT =
  /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*$/gm;

/** Every `import name from 'spec'` in the source, in the order written. */
function defaultImports(source) {
  const out = [];
  const re = new RegExp(DEFAULT_IMPORT.source, 'gm');
  let m;
  while ((m = re.exec(String(source || ''))) !== null) {
    out.push({ name: m[1], spec: m[3], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The name an import binds, or null when nothing imports it. */
function importedAs(source, name) {
  return defaultImports(source).find((i) => i.name === name) || null;
}

// Where a new import goes: after the last one, which is where a person adding
// one would put it. A file with no imports yet gets it at the very top —
// before the constant it is for, which is the only ordering that compiles.
function importInsertAt(source) {
  const all = defaultImports(source);
  const anyImport = /^[ \t]*import\b[^\n]*$/gm;
  let end = null;
  let m;
  while ((m = anyImport.exec(String(source || ''))) !== null) end = m.index + m[0].length;
  if (all.length) end = Math.max(end ?? 0, all[all.length - 1].end);
  return end === null ? 0 : end;
}

/** The source with `import name from 'spec';` written into it. */
function addImport(source, name, spec) {
  const text = String(source || '');
  const line = `import ${name} from '${spec}';`;
  const at = importInsertAt(text);
  if (at === 0) return `${line}\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  return `${text.slice(0, at)}\n${line}${text.slice(at)}`;
}

// What to call the import. The file's own name for the image, in the shape a
// JavaScript name has to be — `app-daily-devotionals.webp` is
// `appDailyDevotionals` — and never one the file is already using for
// something else.
function importName(fileRel, taken = []) {
  const base = String(fileRel || '')
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '');
  const camel = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
  let candidate = /^[A-Za-z_$]/.test(camel) ? camel : `_${camel}`;
  if (!candidate) candidate = 'asset';
  const used = new Set(taken);
  if (!used.has(candidate)) return candidate;
  let n = 2;
  while (used.has(`${candidate}${n}`)) n += 1;
  return `${candidate}${n}`;
}

// How to write the path. A file that reaches its own src/ through an alias
// says so in every import it already has, and a new one written relative
// beside them would be the odd line out — so the alias is reused when the
// imports show one. (The renderer decides this the same way for a page's
// markup; this is the same rule over a file's text.)
function importSpecFor({ imports = [], srcRelative, relative }) {
  if (srcRelative) {
    for (const imp of imports) {
      if (imp.spec.startsWith('.')) continue;
      for (const marker of ['/components/', '/layouts/', '/assets/']) {
        const idx = imp.spec.indexOf(marker);
        if (idx > 0) return imp.spec.slice(0, idx + 1) + srcRelative;
      }
    }
  }
  return relative;
}

// A value the CMS carries as source — `{ __expr: "dailyDevotionals" }` — with
// the file that name is bound to written beside it, so the field can show the
// picture instead of the word. `resolve` answers what a name imports, as a
// project-relative path, or null.
function withAssets(value, resolve) {
  if (Array.isArray(value)) return value.map((v) => withAssets(v, resolve));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.__expr === 'string') {
    const rel = resolve(value.__expr);
    return rel ? { ...value, __asset: rel } : value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = withAssets(v, resolve);
  return out;
}

module.exports = {
  defaultImports,
  importedAs,
  importInsertAt,
  addImport,
  importName,
  importSpecFor,
  withAssets,
};
