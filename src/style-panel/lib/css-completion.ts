// Completion in the CSS Code section.
//
// Two sources. Property names, value keywords and pseudo-classes come from
// @codemirror/lang-css, which the editor's CSS support already registers;
// what this file adds is the project's own variables. Typing `var(--sp`
// offers every variable whose name starts that way, its value beside it as
// the hint, and closes the call; typing `--sp` in a value does the same and
// wraps the pick in `var()`. Variables of the kind the property takes — a
// colour for `color`, a font stack for `font-family` — are lifted to the top
// of the list without hiding the rest: a size in `background` is unusual, not
// wrong.
//
// The list is read through a getter rather than captured: it streams in
// after the panel opens, and the extension is built once.

import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete'
import { cssLanguage } from '@codemirror/lang-css'
import { tooltips } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { ProjectVariable } from './webflow'

// `var(` and whatever of the name has been typed so far, ending at the caret.
const VAR_CALL = /var\(\s*(?:--[\w-]*|-)?/
// A bare name being typed: `--sp`. Only offered inside a value (after the
// declaration's colon), where `--x` at the start of a line is a new custom
// property being declared, not a reference.
const BARE_NAME = /--[\w-]*/
const IN_VALUE = /:[^;{}]*$/
// The property the value under the caret belongs to, for the kind to lift.
const PROP_BEFORE = /([\w-]+)\s*:[^;{}]*$/

const VALID = /^-*[\w-]*$/

/** Which variable kinds a property takes — lifted in the list, not the only ones shown. */
export function kindsFor(prop: string): readonly string[] {
  const p = prop.toLowerCase()
  if (p === 'font-family' || p === 'font') return ['FontFamily']
  if (p.includes('color')) return ['Color']
  if (/radius|width|height|size|margin|padding|gap|inset|^(top|right|bottom|left)$|spacing|indent|offset|translate|basis|columns?$|rows?$/.test(p)) return ['Size', 'Number']
  if (/^(background|border|outline|fill|stroke|box-shadow|text-shadow|caret|accent)/.test(p)) return ['Color']
  if (/opacity|weight|order|grow|shrink|z-index|line-height|scale/.test(p)) return ['Number', 'Size']
  return []
}

function propAt(context: CompletionContext, from: number): string | null {
  const line = context.state.doc.lineAt(from)
  const before = context.state.doc.sliceString(line.from, from)
  return PROP_BEFORE.exec(before)?.[1] ?? null
}

function options(vars: ProjectVariable[], lifted: readonly string[], apply: (v: ProjectVariable) => string): Completion[] {
  return vars.map((v) => ({
    label: `--${v.name}`,
    detail: v.value,
    type: 'variable',
    apply: apply(v),
    // Kinds the property takes come first; among those, the order the
    // stylesheets declared them in is kept by the filter's own ranking.
    boost: lifted.includes(v.type) ? 1 : 0,
  }))
}

/** Project variables, in `var()` calls and as bare names in a value. */
export function projectVariableCompletion(getVars: () => ProjectVariable[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const vars = getVars()
    if (!vars.length) return null

    const call = context.matchBefore(VAR_CALL)
    if (call) {
      // Everything after `var(` and its spaces is the name so far.
      const typed = call.text.slice(4).trimStart()
      const from = context.pos - typed.length
      const closed = context.state.doc.sliceString(context.pos, context.pos + 1) === ')'
      const lifted = kindsFor(propAt(context, call.from) ?? '')
      return {
        from,
        options: options(vars, lifted, (v) => `--${v.name}${closed ? '' : ')'}`),
        validFor: VALID,
      }
    }

    const bare = context.matchBefore(BARE_NAME)
    if (bare) {
      const line = context.state.doc.lineAt(bare.from)
      const before = context.state.doc.sliceString(line.from, bare.from)
      if (!IN_VALUE.test(before)) return null
      const lifted = kindsFor(propAt(context, bare.from) ?? '')
      return {
        from: bare.from,
        options: options(vars, lifted, (v) => `var(--${v.name})`),
        validFor: VALID,
      }
    }

    return null
  }
}

/**
 * The completion extension for the CSS Code editor: the popup, lang-css's
 * own properties and keywords (registered on its language data), and the
 * project's variables beside them. The popup is put on <body>: the editor
 * clips its own overflow, and a short one would have cut the list off after
 * a row.
 */
export function cssCodeCompletion(getVars: () => ProjectVariable[]): Extension {
  return [
    autocompletion({ icons: false, maxRenderedOptions: 40 }),
    cssLanguage.data.of({ autocomplete: projectVariableCompletion(getVars) }),
    tooltips({ position: 'fixed', parent: typeof document !== 'undefined' ? document.body : undefined }),
  ]
}
