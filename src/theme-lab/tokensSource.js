// Theme Lab — reads the token files as text so the panel shows the variables in
// the order, groups and wording of the source. The file is the only list; the
// panel never keeps a copy of the names.

const SECTION_RE = /^\s*\/\*\s*[─\-—]{3,}\s*(.+?)\s*[─\-—]{3,}\s*\*\/\s*$/;
const VAR_RE = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*([\s\S]*?)\s*\*\/)?\s*$/;

// The body of the first `:root { … }` block, with its offset in the file.
function rootBody(text) {
  const at = text.indexOf(':root');
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

// Strips comment markers and leading `*` from one comment line.
const cleanComment = (line) =>
  line
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*\*\s?/, '')
    .trim();

/**
 * @returns {{ title: string, vars: { name, value, doc, file, line }[] }[]}
 */
export function parseRootSource(text, file, defaultTitle = 'General') {
  const body = rootBody(text);
  if (body == null) return [];
  const headerLines = text.slice(0, text.indexOf(body)).split('\n').length - 1;
  const groups = [];
  let group = { title: defaultTitle, vars: [] };
  let pending = []; // comment lines waiting for the next variable
  let inComment = false;

  body.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const section = line.match(SECTION_RE);
    if (section) {
      if (group.vars.length) groups.push(group);
      group = { title: section[1].trim(), vars: [] };
      pending = [];
      inComment = false;
      return;
    }
    const v = !inComment && line.match(VAR_RE);
    if (v) {
      const doc = (v[3] ? [v[3]] : pending).map(cleanComment).filter(Boolean).join(' ');
      group.vars.push({ name: v[1], value: v[2].trim(), doc, file, line: headerLines + i + 1 });
      if (v[3]) pending = [];
      return;
    }
    if (!line.trim()) {
      pending = [];
      inComment = false;
      return;
    }
    if (/^\s*\/\*/.test(line) || inComment) {
      if (!inComment) pending = [];
      pending.push(line);
      inComment = !/\*\/\s*$/.test(line);
    }
  });
  if (group.vars.length) groups.push(group);
  return groups;
}
