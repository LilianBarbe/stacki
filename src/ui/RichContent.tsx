import React, { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import DataPicker from './DataPicker';
import type { DataPickerProps } from './DataPicker';
import { dataTree } from '../dataSuggest';
import type { DataContext } from '../dataSuggest';
import { resolvePick } from '../bindings';
import { deleteChipAtCaret } from './chipKeys';
import { ElementLinkIcon } from './Icons';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { nodesToHtml, isChippable, domToNodes, isDOMElement } from './richContentModel';
import type { InlineNode } from './richContentModel';
export {
  INLINE_TAGS,
  isSimpleExpr,
  isInlineOnly,
  isChippable,
  nodesToHtml,
} from './richContentModel';
export type { InlineNode } from './richContentModel';

export interface RichContext extends DataContext {
  readonly entryNav?: DataPickerProps['entries'];
  readonly onStepItem?: DataPickerProps['onStepItem'];
  readonly onNeedSample?: (collection: string) => void;
  readonly ensureQuery?: (collection: string) => string | undefined | null;
}
export interface RichInsertAPI {
  readonly insert: (path: string) => void;
}
interface RichContentProps {
  readonly nodes: readonly InlineNode[];
  readonly onChange: (nodes: InlineNode[]) => void;
  readonly bindCtx?: RichContext | null;
  readonly insertRef?: MutableRefObject<RichInsertAPI | null>;
}
interface Bubble {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}
interface BubblePosition {
  readonly left: number;
  readonly top: number;
  readonly below: boolean;
  readonly arrowX: number;
}
interface ChipMenu {
  readonly chip: Element;
  readonly left: number;
  readonly top: number;
  readonly current: string;
}
interface FormatState {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  readonly code?: boolean;
  readonly span?: boolean;
  readonly link?: boolean;
}
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

export default function RichContent({ nodes, onChange, bindCtx, insertRef }: RichContentProps) {
  const state = useRichState();
  const { hostRef } = state;
  const emit = () => richEmit(state, onChange);
  const { onChipMouseDown, pickExpr } = richChipActions(state, emit);
  useRichSync(nodes, state);
  useRichCaret(state);
  useRichInsertion(insertRef, state, emit);
  useRichSelection(state);
  useRichPosition(state);
  useRichChipDismiss(state);
  const onBlur = useRichBlur(state);
  return (
    <>
      <div
        ref={hostRef}
        className="rich-content"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={onBlur}
        onInput={emit}
        onMouseDown={onChipMouseDown}
        onKeyDown={(e) => {
          // Keep formatting shortcuts local; Enter inserts <br> (inline field).
          if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertHTML', false, '<br>');
            emit();
            return;
          }
          // Backspace against a chip takes that chip, and only that chip —
          // not the sentence it sits in.
          if (deleteChipAtCaret(hostRef.current, e)) {
            e.preventDefault();
            emit();
          }
        }}
      />
      <RichChipMenu state={state} bindCtx={bindCtx} pickExpr={pickExpr} />
      <RichBubble state={state} emit={emit} />
    </>
  );
}

function useRichState() {
  const hostRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [pos, setPos] = useState<BubblePosition | null>(null);
  const [states, setStates] = useState<FormatState>({}); // {bold, italic, …} at the selection
  const [linkMode, setLinkMode] = useState(false);
  const [chipMenu, setChipMenu] = useState<ChipMenu | null>(null); // {chip, left, top, current}
  const [linkUrl, setLinkUrl] = useState('');

  const caretRef = useRef<Range | null>(null);
  return {
    hostRef,
    bubbleRef,
    lastEmittedRef,
    savedRangeRef,
    caretRef,
    bubble,
    setBubble,
    pos,
    setPos,
    states,
    setStates,
    linkMode,
    setLinkMode,
    chipMenu,
    setChipMenu,
    linkUrl,
    setLinkUrl,
  };
}

