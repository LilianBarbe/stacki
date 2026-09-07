import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// ⌘-hover a component's tag and it underlines; ⌘-click it and its file opens.
//
// The go-to-definition every editor has, for the one definition a page's
// markup has to offer: `<Step … />` is written in Step.astro. Hold the
// modifier (⌘ on a Mac, Ctrl elsewhere), move over the name, and it reads as
// a link; the click hands the name to the app, which drills into the
// component the way a double-click on the canvas does.
//
// The underline is a state of the editor — a mark over the name's range —
// so it is drawn by CodeMirror and cleared the moment the key goes up or the
// pointer leaves, with nothing for React to track.

/** Set (or clear, with null) the tag under the ⌘-pointer: {from, to, name}. */
export const setCmdLink = StateEffect.define();

const cmdLink = StateField.define({
  create: () => null,
  update(link, tr) {
    for (const e of tr.effects) if (e.is(setCmdLink)) link = e.value;
    if (link && tr.docChanged) link = null;
    return link;
  },
});

const linkMark = Decoration.mark({ class: 'cm-cmd-link' });

const linkDecorations = EditorView.decorations.compute([cmdLink], (state) => {
  const link = state.field(cmdLink);
  return link ? Decoration.set([linkMark.range(link.from, link.to)]) : Decoration.none;
});

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || '');

/** Whether the event carries the go-to modifier: ⌘ on a Mac, Ctrl elsewhere. */
export function hasGoToModifier(event) {
  return isMac ? !!event.metaKey : !!event.ctrlKey;
}

/**
 * The component tag name at a document position — `Step` in `<Step …>` or
 * `</Step>` — as {from, to, name}, or null over anything else. A component
 * is a tag that starts with a capital: that is Astro's own rule for telling
 * one from an element, and the only one the markup carries.
 */
export function componentTagAt(state, pos) {
  const doc = state.doc;
  if (pos < 0 || pos > doc.length) return null;
  // The syntax tree first: it knows a tag name from the same word in text or
  // in an attribute value.
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node && node.name !== 'TagName') node = node.parent;
  let from, to;
  if (node) {
    from = node.from;
    to = node.to;
  } else {
    // Off the tree (a part not parsed yet, a language without one): the
    // line's own text, read for a tag that spans the position.
    const line = doc.lineAt(pos);
    const re = /<\/?([A-Za-z][\w.:-]*)/g;
    let m;
    while ((m = re.exec(line.text)) !== null) {
      const start = line.from + m.index + m[0].length - m[1].length;
      const end = start + m[1].length;
      if (pos >= start && pos <= end) {
        from = start;
        to = end;
        break;
      }
    }
    if (from == null) return null;
  }
  const name = doc.sliceString(from, to);
  if (!/^[A-Z][\w$]*$/.test(name)) return null;
  return { from, to, name };
}

/**
 * The extension. `onOpen(name)` is called for a ⌘-click on a component tag.
 */
export function cmdLinks(onOpen) {
  const plugin = ViewPlugin.define((view) => {
    let last = null; // where the pointer was, for a modifier pressed after it
    const set = (link) => {
      const cur = view.state.field(cmdLink);
      const same = (cur && link && cur.from === link.from && cur.to === link.to) || (!cur && !link);
      if (!same) view.dispatch({ effects: setCmdLink.of(link) });
    };
    const update = (event) => {
      if (!last || !hasGoToModifier(event)) {
        set(null);
        return;
      }
      const pos = view.posAtCoords(last);
      set(pos == null ? null : componentTagAt(view.state, pos));
    };
    const onMove = (event) => {
      last = { x: event.clientX, y: event.clientY };
      update(event);
    };
    const onLeave = () => {
      last = null;
      set(null);
    };
    // The modifier can go down or up while the pointer is already over a
    // name; the key events land on the window, not the editor.
    const onKey = (event) => update(event);
    view.dom.addEventListener('mousemove', onMove);
    view.dom.addEventListener('mouseleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onLeave);
    return {
      destroy() {
        view.dom.removeEventListener('mousemove', onMove);
        view.dom.removeEventListener('mouseleave', onLeave);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onLeave);
      },
    };
  });

  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!hasGoToModifier(event) || event.button !== 0) return false;
      const link = view.state.field(cmdLink);
      if (!link) return false;
      event.preventDefault();
      view.dispatch({ effects: setCmdLink.of(null) });
      onOpen?.(link.name);
      return true;
    },
  });

  return [cmdLink, linkDecorations, plugin, click];
}
