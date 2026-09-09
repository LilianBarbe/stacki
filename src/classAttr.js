// Putting a class on an element whose classes are not a plain string.
//
// Typing `.hero` in the style panel writes a rule for `.hero`, and a rule for a
// class the element does not carry never applies — so the class goes on the
// element too. `class="a b"` is easy. The elements worth styling often aren't
// that: a component that takes a `class` prop writes
//
//   class:list={["section", padClass("top", paddingTop), …, className]}
//
// and the app used to leave those alone, silently. Nothing appeared in the
// class attribute and nothing said why.
//
// A class:list is a list, so a class is appended to it — the same edit a person
// would make, in the same place. A `class` written as a template literal grows
// by one word inside the quotes. Anything else is a value whose meaning this
// cannot know (`class={cx(a, b)}`), and it says so rather than guessing.

const LIST = 'class:list';

const quoted = (name) => `"${name}"`;

/** Every class name the attribute mentions literally. */
export function namesIn(prop) {
  if (!prop) return [];
  if (prop.type === 'string') return String(prop.value).trim().split(/\s+/).filter(Boolean);
  const text = String(prop.value || '');
  // Quoted strings in an expression, plus the words inside a template literal —
  // the literal parts only, since `${theme}` is not a name until it runs.
  const out = [];
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? '';
    for (const word of inner.split(/\$\{[^}]*\}|\s+/)) if (word) out.push(word);
  }
  return out;
}

/** Whether the element already carries `name`, however its classes are written. */
export function hasClass(props, name) {
  const clean = String(name || '').trim();
  if (!clean) return true;
  return ['class', LIST].some((key) => namesIn(props?.[key]).includes(clean));
}

/**
 * The single prop to write so the element carries `name`, as
 * `{ key, value }` — or null when its classes are code that cannot be
 * extended without guessing at what it means.
 *
 * Returns null for "already there" as well: the caller has `hasClass` for
 * telling those apart, and neither is an edit.
 */
