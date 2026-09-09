// Vite plugin behind Theme Lab's "Save to file" (dev server only).
//
// POST /__theme-lab/save
//   { files: { "src/style-panel/tokens.css": { "--name": "value", … } } }
//   Each value replaces the first `--name: …;` declaration in that file — the
//   `:root` block sits at the top of both token files, so that is the one edited.
//
// POST /__theme-lab/save-rules
//   { edits: [{ file, selector, ordinal, prop, value }] }
//   `file` is the absolute path Vite tagged the sheet with; `selector` is the
//   CSSOM's serialisation of the rule's selector and `ordinal` which of the
//   file's rules with that selector it is (in source order). The declaration is
//   rewritten in place, appended to the block when the rule lacks it, and
//   dropped when `value` is empty. Only .css files under src/ are writable.
//
// Both leave comments and layout alone.
import fs from 'node:fs';
import path from 'node:path';

const WRITABLE = new Set(['src/style-panel/tokens.css', 'src/styles.css']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function rewriteDeclarations(text, values) {
  const missing = [];
  for (const [name, value] of Object.entries(values)) {
    if (!/^--[A-Za-z0-9_-]+$/.test(name) || /[;{}]/.test(value)) {
      missing.push(name);
      continue;
    }
    const re = new RegExp(`(^[ \\t]*${escapeRe(name)}[ \\t]*:[ \\t]*)([^;\\n]+)(;)`, 'm');
    if (!re.test(text)) {
      missing.push(name);
      continue;
    }
    text = text.replace(re, (_m, before, _old, semi) => `${before}${value.trim()}${semi}`);
  }
  return { text, missing };
}

// ---------------------------------------------------------------- rule blocks

// The CSSOM and the source spell a selector differently (`.a>.b` vs `.a > .b`,
// quotes, `:before` vs `::before`); compare them on a common form.
export function normalizeSelector(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/(^|[^:]):(before|after|first-line|first-letter|selection|placeholder)\b/g, '$1::$2')
    .trim()
    .toLowerCase();
}

// Every style rule block in the file: {selector, bodyStart, bodyEnd} with the
// body range excluding the braces. At-rule blocks (@media…) are descended into
// but not listed.
export function ruleBlocks(text) {
  const out = [];
  const stack = [];
  let preludeStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '{') {
      const prelude = text.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      stack.push({ prelude, bodyStart: i + 1 });
      preludeStart = i + 1;
    } else if (ch === '}') {
      const block = stack.pop();
      if (block && block.prelude && !block.prelude.startsWith('@')) {
        out.push({ selector: block.prelude, bodyStart: block.bodyStart, bodyEnd: i });
      }
      preludeStart = i + 1;
    } else if (ch === ';') {
      preludeStart = i + 1;
    }
  }
  return out;
}

// Rewrites one declaration inside a block body. Returns the new body, or null
// when nothing changed.
function rewriteBody(body, prop, value) {
  const re = new RegExp(`(^|[;{\\s])(${escapeRe(prop)})\\s*:\\s*([^;}]*?)(\\s*!important)?\\s*(;|$)`, 'gi');
  const matches = [...body.matchAll(re)];
  if (value === '') {
    if (!matches.length) return null;
    const m = matches[matches.length - 1];
    // Drop the declaration and the line it sat on when that leaves it blank.
    let start = m.index + m[1].length;
    let end = m.index + m[0].length;
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = body.indexOf('\n', end);
    const line = body.slice(lineStart, lineEnd < 0 ? body.length : lineEnd);
    if (line.replace(m[0].slice(m[1].length), '').trim() === '') {
      start = lineStart;
      end = lineEnd < 0 ? body.length : lineEnd + 1;
    }
    return body.slice(0, start) + body.slice(end);
  }
  if (matches.length) {
    const m = matches[matches.length - 1]; // the last one wins in CSS, so that is the one edited
    const keep = m[4] || '';
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    const semi = m[5];
    return body.slice(0, start) + `${m[2]}: ${value}${keep}${semi}` + body.slice(end);
  }
  // Not there: append, on its own line when the block is multi-line.
  const multiline = body.includes('\n');
  if (multiline) {
    const indent = (body.match(/\n([ \t]+)\S/) || [, '  '])[1];
    const trimmed = body.replace(/\s+$/, '');
    const trailing = body.slice(trimmed.length);
    const closingIndent = trailing.includes('\n') ? trailing.slice(trailing.lastIndexOf('\n') + 1) : '';
    return `${trimmed}${trimmed.trim().endsWith(';') || !trimmed.trim() ? '' : ';'}\n${indent}${prop}: ${value};\n${closingIndent}`;
  }
  const t = body.trim();
  return ` ${t}${t && !t.endsWith(';') ? ';' : ''} ${prop}: ${value}; `;
}

