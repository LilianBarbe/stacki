// The CSS Code section with nothing picked: the sum.
//
// Every declaration that reaches the element in the current query, grouped by
// the rule it came from, one rule under another — and struck through where a
// later or more specific rule sets the same property, the way DevTools shows a
// cascade. It is built from the resolved style rather than from the files, so
// it holds exactly what the panel's own fields are showing: the same winners,
// the same losers, per property.
//
// Winners first. A rule is placed by the strongest thing it wins with, and the
// ties broken by document order, so the block at the top is the one whose
// values you are mostly looking at on the page.

import type { Contributor, ResolvedStyle } from './resolved'
import { compareSpecificity } from './selectors'

export type StackedCssCode = {
  text: string
  /** Offsets of the declarations that lose the cascade, for striking through. */
  struck: Array<{ from: number; to: number }>
}

type Block = {
  ruleId: string
  selectorText: string
  label: string | null
  specificity: Contributor['specificity']
  order: number
  decls: Array<{ prop: string; value: string; important: boolean; winning: boolean }>
}

export function stackedCssCode(resolved: ResolvedStyle): StackedCssCode {
  const blocks = new Map<string, Block>()
  for (const [prop, entry] of resolved.props) {
    for (const c of entry.contributors) {
      let block = blocks.get(c.ruleId)
      if (!block) {
        block = { ruleId: c.ruleId, selectorText: c.selectorText, label: c.embedLabel ?? null, specificity: c.specificity, order: c.order, decls: [] }
        blocks.set(c.ruleId, block)
      }
      block.decls.push({ prop, value: c.value, important: c.important, winning: c.winning })
    }
  }
  const ordered = [...blocks.values()].sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.order - a.order)
  let text = ''
  const struck: StackedCssCode['struck'] = []
  for (const block of ordered) {
    if (text) text += '\n'
    if (block.label) text += `/* ${block.label} */\n`
    text += `${block.selectorText} {\n`
    for (const decl of block.decls) {
      const line = `${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''};`
      const from = text.length + 2
      text += `  ${line}\n`
      if (!decl.winning) struck.push({ from, to: from + line.length })
    }
    text += '}\n'
  }
  return { text, struck }
}
