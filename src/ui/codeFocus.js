import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

// The part of a file that IS the selection, and the rest of it turned down.
//
// The Code panel opens a whole file and points at the lines a canvas
// selection is written on. Two things are kept here, in editor state rather
// than React state, because both have to move with the text:
//
//  - the focused range. Typing a line above the section must not leave the
//    highlight on the wrong lines, so the range is mapped through every
//    change the document takes, the way a selection is.
//  - whether the rest is dimmed at all. It is, from the moment a selection
//    lands, until the first click into the editor — a person who has started
//    reading the code wants all of it, not the part the canvas chose.
//
// The dim itself is CSS: the editor wears `cm-dimmed` and the focused lines
// wear `cm-focus-line`, and the stylesheet turns down every line without it.

/** Set (or clear, with null) the focused range, as document positions. */
export const setFocusRange = StateEffect.define();

/** Turn the dim on or off. */
export const setDimmed = StateEffect.define();

const focusRange = StateField.define({
  create: () => null,
  update(range, tr) {
    for (const e of tr.effects) if (e.is(setFocusRange)) range = e.value;
    if (range && tr.docChanged) {
      // Text typed at either edge of the section is part of it — a new line
      // added just before the first tag, or just after the last, is the
      // section growing, not the rest.
      const from = tr.changes.mapPos(range.from, -1);
      const to = tr.changes.mapPos(range.to, 1);
      range = from <= to ? { from, to } : null;
    }
    return range;
  },
});

const dimmed = StateField.define({
  create: () => false,
  update(on, tr) {
    for (const e of tr.effects) if (e.is(setDimmed)) on = e.value;
    return on;
  },
});

const focusLine = Decoration.line({ class: 'cm-focus-line' });

const focusDecorations = EditorView.decorations.compute([focusRange], (state) => {
  const range = state.field(focusRange);
  if (!range) return Decoration.none;
  const builder = new RangeSetBuilder();
  const doc = state.doc;
  const first = doc.lineAt(Math.min(range.from, doc.length));
  const last = doc.lineAt(Math.min(range.to, doc.length));
  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n);
    builder.add(line.from, line.from, focusLine);
  }
  return builder.finish();
});

const dimClass = EditorView.editorAttributes.compute([dimmed, focusRange], (state) => ({
  class: state.field(dimmed) && state.field(focusRange) ? 'cm-dimmed' : '',
}));

// A click into the editor is the reader taking over from the canvas.
const undimOnClick = EditorView.domEventHandlers({
  mousedown(_event, view) {
    if (view.state.field(dimmed)) view.dispatch({ effects: setDimmed.of(false) });
    return false;
  },
});

/** The focused range currently held by a view's state, or null. */
export function focusRangeOf(state) {
  return state.field(focusRange, false) ?? null;
}

/** Whether the view is currently dimming the lines outside the range. */
export function isDimmed(state) {
  return !!state.field(dimmed, false);
}

/** The extension: fields, decorations, the editor class and the click. */
export function codeFocus() {
  return [focusRange, dimmed, focusDecorations, dimClass, undimOnClick];
}
