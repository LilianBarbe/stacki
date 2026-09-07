// Where the code is in an .astro file.
//
// Astro is HTML with TypeScript in it, in three places: the frontmatter
// between the `---` fences, `{expressions}` in text and in attributes, and
// `` `template ${literals}` `` as attribute values. The markup parser knows
// none of this, and cannot be taught it from the outside: a `>` inside
// `{n > 1}` ends the tag for it, a `'` in the JSX inside `{list.map(...)}`
// starts nothing it understands. So the code is found here, by a scanner
// that reads the file the way Astro's own compiler does — enough of the
// markup to know when it is in a tag, a comment, a <script>, and enough of
// the code to know when it is in a string, a template, a comment, or the
// JSX of an expression — and hands back the ranges for the TypeScript
// parser to take over (see astroLanguage.js).
//
// The fences stay markup; the braces go with their expression. Lezer parses
// every range of one overlay as a single piece of code, one after the other
// with nothing in between, so `{a}` and `{b}` as `a` and `b` would read as
// `a b` — and `{...rest}` then `{n}` as `...rest n`, which is a property
// access. With the braces in, each expression is a block of its own, and a
// mistake in one stays in it.

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style']);
// A `<` after one of these is JSX, not "less than": the word before it
// cannot be the left side of a comparison.
const JSX_AFTER = new Set(['return', 'yield', 'await', 'typeof', 'void', 'delete', 'case', 'do', 'else', 'in', 'of', 'instanceof', 'new', 'throw']);

/**
 * The frontmatter's code: the range between the two fences, or null when
 * the file has none. The opening fence is the first thing in the file; the
 * closing one is a `---` alone on its line. An unclosed fence is one being
 * typed, and runs to the end.
 */
export function frontmatterRange(text) {
  const open = /^\s*---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!open) return null;
  const from = open[0].length;
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(from));
  return { from, to: close ? from + close.index : text.length };
}

/**
 * Every code range in `text`, in order: the frontmatter, then each
 * expression (braces included) and template attribute in the markup.
 * Ranges never overlap; an expression that isn't closed runs to the end
 * of the file, as it does for Astro.
 */
export function codeRanges(text) {
  const out = [];
  const add = (from, to) => { if (to > from) out.push({ from, to }); };
  let i = 0;
  const fm = frontmatterRange(text);
  if (fm) {
    add(fm.from, fm.to);
    // Past the closing fence line.
    const nl = text.indexOf('\n', fm.to);
    i = nl === -1 ? text.length : nl + 1;
  }
  markup(text, i, text.length, add);
  return out;
}

const isNameStart = (c) => /[A-Za-z]/.test(c);
const isWord = (c) => /[\w$]/.test(c);

/** Scans markup from `i` to `end`, reporting code ranges through `add`. */
function markup(text, i, end, add) {
  while (i < end) {
    const c = text[i];
    if (c === '<') {
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4);
        i = close === -1 ? end : close + 3;
        continue;
      }
      const next = text[i + 1];
      if (next && (isNameStart(next) || next === '/' || next === '!' || next === '?')) {
        const tag = scanTag(text, i, end, add);
        i = tag.end;
        // <script>, <style> and is:raw keep their contents as they are.
        if (tag.open && !tag.selfClosing && (RAW.has(tag.name.toLowerCase()) || tag.raw)) {
          i = skipRaw(text, i, end, tag.name);
        }
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') {
      const close = code(text, i + 1, end, '}');
      add(i, Math.min(close + 1, end));
      i = close + 1;
      continue;
    }
    i++;
  }
}

/**
 * A tag from its `<` to past its `>`. Attribute values in quotes are
 * markup; `{…}` values, `{…}` and `{…spread}` attributes and backtick
 * values are code. Returns where the tag ended and what it was.
 */