type RichState = ReturnType<typeof useRichState>;
function useRichSync(nodes: readonly InlineNode[], state: RichState) {
  const { hostRef, lastEmittedRef } = state;
  const html = nodesToHtml(nodes, isChippable);

  // Load / external updates. lastEmittedRef holds the canonical html of the
  // nodes this editor last emitted, so an incoming value that matches it is
  // just our own edit echoing back through the app — leave the DOM (and the
  // caret) alone. Anything else is a real external change: an undo, a file
  // reload, a chip switched from elsewhere. Keying this off document focus
  // instead used to drop those updates whenever the field happened to hold
  // focus, which is exactly when an undo arrives.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }
    if (html !== lastEmittedRef.current) {
      el.innerHTML = html;
      lastEmittedRef.current = html;
    }
  }, [html, hostRef, lastEmittedRef]);
}
function richEmit(state: RichState, onChange: RichContentProps['onChange']): void {
  const { hostRef, lastEmittedRef } = state;
  const el = hostRef.current;
  if (!el) {
    return;
  }
  let next = domToNodes(el);
  // Deleting the last character leaves a <br> behind: a contentEditable
  // needs one line for the caret to sit on, so the browser puts a
  // placeholder there. It isn't content, and writing it out means the
  // component still receives slot content — a heading emptied in the panel
  // would keep rendering, holding a line break. A lone <br> is that
  // placeholder and nothing else, so it clears to nothing.
  if (next.length === 1 && next[0]?.kind === 'element' && next[0].name === 'br') {
    next = [];
  }
  // Canonical, not el.innerHTML: the app hands the nodes back with ids
  // added and the browser normalises markup as you type, so only the
  // serialised form is comparable on the way back in.
  lastEmittedRef.current = nodesToHtml(next, isChippable);
  onChange(next);
}
// The wrapper of `tag` the whole selection sits inside, or null. Both ends
// are resolved down to the node they point AT, rather than reading
// sel.anchorNode: a range can select an element from its parent — start
// (parent, i), end (parent, i+1) — and that is exactly what surrounding the
// selection leaves behind, so asking the anchor (the parent) whether it is
// inside `tag` answers no about the tag it just made.
function richTagAround(host: HTMLElement | null, tag: string): Element | null {
  const sel = window.getSelection();
  if (!host || !sel || sel.rangeCount === 0) {
    return null;
  }
  const r = sel.getRangeAt(0);
  const at = (container: Node, offset: number) => {
    const n = container.nodeType === 1 ? container.childNodes[offset] || container : container;
    const el = isDOMElement(n) ? n : n.parentElement;
    return el ? el.closest(tag) : null;
  };
  // The end boundary points just PAST its node, so step back one.
  const start = at(r.startContainer, r.startOffset);
  const end = at(r.endContainer, r.endOffset - (r.endContainer.nodeType === 1 ? 1 : 0));
  const el = start && start === end ? start : null;
  return el && host.contains(el) && el !== host ? el : null;
}
// Formatting state at the current selection, for highlighting buttons.
function richReadStates(host: HTMLElement | null): FormatState {
  const inTag = (tag: string) => !!richTagAround(host, tag);
  let s: FormatState = {};
  try {
    s = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      superscript: document.queryCommandState('superscript'),
      subscript: document.queryCommandState('subscript'),
    };
  } catch {
    s = {};
  }
  return { ...s, code: inTag('code'), span: inTag('span'), link: inTag('a') };
}
function useRichCaret(state: RichState): void {
  const { hostRef, caretRef } = state;
  // Where the caret is, saved whenever it is inside the editor. The bubble
  // below only tracks real selections; inserting data needs the collapsed
  // caret too, and by the time the picker is open focus has left the editor.

  useEffect(() => {
    const onSel = () => {
      const el = hostRef.current;
      const sel = window.getSelection();
      if (!el || !sel?.rangeCount) {
        return;
      }
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) {
        caretRef.current = r.cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [hostRef, caretRef]);
}
function useRichInsertion(
  insertRef: RichContentProps['insertRef'],
  state: RichState,
  emit: () => void,
) {
  const { hostRef, caretRef } = state;
  // Dropping data in from outside — the Content field's own insert button.
  useEffect(() => {
    if (!insertRef) {
      return undefined;
    }
    insertRef.current = {
      insert(path: string) {
        const el = hostRef.current;
        if (!el) {
          return;
        }
        el.focus();
        const sel = window.getSelection();
        const saved = caretRef.current;
        const range = document.createRange();
        if (saved && el.contains(saved.commonAncestorContainer)) {
          range.setStart(saved.startContainer, saved.startOffset);
          range.setEnd(saved.endContainer, saved.endOffset);
        } else {
          range.selectNodeContents(el);
          range.collapse(false);
        }
        if (!sel) {
          return;
        }
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand(
          'insertHTML',
          false,
          `<span class="expr-chip" contenteditable="false" data-expr="{${path}}">${path}</span>`,
        );
        emit();
      },
    };
    return () => {
      insertRef.current = null;
    };
  });
}
function useRichSelection(state: RichState): void {
  const { linkMode, hostRef, savedRangeRef, setBubble, setStates } = state;
  // Selection bubble: track selections anchored inside the editor.
  useEffect(() => {
    const onSelChange = () => {
      if (linkMode) {
        return;
      } // keep the bubble while typing a URL
      const el = hostRef.current;
      const sel = window.getSelection();
      if (
        !el ||
        !sel ||
        sel.rangeCount === 0 ||
        sel.isCollapsed ||
        !el.contains(sel.anchorNode) ||
        !el.contains(sel.focusNode)
      ) {
        setBubble(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setBubble(null);
        return;
      }
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      setBubble({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
      setStates(richReadStates(hostRef.current));
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [hostRef, savedRangeRef, linkMode, setBubble, setStates]);
}
function useRichPosition(state: RichState): void {
  const { bubbleRef, bubble, linkMode, setPos } = state;
  // Measure the rendered bubble and keep it inside the window: clamp
  // horizontally, flip below the selection when it would hit the titlebar,
  // and keep the arrow pointing at the selection midpoint.
  React.useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!bubble || !el) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 8;
    const left = clamp(bubble.x, margin + w / 2, window.innerWidth - margin - w / 2);
    const below = bubble.top - h - 10 < 48;
    const top = below ? bubble.bottom + 10 : bubble.top - 10;
    const arrowX = clamp(bubble.x - (left - w / 2), 12, w - 12);
    setPos({ left, top, below, arrowX });
  }, [bubble, linkMode, bubbleRef, setPos]);
}
// Snapshot the live selection as the range the next press restores.
// Every action below re-reads it rather than leaving that to the
// `selectionchange` listener, because that event is fired from a queued
// task: a second press landing in the same task would otherwise act on the
// range from before the first one, which by then has been dragged along by
// the DOM edit and no longer means what it did. That is how pressing Code
// twice quickly used to nest a <code> inside a <code>.
function richSaveSelection(state: RichState): void {
  const { hostRef, savedRangeRef } = state;
  const host = hostRef.current;
  const sel = window.getSelection();
  if (!host || !sel || sel.rangeCount === 0) {
    return;
  }
  const r = sel.getRangeAt(0);
  if (host.contains(r.commonAncestorContainer)) {
    savedRangeRef.current = r.cloneRange();
  }
}
function richRestoreSelection(state: RichState): void {
  const { savedRangeRef } = state;
  const r = savedRangeRef.current;
  if (!r) {
    return;
  }
  const sel = window.getSelection();
  if (!sel) {
    return;
  }
  sel.removeAllRanges();
  // A clone: addRange can adopt the very range it is handed, and then
  // surroundContents below would rewrite the saved one as a side effect.
  sel.addRange(r.cloneRange());
}
function richExec(state: RichState, command: string, emit: () => void): void {
  state.hostRef.current?.focus();
  richRestoreSelection(state);
  document.execCommand(command, false);
  emit();
  richSaveSelection(state);
  state.setStates(richReadStates(state.hostRef.current));
}
// Take the selection out of the nearest `tag` around it, leaving its text
// where it was. The button is a toggle — pressing one that is already lit has
// to turn it off, and for a <span> that is the only way back: a span with no
// attributes on it yet is invisible, so one added by mistake could otherwise
// only be removed by editing the file.
function richUnwrapTag(state: RichState, tag: string): boolean {
  const sel = window.getSelection();
  const el = richTagAround(state.hostRef.current, tag);
  if (!el) {
    return false;
  }
  const parent = el.parentNode;
  assert(parent !== null, 'RichContent: inline wrapper has a parent');
  const first = el.firstChild;
  const last = el.lastChild;
  assert(el.childNodes.length <= LIMITS.treeNodesMax, 'RichContent: unwrap child limit exceeded');
  for (const child of Array.from(el.childNodes)) {
    parent.insertBefore(child, el);
  }
  parent.removeChild(el);
  // Keep the text selected, so the bubble stays up and the next press acts on
  // the same words.
  if (first && last) {
    const r = document.createRange();
    r.setStartBefore(first);
    r.setEndAfter(last);
    sel?.removeAllRanges();
    sel?.addRange(r);
  }
  return true;
}
// No execCommand for <code> or <span> — wrap the selection manually.
function richWrapTag(state: RichState, tag: string, emit: () => void): void {
  state.hostRef.current?.focus();
  richRestoreSelection(state);
  // Already inside one: the press means "stop".
  if (richUnwrapTag(state, tag)) {
    emit();
    richSaveSelection(state);
    state.setStates(richReadStates(state.hostRef.current));
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return;
  }
  const range = sel.getRangeAt(0);
  const el = document.createElement(tag);
  try {
    range.surroundContents(el);
  } catch {
    // Selection crosses element boundaries — extract and rewrap.
    el.appendChild(range.extractContents());
    range.insertNode(el);
  }
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.addRange(r);
  emit();
  richSaveSelection(state);
  state.setStates(richReadStates(state.hostRef.current));
}
function richApplyLink(state: RichState, emit: () => void): void {
  const { linkUrl, setLinkMode, setLinkUrl, hostRef, setStates } = state;
  const url = linkUrl.trim();
  setLinkMode(false);
  setLinkUrl('');
  if (!url) {
    return;
  }
  hostRef.current?.focus();
  richRestoreSelection(state);
  document.execCommand('createLink', false, url);
  emit();
  richSaveSelection(state);
  setStates(richReadStates(hostRef.current));
}
// Buttons use onMouseDown+preventDefault so the text selection survives.
const richButton = (
  label: React.ReactNode,
  title: string,
  active: boolean | undefined,
  onAct: () => void,
) => (
  <button
    key={title}
    type="button"
    className={active ? 'on' : ''}
    title={title}
    onMouseDown={(e) => {
      e.preventDefault();
      onAct();
    }}
  >
    {label}
  </button>
);

function richChipActions(state: RichState, emit: () => void) {
  const { chipMenu, setChipMenu } = state;
  // Clicking a chip offers the other values in scope. mousedown rather than
  // click, and preventDefault, so the caret never lands inside the chip.
  const onChipMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const ElementType = e.currentTarget.ownerDocument.defaultView?.Element;
    const chip =
      ElementType && e.target instanceof ElementType ? e.target.closest('.expr-chip') : null;
    if (!chip) {
      return;
    }
    e.preventDefault();
    const r = chip.getBoundingClientRect();
    setChipMenu({
      chip,
      left: r.left,
      top: r.bottom + 4,
      current: (chip.getAttribute('data-expr') || '').replace(/^\{|\}$/g, ''),
    });
  };

  const pickExpr = (insert: string) => {
    const chip = chipMenu?.chip;
    setChipMenu(null);
    if (!chip) {
      return;
    }
    chip.setAttribute('data-expr', '{' + insert + '}');
    chip.textContent = insert;
    emit();
  };

  return { onChipMouseDown, pickExpr };
}
function useRichChipDismiss(state: RichState): void {
  const { chipMenu, setChipMenu } = state;
  useEffect(() => {
    if (!chipMenu) {
      return;
    }
    const close = (e: MouseEvent) => {
      // Chips are excluded, not just the menu: React flushes this effect
      // synchronously for a discrete event, so the listener is live while the
      // very mousedown that opened the menu is still propagating to document.
      // Without the exclusion the menu closes on the click that opened it —
      // and clicking straight from one chip to another would too.
      const ElementType = chipMenu.chip.ownerDocument.defaultView?.Element;
      if (ElementType && e.target instanceof ElementType) {
        if (e.target.closest('.bind-menu, .expr-chip')) {
          return;
        }
      }
      setChipMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setChipMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [chipMenu, setChipMenu]);
}
function RichChipMenu({
  state,
  bindCtx,
  pickExpr,
}: {
  readonly state: RichState;
  readonly bindCtx: RichContext | null | undefined;
  readonly pickExpr: (path: string) => void;
}) {
  const { chipMenu } = state;
  if (!chipMenu) {
    return null;
  }
  return (
    <div
      className="dd-popup bind-menu"
      style={{ left: chipMenu.left, top: chipMenu.top, width: 260 }}
    >
      <DataPicker
        tree={dataTree(bindCtx || {})}
        current={chipMenu.current}
        entries={bindCtx?.entryNav ?? null}
        {...(bindCtx?.onStepItem ? { onStepItem: bindCtx.onStepItem } : {})}
        onPick={(path, query) => pickExpr(resolvePick(path, query, bindCtx))}
        onExpand={(node) => node.query && bindCtx?.onNeedSample?.(node.query.collection)}
        footer={false}
      />
    </div>
  );
}
type BubbleStyle = React.CSSProperties & { readonly '--arrow-x': string };
function RichBubble({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  const { bubble, bubbleRef, pos, linkMode } = state;
  if (!bubble) {
    return null;
  }
  const style: BubbleStyle = {
    left: pos ? pos.left : bubble.x,
    top: pos ? pos.top : bubble.top - 10,
    visibility: pos ? 'visible' : 'hidden',
    '--arrow-x': pos ? `${pos.arrowX}px` : '50%',
  };
  return (
    <div
      ref={bubbleRef}
      className={`rich-bubble ${pos?.below ? 'below' : ''}`}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {linkMode ? (
        <RichLinkInput state={state} emit={emit} />
      ) : (
        <RichButtons state={state} emit={emit} />
      )}
    </div>
  );
}
function RichLinkInput({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  const { linkUrl, setLinkUrl, setLinkMode } = state;
  const applyLink = () => richApplyLink(state, emit);
  return (
    <input
      autoFocus
      className="rich-bubble-url"
      placeholder="https://…  (Enter to apply)"
      value={linkUrl}
      onChange={(e) => setLinkUrl(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          applyLink();
        }
        if (e.key === 'Escape') {
          setLinkMode(false);
          setLinkUrl('');
        }
      }}
    />
  );
}
function RichButtons({ state, emit }: { readonly state: RichState; readonly emit: () => void }) {
  const { states, setLinkMode } = state;
  const exec = (command: string) => richExec(state, command, emit);
  const wrapTag = (tag: string) => richWrapTag(state, tag, emit);
  const btn = (
    label: React.ReactNode,
    title: string,
    onAct: () => void,
    active: boolean | undefined,
  ) => richButton(label, title, active, onAct);
  return (
    <>
      {btn(<b>B</b>, 'Bold', () => exec('bold'), states.bold)}
      {btn(<i>I</i>, 'Italic', () => exec('italic'), states.italic)}
      {btn(
        <span>
          X<sup>2</sup>
        </span>,
        'Superscript',
        () => exec('superscript'),
        states.superscript,
      )}
      {btn(
        <span>
          X<sub>2</sub>
        </span>,
        'Subscript',
        () => exec('subscript'),
        states.subscript,
      )}
      {btn(<span className="mono">{'</>'}</span>, 'Code', () => wrapTag('code'), states.code)}
      {/* A span is the hook for everything else: wrap some words, then
                  give that node a class and style it like any other. Nothing is
                  written on it here — an empty span IS the useful result. */}
      {btn(
        <span className="mono">span</span>,
        'Wrap in a span',
        () => wrapTag('span'),
        states.span,
      )}
      {/* The app's own link icon, not the emoji: an emoji is drawn by
                  the system in its own colours and at its own weight, so it sat
                  in this row as the one thing that hadn't been designed. */}
      {btn(<ElementLinkIcon size={14} />, 'Link', () => setLinkMode(true), states.link)}
    </>
  );
}
function useRichBlur(state: RichState): () => void {
  const { linkMode, setBubble } = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  return () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setBubble((bubble) => (linkMode ? bubble : null));
    }, 150);
  };
}
