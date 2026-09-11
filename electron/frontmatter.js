// Shared by the file writer and the frontmatter code editor. Imports remain
// editable records; their slots retain the code and whitespace between them.
// No renderer or Node dependencies: this module is also loaded by Astro.

const DEFAULT_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2;?/y;
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2;?/y;
const MEMBER = /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;

function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  for (; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i + 1;
    else if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      i = skipBraced(text, i + 1) - 1;
    }
  }
  return i;
}

function skipCodeToken(text, i) {
  if ('\'"`'.includes(text[i])) return skipQuoted(text, i);
  if (text.startsWith('//', i)) {
    const end = text.indexOf('\n', i + 2);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith('/*', i)) {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  // A regex can contain import-looking prose just as a string can.
  let before = i - 1;
  if (text[i] === '/') while (before >= 0 && /\s/.test(text[before])) before--;
  if (text[i] === '/' && (before < 0 || '=(:,[!&|?{};'.includes(text[before]))) {
    let inClass = false;
    for (let j = i + 1; j < text.length && text[j] !== '\n'; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === '[') inClass = true;
      else if (text[j] === ']') inClass = false;
      else if (text[j] === '/' && !inClass) return j + 1;
    }
  }
  return i;
}

function skipBraced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const skipped = skipCodeToken(text, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return text.length;
}