function scanTag(text, i, end, add) {
  const closing = text[i + 1] === '/';
  let j = i + (closing ? 2 : 1);
  const nameStart = j;
  while (j < end && /[^\s/>]/.test(text[j])) j++;
  const name = text.slice(nameStart, j);
  let raw = false;
  let selfClosing = false;
  while (j < end) {
    const c = text[j];
    if (c === '>') { j++; break; }
    if (c === '/' && text[j + 1] === '>') { selfClosing = true; j += 2; break; }
    if (c === '"' || c === "'") {
      const q = text.indexOf(c, j + 1);
      j = q === -1 ? end : q + 1;
      continue;
    }
    if (c === '`') {
      const close = code(text, j + 1, end, '`');
      add(j, Math.min(close + 1, end));
      j = close + 1;
      continue;
    }
    if (c === '{') {
      const close = code(text, j + 1, end, '}');
      add(j, Math.min(close + 1, end));
      j = close + 1;
      continue;
    }
    if (/\s/.test(c)) { j++; continue; }
    // An attribute name.
    const start = j;
    while (j < end && /[^\s/>="'`{]/.test(text[j])) j++;
    if (j === start) { j++; continue; }
    if (text.slice(start, j) === 'is:raw') raw = true;
  }
  return { end: j, name, open: !closing, selfClosing, raw };
}

/** Past the `</name>` that closes a raw element, or the end. */
function skipRaw(text, i, end, name) {
  const re = new RegExp(`</${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'ig');
  re.lastIndex = i;
  const m = re.exec(text);
  return m ? m.index : end;
}

/**
 * Code from `i` to the `until` character that ends it — the `}` matching
 * an opening brace, or the closing backtick of a template — with strings,
 * templates, comments, nested braces and JSX stepped over. Returns the
 * index of that character, or `end` when it never comes.
 */
function code(text, i, end, until) {
  let depth = 0;
  // In a template literal, only `${` opens code and only its `}` closes it.
  if (until === '`') return template(text, i, end);
  while (i < end) {
    const c = text[i];
    if (c === until && depth === 0) return i;
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    if (c === '"' || c === "'") { i = string(text, i, end); continue; }
    if (c === '`') { i = template(text, i + 1, end) + 1; continue; }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? end : nl; continue; }
    if (c === '/' && text[i + 1] === '*') { const close = text.indexOf('*/', i + 2); i = close === -1 ? end : close + 2; continue; }
    if (c === '<' && jsxStartsAt(text, i)) { i = jsx(text, i, end); continue; }
    i++;
  }
  return end;
}

/** Past a quoted string starting at `i`. */
function string(text, i, end) {
  const q = text[i];
  for (let j = i + 1; j < end; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === q || text[j] === '\n') return j + 1;
  }
  return end;
}

/** The index of the backtick closing a template whose body starts at `i`. */
function template(text, i, end) {
  while (i < end) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') { i = code(text, i + 2, end, '}') + 1; continue; }
    i++;
  }
  return end;
}

/**
 * Whether the `<` at `i` opens JSX rather than comparing. It does when
 * what comes before it cannot be a value: the start, an operator, an
 * opening bracket, or a keyword like `return`.
 */
function jsxStartsAt(text, i) {
  const n = text[i + 1];
  if (!n || !(isNameStart(n) || n === '>' || n === '/')) return false;
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const p = text[j];
  if (p === ')' || p === ']' || p === '"' || p === "'" || p === '`') return false;
  if (!isWord(p)) return true;
  let s = j;
  while (s > 0 && isWord(text[s - 1])) s--;
  return JSX_AFTER.has(text.slice(s, j + 1));
}

/**
 * Past the JSX element starting at `i`: its tag, its children (with their
 * own tags and `{expressions}`), and its closing tag. A void element
 * (`<br>`) or a self-closed one has no children.
 */
function jsx(text, i, end) {
  const tag = jsxTag(text, i, end);
  let j = tag.end;
  if (tag.selfClosing || VOID.has(tag.name.toLowerCase())) return j;
  while (j < end) {
    const c = text[j];
    if (c === '{') { j = code(text, j + 1, end, '}') + 1; continue; }
    if (c === '<') {
      if (text.startsWith('<!--', j)) { const close = text.indexOf('-->', j + 4); j = close === -1 ? end : close + 3; continue; }
      if (text[j + 1] === '/') return jsxTag(text, j, end).end;
      if (isNameStart(text[j + 1] || '') || text[j + 1] === '>') { j = jsx(text, j, end); continue; }
    }
    j++;
  }
  return end;
}

/** A JSX tag from its `<` to past its `>`; attribute expressions stepped over. */
function jsxTag(text, i, end) {
  const closing = text[i + 1] === '/';
  let j = i + (closing ? 2 : 1);
  const nameStart = j;
  while (j < end && /[^\s/>]/.test(text[j])) j++;
  const name = text.slice(nameStart, j);
  let selfClosing = false;
  while (j < end) {
    const c = text[j];
    if (c === '>') { j++; break; }
    if (c === '/' && text[j + 1] === '>') { selfClosing = true; j += 2; break; }
    if (c === '"' || c === "'") { const q = text.indexOf(c, j + 1); j = q === -1 ? end : q + 1; continue; }
    if (c === '`') { j = template(text, j + 1, end) + 1; continue; }
    if (c === '{') { j = code(text, j + 1, end, '}') + 1; continue; }
    j++;
  }
  return { end: j, name, selfClosing };
}
