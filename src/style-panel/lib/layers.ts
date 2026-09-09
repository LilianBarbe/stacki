// Cascade layers: which of two rules wins, before specificity gets a say.
//
// A project that declares `@layer base, patterns, utilities;` has decided the
// argument in advance: a rule in `utilities` beats a rule in `patterns` no
// matter how specific either is, and a rule in no layer beats them all. The
// panel used to rank by specificity and source order alone, so a `patterns`
// rule with two classes in it was shown winning over a `utilities` utility
// that, on the page, was the one actually applied — the spacing field said
// `0` while the element sat 14px lower.
//
// The order is what the stylesheets declare, in the order they declare it:
// `@layer a, b;` statements, `@layer a { … }` blocks, `@import … layer(a)`.
// A layer first met in a rule and never declared takes the next slot, which
// is what a browser does too. Nested layers (`a.b`) rank inside their parent,
// and a rule directly in `a` beats one in `a.b`.
//
// `!important` turns the whole thing around: important declarations in an
// earlier layer beat those in a later one, and important unlayered ones lose
// to every layer. Same table, read backwards.

import { compareSpecificity } from './selectors'
import type { Specificity } from './types'

let declared: string[] = []

/** Forget every layer — the stylesheets are about to be read again. */
export function resetLayers(): void {
  declared = []
}

/** Note a layer (and each of its parents) in declaration order. */
export function declareLayer(name: string): void {
  const parts = name.split('.').filter(Boolean)
  for (let i = 1; i <= parts.length; i++) {
    const full = parts.slice(0, i).join('.')
    if (!declared.includes(full)) declared.push(full)
  }
}

/** Every layer known so far, in cascade order (earliest first). */
export function declaredLayers(): readonly string[] {
  return declared
}

const ranksOf = (name: string): number[] => {
  declareLayer(name) // first use is a declaration, as in a browser
  const parts = name.split('.').filter(Boolean)
  return parts.map((_, i) => declared.indexOf(parts.slice(0, i + 1).join('.')))
}

/**
 * Which layer wins, for normal declarations: negative when `a` beats `b`,
 * positive when `b` beats `a`, 0 when the layers can't separate them (same
 * layer, or both unlayered). `important` reads the table backwards.
 */
export function compareLayerWin(a: string | null | undefined, b: string | null | undefined, important = false): number {
  const la = a || null
  const lb = b || null
  if (la === lb) return 0
  let win: number // negative = a wins, under normal precedence
  if (la === null) win = -1
  else if (lb === null) win = 1
  else {
    const ra = ranksOf(la)
    const rb = ranksOf(lb)
    win = 0
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
      if (ra[i] !== rb[i]) { win = ra[i] > rb[i] ? -1 : 1; break }
    }
    // One nests inside the other: the outer (shorter) wins, as unlayered does.
    if (win === 0) win = ra.length < rb.length ? -1 : ra.length > rb.length ? 1 : 0
  }
  return important ? -win : win
}

export type Precedence = { layer?: string | null; specificity: Specificity; order: number }

/**
 * Winners first, for normal declarations — the order Chrome's Styles pane
 * lists matched rules in: layer, then specificity, then the rule written
 * later above the one written earlier.
 */
export function comparePrecedence(a: Precedence, b: Precedence): number {
  return compareLayerWin(a.layer, b.layer) || compareSpecificity(b.specificity, a.specificity) || b.order - a.order
}

/** Where a stylesheet's `@import` points, as an absolute path beside the importer. */
export function resolveImportPath(importerPath: string, spec: string): string {
  const clean = spec.trim().replace(/^url\(\s*/, '').replace(/\s*\)$/, '').replace(/^["']|["']$/g, '')
  if (/^(https?:)?\/\//.test(clean)) return clean
  const base = importerPath.replace(/[^/]*$/, '')
  const joined = clean.startsWith('/') ? clean : base + clean
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' && out.length) continue
    if (part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return out.join('/')
}
