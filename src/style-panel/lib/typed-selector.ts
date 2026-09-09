// What a bare word typed into the selector well means.
//
// The well takes selectors, and `my-div` is one: a type selector, for an
// element called <my-div>. Nobody typing it into a class-centric tool means
// that. They mean the class — and the panel used to write `my-div { … }` into
// the stylesheet, a rule that styles nothing, put no class on the element, and
// left the chip dashed for good. Three of those were found in one project.
//
// So a lone word that isn't an HTML tag becomes a class. A real tag (`div`,
// `section`, `svg`) stays a tag; anything with selector punctuation in it is
// taken as written.

import { HTML_TAGS } from '../../elementSchemas.js'

// HTML_TAGS is the insertable body-level list; the document-level tags and a few
// others the panel legitimately targets are added here.
const TAGS = new Set<string>([
  ...HTML_TAGS,
  'html', 'body', 'head', 'svg', 'path', 'g', 'use', 'slot', 'area', 'base', 'link', 'meta',
  'param', 'script', 'style', 'title', 'search', 'math',
])

const WORD = /^[A-Za-z_][\w-]*$/

export function isHtmlTag(word: string): boolean {
  return TAGS.has(word.toLowerCase())
}

/** The selector a typed string stands for: a lone non-tag word is its class. */
export function asTypedSelector(text: string): string {
  const t = text.trim()
  if (WORD.test(t) && !isHtmlTag(t)) return `.${t}`
  return t
}
