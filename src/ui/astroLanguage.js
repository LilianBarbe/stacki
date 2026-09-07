import { htmlLanguage, html } from '@codemirror/lang-html';
import { tsxLanguage } from '@codemirror/lang-javascript';
import { LanguageSupport } from '@codemirror/language';
import { parseMixed } from '@lezer/common';
import { codeRanges, frontmatterRange } from './astroScan.js';

export { frontmatterRange, codeRanges };

// Astro, for CodeMirror: HTML with TypeScript in it.
//
// An .astro file is markup, and the HTML parser gets the tags, attributes,
// <script> and <style> right. What it cannot know is where the code is:
// the frontmatter between the `---` fences, the `{expressions}` in text and
// attributes, the backtick templates as attribute values. It painted all of
// that as plain text, white next to the coloured markup. This finds the
// code (see astroScan.js) and parses it with the TypeScript parser instead,
// overlaid on the HTML tree, so an import is an import and a string a
// string wherever it is in the file.
//
// TSX rather than TS, because an expression may hold markup —
// `{items.map((i) => <li>{i}</li>)}` — and that markup is JSX to the parser.
//
// Each range is hung off the innermost HTML node that holds the whole of
// it — usually the text or the attribute it sits in, the element when it
// spans children (`{list.map(i => <li>{i}</li>)}`), the document when the
// markup parser made a mess of it (a `<` in a generic reads as a tag to it,
// and swallows the rest of the file). Not simply the document: an overlay
// is only seen by a lookup that passes through the node carrying it, and
// `resolveInner` starts from wherever it last landed, so an overlay on the
// root goes unseen from inside a <script>'s own tree. Hosted low, it is on
// the path of every lookup that could want it.

/**
 * Which node hosts which ranges, for one parse. Computed once, when the
 * document node is asked (it is asked first, and `root` is it), and read
 * for every node after it; keyed by the input so a new parse computes
 * afresh.
 */
const hostsByInput = new WeakMap();

const hostKey = (from, to, type) => `${from}:${to}:${type.id}`;

function hostsFor(input, root) {
  let hosts = hostsByInput.get(input);
  if (hosts) return hosts;
  hosts = new Map();
  hostsByInput.set(input, hosts);
  for (const range of codeRanges(input.read(0, input.length))) {
    // The innermost node that holds the whole range. `resolve` rather than
    // `resolveInner`, so an earlier parse's overlays are not entered.
    let node = root.resolve(range.from, 1);
    while (node.parent && (node.from > range.from || node.to < range.to)) node = node.parent;
    const key = hostKey(node.from, node.to, node.type);
    const list = hosts.get(key);
    if (list) list.push(range);
    else hosts.set(key, [range]);
  }
  return hosts;
}

const codeInMarkup = parseMixed((node, input) => {
  const ranges = hostsFor(input, node.node).get(hostKey(node.from, node.to, node.type));
  // Document positions: Lezer makes them relative to the node itself.
  return ranges ? { parser: tsxLanguage.parser, overlay: ranges } : null;
});

/**
 * The language: HTML's, with the code parsed as TypeScript. The wrapper is
 * added to the HTML parser's own (which nests <script> and <style>), not put
 * in its place. `noMatch` is what `html({ matchClosingTags: false })` sets:
 * a component's closing tag is not made to match its opening one.
 */
export const astroLanguage = htmlLanguage.configure({ wrap: codeInMarkup, dialect: 'noMatch' }, 'astro');

/**
 * The editor support for an .astro file. Everything `html()` gives (tag
 * completion, auto-closing, nested script and style) with the code added.
 */
export function astro() {
  return new LanguageSupport(astroLanguage, html({ matchClosingTags: false }).support);
}
