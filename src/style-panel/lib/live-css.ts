// The canvas, told directly.
//
// A live edit — a drag on the spacing box, a value being typed — used to reach
// the canvas the long way round: the file was written, the dev server noticed,
// sent its message, the page fetched itself again and patched the difference
// in. Some 400 ms on a typical page, and a drag writes the whole way through,
// so the outline trailed the number by a good half second.
//
// So the canvas is told first. The rule being edited is re-spelled from its
// live AST — the same text the file is about to hold — and posted to the frame,
// which keeps it in a <style> of its own at the end of <head>. Same selector,
// same specificity, later in the document: it wins exactly the ties the real
// rule would win once written, and loses where the real one would lose. The
// file write still happens behind it; once that has come round, the sheet is
// dropped and the real rule is what shows.

import { directDecls } from './css'
import type { ParsedRule } from './types'
import { tellCanvas } from '../../canvasQuery.js'

/** The rule as the file will spell it: its resolved selector and its own
 *  declarations, inside whatever queries wrap it. */
export function liveCssOf(rule: ParsedRule): string {
  const decls = directDecls(rule.node)
    .map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''};`)
    .join(' ')
  let css = `${rule.selectorText} { ${decls} }`
  // Innermost query first: `['@media a', '@supports b']` wraps as
  // `@media a { @supports b { … } }`.
  for (let i = rule.atContext.length - 1; i >= 0; i--) css = `${rule.atContext[i]} { ${css} }`
  return css
}

/** Show the rule on the canvas as it now reads, ahead of the file. */
export function previewLiveCss(rule: ParsedRule): void {
  tellCanvas({ type: 'avb:live-css', css: liveCssOf(rule) })
}

/** The edit has been written: keep the preview only until the page has
 *  caught up with the file, then let the real rule take over. */
export function settleLiveCss(): void {
  tellCanvas({ type: 'avb:live-css', settle: true })
}
