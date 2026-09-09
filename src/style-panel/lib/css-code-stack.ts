// The CSS Code section with nothing picked: the element's classes, as Webflow's
// style preview writes them.
//
// One block per rule that styles the element THROUGH A CLASS IT CARRIES —
// `.hero_wrap`, then the combo `.hero_wrap.is-aplat`, then the same combo
// under `@media screen and (max-width: 767px)` — read downwards in cascade
// order, the rule that wins last, the way the chips read. Nothing else by
// default: a tag rule, a reset, an ancestor chain or a global selector reaches
// the element without being one of its classes, and those come in only when
// the well's toggles bring their chips in.
// Every query is shown, not only the one being viewed, so the block is the
// whole story of the class; a declaration a later rule beats is struck
// through, the way DevTools draws an overridden value.

import type { MatchedRule, RuleModel } from './cascade'
import { comparePrecedence } from './layers'
import { canonicalCompound, compareSpecificity, isGlobalSelector } from './selectors'
import type { SelectorInfo, Specificity } from './types'

export type StackedCssCode = {
  text: string
  /** Offsets of the declarations that lose the cascade, for striking through. */
  struck: Array<{ from: number; to: number }>
}

/** A selector made only of classes the element carries — its own, in the
 *  sense the chips use: a state or a pseudo-element on such a class counts. */
function ownClassSelector(text: string, classList: string[]): boolean {
  const canon = canonicalCompound(text)
  if (!canon.oneCompound || !canon.tokens.length) return false
  return canon.tokens.every((tok) => tok.startsWith('class:') && classList.includes(tok.slice('class:'.length)))
}

function strongest(selectors: SelectorInfo[]): Specificity {
  let best: Specificity = [0, 0, 0]
  for (const sel of selectors) if (compareSpecificity(sel.specificity, best) > 0) best = sel.specificity
  return best
}

/** The well's two fold-away toggles: a global selector, and a rule that reaches
 *  the element without being one of its classes (a tag, a reset, an ancestor
 *  chain). Shown here exactly when the well shows their chips. */
export type StackedShow = { globals?: boolean; inherited?: boolean }

export function stackedCssCode(model: RuleModel, classList: string[], show: StackedShow = {}): StackedCssCode {
  const wanted = (text: string) =>
    ownClassSelector(text, classList) || (isGlobalSelector(text) ? !!show.globals : !!show.inherited)
  const blocks: Array<{ matched: MatchedRule; selectors: SelectorInfo[]; specificity: Specificity }> = []
  for (const matched of [...model.base, ...model.conditional]) {
    if (!matched.rule.declarations.length) continue
    const selectors = matched.matchedSelectors.filter((sel) => wanted(sel.text))
    if (!selectors.length) continue
    blocks.push({ matched, selectors, specificity: strongest(selectors) })
  }
  // Ascending: the block that wins comes last, as the chips have it.
  blocks.sort((a, b) => comparePrecedence(
    { layer: b.matched.rule.layer, specificity: b.specificity, order: b.matched.rule.order },
    { layer: a.matched.rule.layer, specificity: a.specificity, order: a.matched.rule.order },
  ))

  let text = ''
  const struck: StackedCssCode['struck'] = []
  for (const { matched, selectors } of blocks) {
    if (text) text += '\n'
    const wrappers = matched.rule.atContext
    const pad = (depth: number) => '  '.repeat(depth)
    wrappers.forEach((at, depth) => { text += `${pad(depth)}${at} {\n` })
    const depth = wrappers.length
    text += `${pad(depth)}${selectors.map((sel) => sel.text).join(', ')} {\n`
    for (const decl of matched.rule.declarations) {
      const line = `${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''};`
      const from = text.length + pad(depth + 1).length
      text += `${pad(depth + 1)}${line}\n`
      if (matched.declStatus[decl.declId]?.winning === false) struck.push({ from, to: from + line.length })
    }
    text += `${pad(depth)}}\n`
    for (let i = wrappers.length - 1; i >= 0; i--) text += `${pad(i)}}\n`
  }
  return { text, struck }
}