export function withClass(props, name) {
  const clean = String(name || '').trim();
  if (!clean || /\s/.test(clean)) return null;
  if (hasClass(props, clean)) return null;

  const list = props?.[LIST];
  if (list) {
    if (list.type !== 'expr') return null;
    const text = String(list.value || '').trim();
    const at = text.lastIndexOf(']');
    if (!text.startsWith('[') || at < 0) {
      // A list that isn't written as one — `class:list={props.classes}`. It
      // still takes an array, so wrap it in the one being added to.
      return { key: LIST, value: { type: 'expr', value: `[${text}, ${quoted(clean)}]` } };
    }
    const head = text.slice(0, at);
    const tail = text.slice(at);
    // Keep the shape it was written in: a list broken over lines gets its own
    // line, indented like the entry above it, trailing comma and all.
    const lines = head.split('\n');
    const last = lines[lines.length - 1];
    if (lines.length > 1) {
      const indent = (head.match(/\n([ \t]*)\S/) || [, '  '])[1];
      const comma = /,\s*$/.test(head) ? '' : ',';
      const gap = /\n\s*$/.test(head) ? '' : '\n';
      return {
        key: LIST,
        value: { type: 'expr', value: `${head.replace(/\s+$/, '')}${comma}\n${indent}${quoted(clean)},\n${last.match(/^[ \t]*/)[0]}${tail}` },
      };
    }
    const comma = /\[\s*$/.test(head) ? '' : ', ';
    return { key: LIST, value: { type: 'expr', value: `${head}${comma}${quoted(clean)}${tail}` } };
  }

  const cls = props?.class;
  if (!cls) return { key: 'class', value: { type: 'string', value: clean } };
  if (cls.type === 'string') {
    const words = namesIn(cls);
    return { key: 'class', value: { type: 'string', value: [...words, clean].join(' ') } };
  }
  if (cls.type === 'expr') {
    const text = String(cls.value || '').trim();
    // A template literal is a string being built: one more word in it is one
    // more class, wherever the holes happen to be.
    if (text.startsWith('`') && text.endsWith('`') && text.length > 1) {
      return { key: 'class', value: { type: 'expr', value: `${text.slice(0, -1)} ${clean}\`` } };
    }
  }
  return null;
}

/**
 * The edits that take `name` OFF the element, as `[{ key, value }]` — `value`
 * undefined when the attribute has nothing left in it and should go. Null when
 * the element does not carry the class, or carries it in code this cannot
 * rewrite without guessing (`class={cx(a, b)}`).
 *
 * A class can be named in more than one place (`class` and `class:list`); it
 * comes out of every one it is written in, so the element really stops
 * carrying it. Each place keeps the shape it was written in: a word leaves a
 * string, an entry leaves a list (its own line when it had one, comma and
 * all), a word leaves a template literal.
 */
export function withoutClass(props, name) {
  const clean = String(name || '').trim();
  if (!clean || /\s/.test(clean)) return null;
  if (!hasClass(props, clean)) return null;
  const edits = [];
  for (const key of ['class', LIST]) {
    const prop = props?.[key];
    if (!prop || !namesIn(prop).includes(clean)) continue;
    const next = stripFrom(prop, clean);
    if (next === null) return null;
    edits.push({ key, value: next });
  }
  return edits.length ? edits : null;
}

// One attribute value without `name`, or null when it is code that can't be
// read. `undefined` for an attribute with nothing left to say.
function stripFrom(prop, name) {
  if (prop.type === 'string') {
    const words = namesIn(prop).filter((w) => w !== name);
    return words.length ? { type: 'string', value: words.join(' ') } : undefined;
  }
  if (prop.type !== 'expr') return null;
  const text = String(prop.value || '');
  const trimmed = text.trim();
  // A template literal is a string being built: the word leaves, the holes stay.
  if (isTemplate(trimmed)) {
    const kept = dropWord(trimmed.slice(1, -1), name);
    return kept.trim() ? { type: 'expr', value: `\`${kept}\`` } : undefined;
  }
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  const entries = splitEntries(text, open + 1, close);
  // Which entries name the class, and how. An entry that IS the class leaves
  // the list; a string of several words drops the one; a template literal
  // likewise. Anything else that mentions it — `isWide && "is-wide"`, a
  // ternary — is a class this element carries only sometimes, and taking the
  // word out of it would change what the code decides. Refused, out loud.
  let out = text;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const body = text.slice(e.start, e.end);
    const literal = /^(["'`])[^"'`]*\1$/.test(body);
    const words = literal ? body.slice(1, -1).split(/\$\{[^}]*\}|\s+/).filter(Boolean) : [];
    if (literal) {
      if (!words.includes(name)) continue;
      if (words.length === 1 && !/\$\{/.test(body)) {
        out = out.slice(0, e.cutStart) + out.slice(e.cutEnd);
        continue;
      }
      const kept = dropWord(body.slice(1, -1), name);
      if (!kept.trim()) out = out.slice(0, e.cutStart) + out.slice(e.cutEnd);
      else out = out.slice(0, e.start) + body[0] + kept + body[0] + out.slice(e.end);
      continue;
    }
    if (namesIn({ type: 'expr', value: body }).includes(name)) return null;
  }
  if (out === text) return null;
  if (/^\s*\[\s*\]\s*$/.test(out)) return undefined;
  return { type: 'expr', value: out };
}

const isTemplate = (text) => text.length > 1 && text.startsWith('`') && text.endsWith('`');

// A word out of a string, holes left alone. Runs of whitespace the word sat in
// collapse, so `card  hero` minus `hero` is `card`, not `card `.
const dropWord = (body, name) =>
  body
    .split(/(\$\{[^}]*\})/)
    .map((part) =>
      part.startsWith('${') ? part : part.split(/\s+/).filter((w) => w !== name).join(' ')
    )
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * The top-level entries of an array literal's inside, `text[from, to)`, as
 * trimmed spans — plus, for each, the span to cut so the entry leaves the list
 * with its own comma and whitespace, and the list keeps the shape it had:
 * an entry with a line of its own takes the line with it, the last entry
 * hands its trailing comma (or the lack of one) to the entry before it.
 */
function splitEntries(text, from, to) {
  const spans = [];
  let depth = 0;
  let start = from;
  let i = from;
  const closeEntry = (at) => {
    const raw = text.slice(start, at);
    const lead = raw.match(/^\s*/)[0].length;
    const trail = raw.match(/\s*$/)[0].length;
    if (raw.trim()) spans.push({ start: start + lead, end: at - trail, sep: at });
    start = at + 1;
  };
  while (i < to) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < to && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) closeEntry(i);
    i++;
  }
  closeEntry(to);
  // `sep` is the comma that follows the entry (or `to` for the last one).
  return spans.map((e, k) => {
    const next = spans[k + 1];
    const prev = spans[k - 1];
    if (next) return { ...e, cutStart: e.start, cutEnd: next.start };
    // The last entry: cut from just after the previous one's text, so its
    // comma (if any) goes and the previous entry ends the way this one did.
    const hadComma = e.sep < to && text[e.sep] === ',';
    if (!prev) return { ...e, cutStart: from, cutEnd: to };
    return { ...e, cutStart: hadComma ? prev.sep + 1 : prev.sep, cutEnd: hadComma ? e.sep + 1 : e.end };
  });
}

