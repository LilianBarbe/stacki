import { htmlLanguage, html } from '@codemirror/lang-html';
import { typescriptLanguage } from '@codemirror/lang-javascript';
import { LanguageSupport } from '@codemirror/language';
import { parseMixed } from '@lezer/common';

// Astro, for CodeMirror: HTML with a TypeScript fence at the top.
//
// An .astro file is markup, and the HTML parser gets the tags, attributes,
// <script> and <style> right. What it cannot know is that everything between
// the opening `---` and the closing one is TypeScript — so it painted the
// frontmatter as plain text, white next to the coloured markup below it.
// This parses that region with the TypeScript parser instead, overlaid on
// the HTML tree, so an import is an import and a string a string on both
// sides of the fence.
//
// The overlay hangs off the document node rather than the text node the
// frontmatter would otherwise be, because the HTML parser splits that text
// wherever the code has a `<` in it — a generic, a comparison — and the
// fence must be one range whatever the markup parser made of its inside.

/**
 * Where the frontmatter's code is in `text`: the range between the two
 * fences, or null when the file has none. The opening fence is the first
 * thing in the file; the closing one is a `---` alone on its line.
 */
export function frontmatterRange(text) {
  const open = /^\s*---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!open) return null;
  const from = open[0].length;
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(from));
  // An unclosed fence is still one being typed: colour it as code to the end.
  const to = close ? from + close.index : text.length;
  return { from, to };
}

const fence = parseMixed((node, input) => {
  if (!node.type.isTop) return null;
  const range = frontmatterRange(input.read(0, input.length));
  if (!range || range.to <= range.from) return null;
  return { parser: typescriptLanguage.parser, overlay: [range] };
});

/**
 * The language: HTML's, with the fence parsed as TypeScript. The wrapper is
 * added to the HTML parser's own (which nests <script> and <style>), not put
 * in its place. `noMatch` is what `html({ matchClosingTags: false })` sets:
 * a component's closing tag is not made to match its opening one.
 */
export const astroLanguage = htmlLanguage.configure({ wrap: fence, dialect: 'noMatch' }, 'astro');

/**
 * The editor support for an .astro file. Everything `html()` gives (tag
 * completion, auto-closing, nested script and style) with the fence added.
 */
export function astro() {
  return new LanguageSupport(astroLanguage, html({ matchClosingTags: false }).support);
}