function readFrontmatter(source = '') {
  const imports = [];
  const slots = [];
  let cursor = 0;
  let extra = '';
  for (let i = 0; i < source.length; i++) {
    const skipped = skipCodeToken(source, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    if (!source.startsWith('import', i) || /[\w$.]/.test(source[i - 1] || '')) continue;
    DEFAULT_IMPORT.lastIndex = NAMED_IMPORT.lastIndex = i;
    const plain = DEFAULT_IMPORT.exec(source);
    const named = plain ? null : NAMED_IMPORT.exec(source);
    const match = plain || named;
    if (!match) continue; // namespace, side-effect and type-only imports stay code
    const quote = match[2];
    const specifier = match[3];
    const members = plain
      ? [{ name: match[1], path: specifier, quote, at: i }]
      : match[1].split(',').map((text) => text.trim()).filter(Boolean).map((text) => {
          const member = MEMBER.exec(text);
          return member && {
            name: member[3] || member[2], imported: member[2], named: true,
            path: specifier, quote, at: i, ...(member[1] ? { typeOnly: true } : {}),
          };
        });
    // Keep an unfamiliar specifier verbatim, instead of extracting half of it.
    if (!members.length || members.some((member) => !member)) continue;
    let end = i + match[0].length;
    const attribute = /^[ \t]*(?:with|assert)\s*\{/.exec(source.slice(end));
    if (attribute) {
      end = skipBraced(source, end + attribute[0].length - 1);
      if (source[end] === ';') end++;
    }
    extra += source.slice(cursor, i);
    const suffix = /^[ \t]*\r?\n/.exec(source.slice(end))?.[0] || '';
    const raw = source.slice(i, end);
    const pathEnd = match[0].lastIndexOf(quote + specifier + quote) + specifier.length + 2;
    slots.push({ at: i, offset: extra.length, source: raw, suffix, tail: raw.slice(pathEnd),
      members: members.map((member) => ({ ...member })) });
    imports.push(...members);
    cursor = end + suffix.length;
    i = cursor - 1;
  }
  extra += source.slice(cursor);
  return {
    imports,
    // All declarations stay visible to binding/schema editors, including
    // those preceding the first import. Slots preserve their source position.
    frontmatterLead: '',
    extraFrontmatter: extra.trim(),
    extraFrontmatterSpaced: /^[ \t]*\r?\n/.test(extra),
    frontmatterLayout: { extra, slots },
  };
}

const sameImport = (a, b, specFor) =>
  a.name === b.name && (specFor ? specFor(a) : a.path) === b.path &&
  a.quote === b.quote && !!a.named === !!b.named &&
  a.imported === b.imported && !!a.typeOnly === !!b.typeOnly;

function importLines(imports, specFor, tail = ';') {
  const groups = [];
  const named = new Map();
  for (const imp of imports) {
    const specifier = specFor ? specFor(imp) : imp.path;
    if (!imp.named) {
      groups.push({ members: [imp], specifier });
      continue;
    }
    let group = named.get(specifier);
    if (!group) {
      group = { members: [], specifier };
      groups.push(group);
      named.set(specifier, group);
    }
    group.members.push(imp);
  }
  return groups.map(({ members, specifier }) => {
    const first = members[0];
    const quote = first.quote === '"' ? '"' : "'";
    const names = first.named ? '{ ' + members.map((imp) => {
      const name = imp.imported && imp.imported !== imp.name ? `${imp.imported} as ${imp.name}` : imp.name;
      return imp.typeOnly ? `type ${name}` : name;
    }).join(', ') + ' }' : first.name;
    return `import ${names} from ${quote}${specifier}${quote}${tail}`;
  });
}

// Preserve the whitespace outside the editable code field. The code editor
// sees that whitespace directly through writeFrontmatter/readFrontmatter;
// declaration fields edit the trimmed code without removing its surroundings.
function withWhitespace(raw, value = '') {
  if (value === raw.trim()) return raw;
  const from = raw.length - raw.trimStart().length;
  const to = Math.max(from, raw.trimEnd().length);
  return raw.slice(0, from) + value + raw.slice(to);
}

// Map import slots through edits to the declarations field. Work on lines so
// an import can never land inside an edited string or identifier. Trim the
// unchanged ends first: changing one line in a large collection stays cheap.
function moveOffsets(before, after, offsets) {
  if (before === after || !offsets.length) return offsets;
  const split = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const a = split(before);
  const b = split(after);
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > first && bEnd > first && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  const n = aEnd - first;
  const m = bEnd - first;
  const dp = [];
  // A wholesale replacement has no useful interior anchors. Bound the table
  // and keep its imports in order at the replacement's start in that case.
  if (n * m <= 262144) {
    for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[first + i] === b[first + j]
          ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const moved = [];
  let oldAt = 0;
  let newAt = 0;
  let slot = 0;
  const take = (oldText, newText, same) => {
    const end = oldAt + oldText.length;
    while (slot < offsets.length && offsets[slot] < end) {
      moved.push(newAt + (same ? offsets[slot] - oldAt : 0));
      slot++;
    }
    oldAt = end;
    newAt += newText.length;
  };
  for (let i = 0; i < first; i++) take(a[i], b[i], true);
  let i = first;
  let j = first;
  while (i < aEnd || j < bEnd) {
    if (i < aEnd && j < bEnd && a[i] === b[j]) take(a[i++], b[j++], true);
    else if (i < aEnd && (j === bEnd || !dp.length || dp[i - first + 1][j - first] >= dp[i - first][j - first + 1])) take(a[i++], '', false);
    else take('', b[j++], false);
  }
  while (i < a.length) take(a[i++], b[j++], true);
  while (slot++ < offsets.length) moved.push(newAt);
  return safeImportOffsets(after, moved);
}

// Matching a line inside a newly added template or function does not make it
// a legal place for an import. Advance displaced slots to a statement boundary
// outside strings, comments and nested expressions; keep their relative order.
function safeImportOffsets(text, offsets) {
  const safe = [];
  let slot = 0;
  let depth = 0;
  let lineStart = true;
  let ended = true;
  let previous = '';
  for (let i = 0; i < text.length && slot < offsets.length; i++) {
    if (!depth && (ended || (lineStart && !'=(:,[!&|?+-*/.'.includes(previous)))) {
      while (slot < offsets.length && offsets[slot] <= i) { safe.push(i); slot++; }
    }
    const skipped = skipCodeToken(text, i);
    if (skipped !== i) {
      if (text[i] !== '/') { previous = text[i]; lineStart = ended = false; }
      i = skipped - 1;
      continue;
    }
    const char = text[i];
    if (char === '\n') { lineStart = true; continue; }
    if (/\s/.test(char)) continue;
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    ended = char === ';' && depth === 0;
    lineStart = false;
    previous = char;
  }
  while (slot++ < offsets.length) safe.push(text.length);
  return safe;
}

function writeFrontmatter(model, specFor) {
  const layout = model.frontmatterLayout;
  if (!layout) {
    const lines = [];
    if (model.frontmatterLead) lines.push(model.frontmatterLead);
    lines.push(...importLines(model.imports || [], specFor));
    if (model.extraFrontmatter) {
      if (lines.length && model.extraFrontmatterSpaced !== false) lines.push('');
      lines.push(model.extraFrontmatter);
    }
    return lines.join('\n');
  }
  const groups = new Map(layout.slots.map((slot) => [slot.at, []]));
  const added = [];
  for (const imp of model.imports || []) {
    const group = groups.get(imp.at);
    if (group) group.push(imp);
    else added.push(imp);
  }
  // A newly used named export can join its existing declaration. Separate
  // declarations already in the source keep their individual positions.
  const additions = [];
  for (const imp of added) {
    const slot = imp.named && layout.slots.find((s) => groups.get(s.at).some((g) => g.named && g.path === imp.path));
    if (slot) groups.get(slot.at).push(imp);
    else additions.push(imp);
  }
  const extra = withWhitespace(layout.extra, model.extraFrontmatter);
  const offsets = moveOffsets(layout.extra, extra, layout.slots.map((slot) => slot.offset));
  let output = model.frontmatterLead ? model.frontmatterLead + '\n' : '';
  let from = 0;
  for (let i = 0; i < layout.slots.length; i++) {
    const slot = layout.slots[i];
    const members = groups.get(slot.at);
    output += extra.slice(from, offsets[i]);
    from = offsets[i];
    if (members.length) {
      if (extra !== layout.extra && from === extra.length && output && !/\n$/.test(output)) output += '\n';
      const untouched = members.length === slot.members.length &&
        members.every((imp, index) => sameImport(imp, slot.members[index], specFor));
      output += (untouched ? slot.source : importLines(members, specFor, slot.tail).join('\n')) + slot.suffix;
    }
    if (i === layout.slots.length - 1 && additions.length) {
      if (output && !/\n$/.test(output)) output += '\n';
      output += importLines(additions, specFor).join('\n');
      if (extra.slice(from)) output += '\n';
    }
  }
  if (!layout.slots.length && additions.length) {
    from = extra.length - extra.trimStart().length;
    output += extra.slice(0, from);
    output += importLines(additions, specFor).join('\n');
    if (extra.slice(from)) output += '\n';
  }
  return output + extra.slice(from);
}

module.exports = { readFrontmatter, writeFrontmatter };