/**
 * The edits that swap `from` for `to` on the element, in place — the family
 * menu on a chip (`margin-bottom-2` → `margin-bottom-4`). `[{ key, value }]`,
 * or null when the element does not carry `from`, or carries it in code that
 * cannot be rewritten. A word is renamed wherever it is written literally:
 * in a `class` string, an entry or a word of a `class:list`, a template
 * literal — even inside a condition (`isWide && "from"`), since a rename
 * changes no logic. When the element already has `to`, `from` simply leaves.
 */
export function withReplacedClass(props, from, to) {
  const a = String(from || '').trim();
  const b = String(to || '').trim();
  if (!a || !b || /\s/.test(b) || a === b) return null;
  if (!hasClass(props, a)) return null;
  if (hasClass(props, b)) return withoutClass(props, a);
  const edits = [];
  for (const key of ['class', LIST]) {
    const prop = props?.[key];
    if (!prop || !namesIn(prop).includes(a)) continue;
    if (prop.type === 'string') {
      edits.push({ key, value: { type: 'string', value: namesIn(prop).map((w) => (w === a ? b : w)).join(' ') } });
      continue;
    }
    if (prop.type !== 'expr') return null;
    const text = String(prop.value || '');
    const renamed = text.replace(/(["'`])([^"'`]*)\1/g, (m, q, body) =>
      q +
      body
        .split(/(\$\{[^}]*\})/)
        .map((part) => (part.startsWith('${') ? part : part.split(/(\s+)/).map((w) => (w === a ? b : w)).join('')))
        .join('') +
      q
    );
    if (renamed === text) return null;
    edits.push({ key, value: { type: 'expr', value: renamed } });
  }
  return edits.length ? edits : null;
}

/**
 * Whether the element takes a class at all — the rule the Settings panel's
 * Class field follows, so the style panel's well offers the same thing in the
 * same cases.
 *
 * An element always does. A component only when it says so: a `class` in its
 * props (its own, or the tag's it extends, or `...rest` passing it through —
 * all of which land in `schema` as a `class` field), or one already written on
 * the call site. A component that takes no class would just ignore one, and a
 * rule for it would style nothing.
 */
export function acceptsClass(node, schema) {
  if (!node) return false;
  if (node.kind === 'element' || node.dynamicTag) return true;
  if (node.kind !== 'component') return false;
  if ((schema || []).some((f) => f.name === 'class')) return true;
  return node.props?.class !== undefined || node.props?.[LIST] !== undefined;
}

export default withClass;
