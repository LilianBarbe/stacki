// Vite plugin behind Theme Lab's "Save to file" (dev server only).
//
// POST /__theme-lab/save  { files: { "src/style-panel/tokens.css": { "--name": "value", … } } }
//
// Each value replaces the first `--name: …;` declaration in that file — the
// `:root` block sits at the top of both files, so that is the one edited —
// leaving comments and layout untouched. Only the two token files are writable.
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

export function themeLab() {
  return {
    name: 'stacki-theme-lab',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/__theme-lab/save', (req, res) => {
        const reply = (code, body) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          let payload;
          try {
            payload = JSON.parse(raw || '{}');
          } catch {
            return reply(400, { ok: false, error: 'bad JSON' });
          }
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
    },
  };
}
