import ReactCodeMirror from '@uiw/react-codemirror'
import { useMemo } from 'react'
import { css } from '@codemirror/lang-css'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search } from '@codemirror/search'
import { Decoration, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import './CodeEditor.css'

type CodeEditorLanguage = 'css'
export type CodeEditorTokenHighlight = {
  from: number
  to: number
  className: string
}

type CodeEditorProps = {
  id?: string
  value: string
  language?: CodeEditorLanguage
  readOnly?: boolean
  ariaLabel: string
  className?: string
  minHeight?: string
  tokenHighlights?: CodeEditorTokenHighlight[]
  /** Anything an editor wants beyond the language: completion, say. */
  extensions?: Extension[]
  onChange?: (value: string) => void
  onSelectionChange?: (position: number) => void
}

// The colours a CSS editor is expected to have: property names blue (the way
// DevTools and every editor theme paint them), selectors in the plain text
// colour so a rule's first line reads as a heading, numbers green, strings
// amber, `@media` and `!important` blue as keywords.
const codeEditorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-info)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-info)' },
  { tag: [tags.number, tags.unit, tags.color], color: 'var(--color-success)' },
  { tag: [tags.string, tags.url], color: 'var(--color-warning)' },
  { tag: [tags.className, tags.tagName, tags.attributeName], color: 'var(--color-text-primary)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--color-text-secondary)' },
  { tag: tags.comment, color: 'var(--color-text-tertiary)', fontStyle: 'italic' },
])

const codeEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-bg-surface)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-content': {
    caretColor: 'var(--color-text-primary)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-text-primary)',
  },
  // Matches the selection used everywhere else; CodeMirror paints its own
  // layer instead of using ::selection.
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  // Find results: a quiet wash on every hit, amber on the current one. Set here
  // rather than in CSS because CodeMirror's defaults for these live in a base
  // theme, which only a theme reliably outranks.
  '.cm-searchMatch': {
    backgroundColor: 'rgba(0, 153, 255, 0.22)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 214, 10, 0.16)',
    // A ring rather than a heavier fill: CodeMirror also SELECTS the current
    // match, and two washes over each other came out a muddy third colour.
    outline: '1px solid rgba(255, 214, 10, 0.9)',
    outlineOffset: '-1px',
  },
  '.cm-content ::selection': {
    backgroundColor: 'var(--selection)',
    color: 'var(--color-text-primary)',
  },
  // The completion list, drawn like the panel's own menus: a raised surface,
  // the panel's border and shadow, the selection colour on the current row,
  // and the value beside each variable in the muted voice of a hint.
  '.cm-tooltip': {
    backgroundColor: 'var(--color-bg-surface-raised)',
    border: 'var(--border-width-thin) solid var(--color-border-strong)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-xs)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-family-mono)',
    maxHeight: '14em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '3px 8px',
    lineHeight: '1.4',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--selection)',
    color: 'var(--color-text-primary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '1em',
    fontStyle: 'normal',
    color: 'var(--color-text-tertiary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText': {
    textDecoration: 'none',
    color: 'var(--color-info)',
  },
}, { dark: true })

const codeEditorExtensions = {
  // ⌘F opens at the top: this editor is short, and a panel at the bottom covers
  // the end of the file — which is where a search that has run leaves you.
  css: [css(), search({ top: true }), EditorView.lineWrapping, syntaxHighlighting(codeEditorHighlightStyle), codeEditorTheme],
}

const codeEditorBasicSetup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  highlightSelectionMatches: false,
  syntaxHighlighting: false,
  searchKeymap: true,
  foldKeymap: false,
  completionKeymap: false,
  lintKeymap: false,
}

export function CodeEditor({
  id,
  value,
  language = 'css',
  readOnly = false,
  ariaLabel,
  className,
  minHeight = '124px',
  tokenHighlights = [],
  extensions: extra = [],
  onChange,
  onSelectionChange,
}: CodeEditorProps) {
  const extensions = useMemo(() => {
    const highlights = tokenHighlights
      .filter((highlight) => (
        highlight.from >= 0 &&
        highlight.to > highlight.from &&
        highlight.to <= value.length
      ))
      .sort((a, b) => a.from - b.from || a.to - b.to)

    const selectionExtensions = onSelectionChange
      ? [
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            onSelectionChange(update.state.selection.main.head)
          }
        }),
        EditorView.domEventHandlers({
          pointerup: (_event, view) => {
            window.requestAnimationFrame(() => onSelectionChange(view.state.selection.main.head))
            return false
          },
          keyup: (_event, view) => {
            onSelectionChange(view.state.selection.main.head)
            return false
          },
          focus: (_event, view) => {
            window.requestAnimationFrame(() => onSelectionChange(view.state.selection.main.head))
            return false
          },
        }),
      ]
      : []

    if (!highlights.length) return [...codeEditorExtensions[language], ...extra, ...selectionExtensions]

    return [
      ...codeEditorExtensions[language],
      ...extra,
      EditorView.decorations.of((view) => {
        const docLength = view.state.doc.length
        const ranges = highlights
          .filter((highlight) => highlight.to <= docLength)
          .map((highlight) => Decoration.mark({ class: highlight.className }).range(highlight.from, highlight.to))

        return Decoration.set(ranges, true)
      }),
      ...selectionExtensions,
    ]
  }, [language, onSelectionChange, tokenHighlights, value.length, extra])

  return (
    <ReactCodeMirror
      id={id}
      className={['code-editor', readOnly ? 'is-readonly' : '', className || ''].filter(Boolean).join(' ')}
      value={value}
      extensions={extensions}
      basicSetup={codeEditorBasicSetup}
      theme="none"
      minHeight={minHeight}
      readOnly={readOnly}
      editable={!readOnly}
      indentWithTab={!readOnly}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  )
}