export function rewriteRules(text, edits) {
  const missing = [];
  // Apply from the end of the file backwards so earlier offsets stay valid.
  const located = [];
  const blocks = ruleBlocks(text);
  for (const e of edits) {
    const want = normalizeSelector(e.selector);
    const same = blocks.filter((b) => normalizeSelector(b.selector) === want);
    const block = same[e.ordinal] || (same.length === 1 ? same[0] : null);
    if (!block) {
      missing.push(`${e.selector} { ${e.prop} }`);
      continue;
    }
    located.push({ ...e, block });
  }
  located.sort((a, b) => b.block.bodyStart - a.block.bodyStart);
  // Several edits on one block: rewrite the body cumulatively.
  const byBlock = new Map();
  for (const l of located) {
    const key = l.block.bodyStart;
    if (!byBlock.has(key)) byBlock.set(key, { block: l.block, body: text.slice(l.block.bodyStart, l.block.bodyEnd) });
    const b = byBlock.get(key);
    const next = rewriteBody(b.body, l.prop, l.value);
    if (next == null) missing.push(`${l.selector} { ${l.prop} }`);
    else b.body = next;
  }
  for (const { block, body } of [...byBlock.values()].sort((a, b) => b.block.bodyStart - a.block.bodyStart)) {
    text = text.slice(0, block.bodyStart) + body + text.slice(block.bodyEnd);
  }
  return { text, missing };
}

// ---------------------------------------------------------------- server

function readJson(req, cb) {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      cb(null, JSON.parse(raw || '{}'));
    } catch {
      cb(new Error('bad JSON'));
    }
  });
}

export function themeLab() {
  return {
    name: 'stacki-theme-lab',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const srcDir = path.join(root, 'src') + path.sep;
      const replyWith = (res) => (code, body) => {
        res.statusCode = code;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };

      server.middlewares.use('/__theme-lab/save', (req, res) => {
        const reply = replyWith(res);
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        readJson(req, (err, payload) => {
          if (err) return reply(400, { ok: false, error: err.message });
          const files = payload.files || {};
          const missing = [];
          const written = [];
          for (const [file, values] of Object.entries(files)) {
            if (!WRITABLE.has(file)) return reply(403, { ok: false, error: `${file} is not a token file` });
            const abs = path.join(root, file);
            const before = fs.readFileSync(abs, 'utf8');
            const { text, missing: miss } = rewriteDeclarations(before, values);
            missing.push(...miss);
            if (text !== before) {
              fs.writeFileSync(abs, text, 'utf8');
              written.push(file);
            }
          }
          reply(200, { ok: true, written, missing });
        });
      });

      server.middlewares.use('/__theme-lab/save-rules', (req, res) => {
        const reply = replyWith(res);
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        readJson(req, (err, payload) => {
          if (err) return reply(400, { ok: false, error: err.message });
          const edits = Array.isArray(payload.edits) ? payload.edits : [];
          const byFile = new Map();
          for (const e of edits) {
            const abs = path.resolve(root, String(e.file || ''));
            if (!abs.startsWith(srcDir) || !abs.endsWith('.css')) return reply(403, { ok: false, error: `${e.file} is not a stylesheet under src/` });
            if (!/^[A-Za-z-][A-Za-z0-9_-]*$/.test(e.prop) || /[;{}]/.test(String(e.value))) return reply(400, { ok: false, error: `bad declaration ${e.prop}` });
            if (!byFile.has(abs)) byFile.set(abs, []);
            byFile.get(abs).push({ ...e, value: String(e.value).trim() });
          }
          const missing = [];
          const written = [];
          for (const [abs, list] of byFile) {
            const before = fs.readFileSync(abs, 'utf8');
            const { text, missing: miss } = rewriteRules(before, list);
            missing.push(...miss);
            if (text !== before) {
              fs.writeFileSync(abs, text, 'utf8');
              written.push(path.relative(root, abs));
            }
          }
          reply(200, { ok: true, written, missing });
        });
      });
    },
  };
}
