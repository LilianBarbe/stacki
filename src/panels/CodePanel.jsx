import React, { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { search } from '@codemirror/search';
import { appTheme, appHighlight } from '../ui/CodeEditor.jsx';
import { extensionFor, languageFor } from '../ui/Code.jsx';
import { codeFocus, setDimmed, setFocusRange } from '../ui/codeFocus.js';
import { cmdLinks } from '../ui/cmdLink.js';
import { cleanError } from '../cleanError.js';

// The Code panel: the file behind the canvas selection, open at the lines
// that are the selection.
//
// Pick a section on the canvas and this opens the page (or the component
// being edited) whole, scrolled to that section, with everything that isn't
// the section turned down — see codeFocus.js. It is a real editor: what is
// typed here goes to disk on the same 300 ms debounce as every other edit,
// and the model is read back from the file so the navigator, the canvas and
// the panels follow.
//
// ⌘-hover a component's tag name and it underlines; ⌘-click and the app
// drills into that component (see cmdLink.js) — the panel then follows the
// selection into its file, the way it follows any other.
//
// `selectionKey` is the innermost of the "<file>#<path>" keys ⇧⌘C copies —
// the open file and the tree position of the selection in it. A key that
// ends in a bare "#" means the file is open and nothing in it is selected;
// null means there is no file at all.
//
// Two flows meet in one editor, and the guard between them matters:
//
//  - the canvas picks a node → the file is (re)read, the range set, the view
//    scrolled to it and the dim switched on. A new key, a new reveal.
//  - the file changes underneath (a props-panel edit landing, a git checkout,
//    an edit outside the app) → the text is refreshed IN PLACE, the range
//    re-resolved without scrolling, and the dim left as it was. Never while
//    the panel itself has typing that hasn't reached disk: the disk copy is
//    then older than the editor, and swapping it in would eat the keystrokes.

const SAVE_DELAY = 300;

export default function CodePanel({
  project,
  selectionKey,
  pageState,
  flushSave,
  onWritten,
  onOpenComponent,
  locked,
  showToast,
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const viewRelRef = useRef(null); // the file the view was built for
  // What the header shows: the file and the lines. State, because it renders.
  const [file, setFile] = useState(null); // { rel, keyFile } | null
  const [lines, setLines] = useState(null); // { start, end } | null
  const fileRef = useRef(null);
  fileRef.current = file;
  // Typing that hasn't been written yet, and the timer that will write it.
  const pendingRef = useRef(false);
  const writeTimer = useRef(null);
  const writeSeq = useRef(0);
  // Set while the panel itself is replacing the text, so the change listener
  // can tell a person's typing from a refresh — only typing is written back.
  const applyingRef = useRef(false);
  // Locates in flight: only the latest answer is applied.
  const locateSeq = useRef(0);
  const lastKeyRef = useRef(null);
  const projectPath = project?.path || null;

  const propsRef = useRef({});
  propsRef.current = { flushSave, onWritten, onOpenComponent, showToast, projectPath };

  // Writes the editor's text to the file it came from. Pending model edits
  // land first, or they would overwrite this a moment later.
  const writeNow = async (rel, text) => {
    const seq = ++writeSeq.current;
    const { flushSave: flush, onWritten: written, showToast: toast, projectPath: root } =
      propsRef.current;
    if (!root) return;
    try {
      await flush?.();
      await window.avb.writeSourceText({ projectPath: root, rel, text });
      if (seq === writeSeq.current) pendingRef.current = false;
      await written?.(rel);
    } catch (err) {
      toast?.(`Save failed: ${cleanError(err)}`, 'error');
    }
  };

  const scheduleWrite = (rel, text) => {
    pendingRef.current = true;
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      void writeNow(rel, text);
    }, SAVE_DELAY);
  };

  const replaceText = (view, text) => {
    const cur = view.state.doc.toString();
    if (cur === text) return;
    applyingRef.current = true;
    try {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: text } });
    } finally {
      applyingRef.current = false;
    }
  };

  // Builds the view for a file, or reuses the one already showing it.
  const ensureView = (rel, text) => {
    if (viewRef.current && viewRelRef.current === rel) {
      replaceText(viewRef.current, text);
      return viewRef.current;
    }
    viewRef.current?.destroy();
    // Shown now rather than on the next render: the view measures itself as
    // soon as it exists, and a hidden host measures as nothing.
    hostRef.current.hidden = false;
    const lang = extensionFor(languageFor(rel));
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          search({ top: true }),
          ...(lang ? [lang] : []),
          appTheme,
          appHighlight,
          codeFocus(),
          cmdLinks((name) => propsRef.current.onOpenComponent?.(name)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingRef.current) scheduleWrite(rel, u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    viewRelRef.current = rel;
    return view;
  };

  // The document positions of a line range, clamped to the document.
  const rangeIn = (state, startLine, endLine) => {
    if (startLine == null || endLine == null) return null;
    const last = state.doc.lines;
    const a = state.doc.line(Math.max(1, Math.min(startLine, last)));
    const b = state.doc.line(Math.max(1, Math.min(endLine, last)));
    return { from: a.from, to: b.to };
  };

  // Scrolls so the range sits in the middle of the editor when it fits, and
  // starts near the top when it doesn't — the start of a tall section is
  // the part of it a person looks for, and centring the whole thing would
  // put that above the fold.
  const scrollTo = (view, range) => {
    view.requestMeasure({
      read: (v) => {
        const top = v.lineBlockAt(range.from).top;
        const bottom = v.lineBlockAt(range.to).bottom;
        const height = v.scrollDOM.clientHeight;
        const fits = bottom - top <= height * 0.8;
        return fits ? top - (height - (bottom - top)) / 2 : top - 24;
      },
      write: (scrollTop, v) => {
        v.scrollDOM.scrollTop = Math.max(0, scrollTop);
      },
    });
  };

  const closeFile = () => {
    viewRef.current?.destroy();
    viewRef.current = null;
    viewRelRef.current = null;
    if (hostRef.current) hostRef.current.hidden = true;
    setFile(null);
    setLines(null);
  };

  // Asks main where the key lands, then opens (reveal) or refreshes the file.
  const locate = async (key, mode) => {
    const seq = ++locateSeq.current;
    const root = propsRef.current.projectPath;
    if (!root) return;
    let at = null;
    try {
      at = await window.avb.locateSelection({ projectPath: root, key });
    } catch {
      at = null;
    }
    if (seq !== locateSeq.current || !hostRef.current) return;
    if (!at) {
      if (mode === 'reveal') closeFile();
      return;
    }
    // A refresh must not replace text the editor is ahead of.
    if (mode === 'refresh' && pendingRef.current) return;
    const keyFile = key.slice(0, key.indexOf('#'));
    setFile((f) => (f && f.rel === at.rel && f.keyFile === keyFile ? f : { rel: at.rel, keyFile }));
    const view = ensureView(at.rel, at.text);
    const range = rangeIn(view.state, at.startLine, at.endLine);
    setLines(range ? { start: at.startLine, end: at.endLine } : null);
    const effects = [setFocusRange.of(range)];
    if (mode === 'reveal') effects.push(setDimmed.of(!!range));
    view.dispatch({ effects });
    if (mode === 'reveal' && range) scrollTo(view, range);
  };

  // One effect for both flows, so a new key and a settled model arriving in
  // the same commit cannot race each other's answer out of the editor.
  //
  // A new key is a reveal, unless nothing is selected: then the file stays
  // open — the reader may be in the middle of it — with the range cleared,
  // or closes if the file itself changed. The same key with the model
  // settled on disk (a save landed, a reload happened) is a refresh: the
  // file may read differently now, and the selection may be on other lines.
  useEffect(() => {
    if (locked) return;
    if (!selectionKey || !projectPath) {
      lastKeyRef.current = null;
      closeFile();
      return;
    }
    const keyChanged = selectionKey !== lastKeyRef.current;
    lastKeyRef.current = selectionKey;
    const settled = !!pageState && !pageState.dirty && !!viewRef.current;
    const hash = selectionKey.indexOf('#');
    const keyFile = hash === -1 ? selectionKey : selectionKey.slice(0, hash);
    const bare = hash === -1 || hash === selectionKey.length - 1;
    if (bare) {
      if (!keyChanged) {
        if (settled) void locate(selectionKey, 'refresh');
      } else if (viewRef.current && fileRef.current?.keyFile === keyFile) {
        viewRef.current.dispatch({ effects: [setFocusRange.of(null), setDimmed.of(false)] });
        setLines(null);
      } else {
        closeFile();
      }
      return;
    }
    if (keyChanged) void locate(selectionKey, 'reveal');
    else if (settled) void locate(selectionKey, 'refresh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, projectPath, locked, pageState]);

  // Leaving the panel (another rail tab) must not lose what was just typed:
  // the write goes now rather than never.
  useEffect(
    () => () => {
      locateSeq.current++;
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
        const view = viewRef.current;
        if (view && viewRelRef.current) void writeNow(viewRelRef.current, view.state.doc.toString());
      }
      viewRef.current?.destroy();
      viewRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const empty = locked
    ? 'This is an earlier version of the site. Go back to now to see its code.'
    : 'Select an element on the canvas';
  const showEmpty = !file || locked;

  return (
    <div className="code-panel">
      <div className="panel-header">
        <h2>Code</h2>
        {file && !locked && (
          <span className="code-panel-where" title={file.rel}>
            <span className="code-panel-file">{file.rel}</span>
            {lines && (
              <span className="code-panel-lines">
                {lines.start === lines.end ? `L${lines.start}` : `L${lines.start}–${lines.end}`}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="code-panel-body">
        {showEmpty && <div className="props-empty code-panel-empty">{empty}</div>}
        <div ref={hostRef} className="cm-host code-panel-editor" hidden={showEmpty} />
      </div>
    </div>
  );
}
