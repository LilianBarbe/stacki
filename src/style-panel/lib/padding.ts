import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'
import { splitTopLevelSpaces } from './background'

const SIDES = ['top', 'right', 'bottom', 'left'] as const
const PADDING_PROPS: Record<string, readonly string[]> = {
  padding: SIDES,
  'padding-inline': ['left', 'right'],
  'padding-block': ['top', 'bottom'],
  ...Object.fromEntries(SIDES.map((side) => [`padding-${side}`, [side]])),
}

/** Physical sides used by the spacing box (horizontal writing mode). */
export function spacingSides(prop: string, value: string): Record<string, string> {
  const sides = prop === 'margin' ? SIDES : Object.hasOwn(PADDING_PROPS, prop) ? PADDING_PROPS[prop] : undefined
  if (!sides) return {}
  const parts = splitTopLevelSpaces(value)
  if (!parts.length || parts.length > sides.length) return {}
  const [top, right = top, bottom = top, left = right] = parts
  const values = sides.length === 4 ? [top, right, bottom, left] : [top, right]
  const prefix = prop === 'margin' ? 'margin' : 'padding'
  return Object.fromEntries(sides.map((side, i) => [`${prefix}-${side}`, values[i]]))
}

function paddingDecls(node: Rule | AtRule): Declaration[] {
  return (node.nodes ?? []).filter((child): child is Declaration =>
    child.type === 'decl' && Object.hasOwn(PADDING_PROPS, child.prop.toLowerCase()))
}

function isOpaque(decl: Declaration): boolean {
  return PADDING_PROPS[decl.prop.toLowerCase()].length > 1 && splitTopLevelSpaces(decl.value)
    .some((part) => /^(var|env)\(/i.test(part))
}

/** Compact only authored padding, never values inherited from other rules. */
function compactPadding(node: Rule | AtRule) {
  const decls = paddingDecls(node)
  const values = new Map<string, { value: string; important: boolean; opaque: boolean }>()
  for (const decl of decls) {
    const prop = decl.prop.toLowerCase()
    // A var() can substitute several lengths. Keep that shorthand intact unless
    // all its sides have been overridden; don't guess how to split its value.
    const opaque = isOpaque(decl)
    const expanded = spacingSides(prop, decl.value)
    if (!Object.keys(expanded).length) return
    for (const [side, value] of Object.entries(expanded)) {
      if (values.get(side)?.important && !decl.important) continue
      values.set(side, { value, important: !!decl.important, opaque })
    }
  }
  if ([...values.values()].some((entry) => entry.opaque)) return
  const equal = (a: string, b: string) => {
    const x = values.get(`padding-${a}`)
    const y = values.get(`padding-${b}`)
    return !!x && !!y && x.value === y.value && x.important === y.important
  }
  const output: Array<{ prop: string; value: string; important: boolean }> = []
  const add = (prop: string, side: string) => {
    const entry = values.get(`padding-${side}`)
    if (entry) output.push({ prop, value: entry.value, important: entry.important })
  }
  if (SIDES.every((side) => equal('top', side))) {
    add('padding', 'top')
  } else {
    if (equal('top', 'bottom')) add('padding-block', 'top')
    else { add('padding-top', 'top'); add('padding-bottom', 'bottom') }
    if (equal('left', 'right')) add('padding-inline', 'left')
    else { add('padding-right', 'right'); add('padding-left', 'left') }
  }
  const anchor = decls[decls.length - 1]
  if (!anchor) return
  for (const entry of output) node.insertBefore(anchor, anchor.clone(entry))
  for (const decl of decls) decl.remove()
}

/** Commit a padding edit, then remove redundant shorthands/longhands together.
 * Live previews deliberately retain their individual sides so cancellation can
 * restore each side independently. Returns false for non-padding properties. */
export function setPaddingDeclaration(node: Rule | AtRule, prop: string, value: string, important: boolean): boolean {
  const key = prop.trim().toLowerCase()
  if (!Object.hasOwn(PADDING_PROPS, key)) return false
  for (const decl of paddingDecls(node)) {
    if (decl.prop.toLowerCase() === key) decl.remove()
  }
  const decl = postcss.decl({ prop: key, value, important })
  const firstNested = node.nodes?.find((child) => child.type === 'rule' || child.type === 'atrule')
  if (firstNested) node.insertBefore(firstNested, decl)
  else node.append(decl)
  node.raws.semicolon = true
  compactPadding(node)
  return true
}

/** Reset a side even when a previous edit grouped it into an axis/shorthand. */
export function clearPaddingSides(node: Rule | AtRule, props: string[]): boolean {
  const sides = new Set(props.filter((prop) => SIDES.some((side) => prop === `padding-${side}`)))
  if (!sides.size) return false
  let changed = false
  for (const decl of paddingDecls(node)) {
    const expanded = spacingSides(decl.prop.toLowerCase(), decl.value)
    if (!Object.keys(expanded).some((side) => sides.has(side))) continue
    if (isOpaque(decl)) continue
    for (const [prop, value] of Object.entries(expanded)) {
      if (!sides.has(prop)) node.insertBefore(decl, decl.clone({ prop, value }))
    }
    decl.remove()
    changed = true
  }
  if (changed) compactPadding(node)
  return changed
}
