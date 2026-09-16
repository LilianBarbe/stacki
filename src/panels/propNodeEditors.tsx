import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapNode } from '../../shared/page-node';
import type { RichContext } from '../ui/RichContent';
import type { ExprInputAPI } from '../ui/ExprInput';
import type { FieldPosition, SourceContext } from './propBindings';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { HTML_TAGS } from '../elementSchemas';
import { dataTree, listsOnly } from '../dataSuggest';
import ExprInput from '../ui/ExprInput';
import { BindHandle, FieldDataPicker, SourceEditButton, referencedName } from './propBindings';
import {
  elementIcon,
  astroAssetIcon,
  LayoutIcon,
  ElementComponentIcon,
  CodeIcon,
  TagIcon,
} from '../ui/Icons';

export interface Rename {
  readonly from: string;
  readonly to: string;
}
export type SetText = (value: string, renames?: readonly Rename[]) => void;
interface MapEditorProps {
  readonly node: MapNode;
  readonly loopContext?: RichContext | null | undefined;
  readonly bindCtx?: RichContext | null | undefined;
  readonly dataCtx?: SourceContext | undefined;
  readonly onSetText: SetText;
}
interface MapFields {
  readonly data: string;
  readonly item: string;
  readonly index: string;
}
type MapPatch = Pick<MapFields, 'data'> | Pick<MapFields, 'item'> | Pick<MapFields, 'index'>;
interface MapInsert {
  readonly field: 'data' | 'code';
  readonly pos: FieldPosition;
}
export interface TagOption {
  readonly name: string;
  readonly kind?: string;
}
export interface TagFieldProps {
  readonly tag: string;
  readonly options?: readonly TagOption[] | undefined;
  readonly onChangeTag: (name: string) => void | boolean | Promise<void | boolean>;
}
const noLabelActivation = (event: React.MouseEvent<HTMLLabelElement>) => event.preventDefault();

// Parses a loop head like `service.tags.map((tag) => (` or
// `items.filter(i => i.on).map((item, index) => (` into friendly fields.
// The data part is any expression, so filtered/sorted collections still fit;
// the single parameter may be bare — `items.map(item => (` — the way a
// one-argument arrow is often written. Only destructured params or non-arrow
// callbacks fall back to code.
export function parseMapHead(head: string) {
  assert(head.length <= LIMITS.nodeValueCharsMax, 'MapEditor: head limit exceeded');
  const m = String(head)
    .trim()
    .match(/^([\s\S]+?)\.map\(\s*(?:\(\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)|([\w$]+))\s*=>\s*\($/);
  if (!m?.[1]) {
    return null;
  }
  const item = m[2] || m[4];
  if (!item) {
    return null;
  }
  return { data: m[1].trim(), item, index: m[3] || '' };
}

// The leading name in an expression — what the value is a list OF, before
// anything is done to it. `posts.filter(p => p.draft)[0]` is `posts`; a lone
// `Astro.props.items` is all of it.
const SOURCE_RE = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/;

export function sourceChip(value: string) {
  assert(value.length <= LIMITS.nodeValueCharsMax, 'MapEditor: source limit exceeded');
  const text = String(value || '').trim();
  if (!text || text === NO_SOURCE) {
    return '';
  }
  const match = SOURCE_RE.exec(text);
  if (!match?.[1]) {
    return '';
  }
  let name = match[1];
  // A segment that is called is not part of the path: `posts.filter(…)` is
  // `posts`, done to — and a call on the whole thing (`getPosts()`) names a
  // function, which is not a source anything can be swapped for.
  while (text[name.length] === '(') {
    // Each pass removes a segment, so the source length bounds traversal.
    const at = name.lastIndexOf('.');
    if (at < 0) {
      return '';
    }
    name = name.slice(0, at);
  }
  return name;
}

// The same expression with a different source: what follows the old one is
// kept, so choosing another list does not throw away the code around it.
export function withSource(value: string, path: string) {
  assert(path.length <= LIMITS.nodeValueCharsMax, 'MapEditor: path limit exceeded');
  const current = sourceChip(value);
  if (!current) {
    return path;
  }
  const text = String(value);
  const at = text.indexOf(current);
  return text.slice(0, at) + path + text.slice(at + current.length);
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// "No source yet" has to be written as real code, since the head is what
// lands in the page. An empty literal is valid, renders nothing, and — unlike
// a placeholder name like `items` — can't throw "items is not defined" and
// take the whole preview down before the user has picked anything.
const NO_SOURCE = '[]';
const DEFAULT_ITEM = 'item'; // a value no expression can collide with

function useMapModel({ node, onSetText }: MapEditorProps) {
  const parsed = parseMapHead(node.head);
  const [fields, setFields] = useState(parsed || { data: '', item: '', index: '' });
  const lastBuiltRef = useRef(node.head);

  // External changes (undo, file reload, code edits below) re-sync fields.
  useEffect(() => {
    if (node.head !== lastBuiltRef.current) {
      const p = parseMapHead(node.head);
      if (p) {
        setFields(p);
      }
      lastBuiltRef.current = node.head;
    }
  }, [node.head]);

  // Typing only updates local state; the head is written on blur/Enter/pick
  // so half-typed values never run in the preview.
  const update = (patch: MapPatch) => setFields((f) => ({ ...f, ...patch }));
  const commit = (next: MapFields) => {
    setFields(next);
    const itemOk = IDENT_RE.test(next.item);
    const indexOk = !next.index || IDENT_RE.test(next.index);
    if (!next.data.trim() || !itemOk || !indexOk) {
      return;
    } // incomplete — don't write broken code
    const parameters = next.item + (next.index ? `, ${next.index}` : '');
    const head = `${next.data.trim()}.map((${parameters}) => (`;
    if (head.length > LIMITS.nodeValueCharsMax) {
      return;
    }
    if (head === node.head) {
      return;
    }
    // Renaming the item or index has to carry into the children that
    // reference it. Only a rename counts — adding or removing an index
    // leaves nothing to point the old name at.
    const renames = mapRenames(node.head, next);
    lastBuiltRef.current = head;
    onSetText(head, renames);
  };
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(fields);
    }
  };

  // Changing the source changes what the item *is*, so a name describing the
  // old data ("service" for a list of projects) is worse than none. Back to
  // the default; the rename above carries the children with it.
  const commitSource = (data: string) => {
    // The source, not the whole expression: `.slice(0, 3)` typed after a list
    // — or a value dropped into it — leaves the item exactly what it was, and
    // only picking a different list makes the old name wrong.
    const changed = sourceChip(parseMapHead(node.head)?.data || '') !== sourceChip(data);
    commit({ ...fields, data, item: changed ? DEFAULT_ITEM : fields.item });
  };

  return { fields, update, commit, commitOnEnter, commitSource };
}
function useMapEditor(props: MapEditorProps) {
  const { node, loopContext, bindCtx, dataCtx, onSetText } = props;
  const { fields, update, commit, commitOnEnter, commitSource } = useMapModel(props);
  // Anchors the source popup under the Data row.
  const dataRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const [sourceMenu, setSourceMenu] = useState<FieldPosition | null>(null);
  // The bind handle's picker, and the way into whichever field it belongs to.
  // The source picker chooses what is being looped over; this drops a value
  // into the expression around it — `posts.slice(0, count)` needs `count` from
  // somewhere, and there was no way to reach it from here.
  const [insertAt, setInsertAt] = useState<MapInsert | null>(null); // {pos, field}
  const dataApiRef = useRef<ExprInputAPI | null>(null);
  const codeApiRef = useRef<ExprInputAPI | null>(null);
  const openInsert = (field: 'data' | 'code', ref: React.RefObject<HTMLElement>) => {
    if (insertAt) {
      setInsertAt(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (!r) {
      return;
    }
    setInsertAt({
      field,
      pos: {
        left: r.left,
        top: Math.min(r.bottom + 4, Math.max(60, window.innerHeight - 340)),
        width: Math.max(r.width, 240),
      },
    });
  };
  const openSourceMenu = () => {
    const r = dataRef.current?.getBoundingClientRect();
    if (!r) {
      return;
    }
    setSourceMenu({
      left: r.left,
      top: Math.min(r.bottom + 4, Math.max(60, window.innerHeight - 340)),
      width: Math.max(r.width, 240),
    });
  };

  const parseableNow = !!parseMapHead(node.head);
  const isNoSource = !fields.data.trim() || fields.data.trim() === NO_SOURCE;
  const itemBad = fields.item !== '' && !IDENT_RE.test(fields.item);
  const indexBad = fields.index !== '' && !IDENT_RE.test(fields.index);

  return {
    node,
    loopContext,
    bindCtx,
    dataCtx,
    onSetText,
    fields,
    update,
    commit,
    commitOnEnter,
    commitSource,
    dataRef,
    codeRef,
    sourceMenu,
    setSourceMenu,
    insertAt,
    setInsertAt,
    dataApiRef,
    codeApiRef,
    openInsert,
    openSourceMenu,
    parseableNow,
    isNoSource,
    itemBad,
    indexBad,
  };
}

export function MapEditor(props: MapEditorProps) {
  const state = useMapEditor(props);
  return <MapEditorView state={state} />;
}

function MapEditorView({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const { parseableNow } = state;
  return (
    <>
      {parseableNow ? (
        <>
          <MapDataField state={state} />
          <MapNames state={state} />
        </>
      ) : (
        <div
          className="props-field"
          style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}
        >
          Custom loop code — edit it below.
        </div>
      )}
      <MapCodeField state={state} />
      <MapInsertPicker state={state} />
    </>
  );
}

// Tag switcher for plain elements: free text with a suggestion list of
// standard HTML tags. Committing renames the element — the navigator icon
// follows the tag, and attributes invalid for the new tag are dropped.
// The glyph an option wears in the tag list — the same ones the insert
// palette uses, so a component reads as a component in both places.
function tagOptionIcon(opt: TagOption) {
  if (opt.kind === 'astroAsset') {
    return astroAssetIcon(opt.name, 13);
  }
  if (opt.kind === 'layout') {
    return <LayoutIcon size={13} style={{ color: '#79e09c' }} />;
  }
  if (opt.kind === 'component') {
    return <ElementComponentIcon size={13} style={{ color: '#79e09c' }} />;
  }
  return elementIcon(opt.name, 13);
}

function useTagModel({ tag, options }: TagFieldProps) {
  const [draft, setDraft] = useState(tag);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPos, setPopupPos] = useState<FieldPosition | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Two refs, because picking from the list commits and then blurs in the same
  // tick — before React has re-rendered with either new value:
  //   committedRef — what the field has already asked for. `tag` doesn't catch
  //     up until the app re-renders, so it can't answer "did I just do this?".
  //   draftRef — the live text. The blur handler closes over the `draft` of the
  //     render it was created in, which is still the half-typed "bu" when a
  //     pick blurs the input; committing that put "bu" on the element and left
  //     the picked name sitting in the box.
  const committedRef = useRef(tag);
  const draftRef = useRef(tag);
  const updateDraft = (v: string) => {
    draftRef.current = v;
    setDraft(v);
  };
  useEffect(() => {
    committedRef.current = tag;
    draftRef.current = tag;
    setDraft(tag);
  }, [tag]);

  // Components as well as tags: Astro tells them apart by case, and so does
  // this list — typing a capital narrows to what the page can actually
  // provide (a project component, an astro:assets one, or something the
  // frontmatter already imports).
  assert(tag.length <= LIMITS.tagNameCharsMax, 'TagField: tag limit exceeded');
  assert((options?.length ?? 0) <= LIMITS.scanEntriesMax, 'TagField: option limit exceeded');
  const pool =
    options && options.length ? options : HTML_TAGS.map((name) => ({ name, kind: 'element' }));
  const q = draft.trim();
  const ql = q.toLowerCase();
  const matches =
    focused && q && q !== tag
      ? pool
          .filter((o) => o.name.toLowerCase().includes(ql))
          .sort((a, b) => {
            const ap = a.name.toLowerCase().startsWith(ql) ? 0 : 1;
            const bp = b.name.toLowerCase().startsWith(ql) ? 0 : 1;
            return ap - bp || a.name.length - b.name.length;
          })
          .slice(0, 12)
      : [];

  useLayoutEffect(() => {
    if (!matches.length || !wrapRef.current) {
      setPopupPos(null);
      return;
    }
    const r = wrapRef.current.getBoundingClientRect();
    setPopupPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [matches.length, draft]);

  return {
    draft,
    setFocused,
    highlight,
    setHighlight,
    popupPos,
    wrapRef,
    inputRef,
    committedRef,
    draftRef,
    updateDraft,
    matches,
  };
}
function useTagField(props: TagFieldProps) {
  const { tag, onChangeTag } = props;
  const model = useTagModel(props);
  const {
    highlight,
    setHighlight,

    inputRef,
    committedRef,
    draftRef,
    updateDraft,
    matches,
  } = model;
  // Ask for a name, and put the old one back if the caller says nothing
  // provides it — a component that isn't imported anywhere, a layout name
  // that isn't a layout file.
  const apply = (name: string) => {
    committedRef.current = name;
    updateDraft(name);
    Promise.resolve(onChangeTag(name)).then((ok) => {
      if (ok === false) {
        committedRef.current = tag;
        updateDraft(tag);
      }
    });
  };

  const commit = (t: string) => {
    const raw = String(t).trim();
    if (raw.length > LIMITS.tagNameCharsMax) {
      return updateDraft(committedRef.current);
    }
    if (raw === committedRef.current) {
      return updateDraft(committedRef.current);
    }
    // A capital means a component — passed through with its case intact, and
    // it's the caller that decides whether anything provides that name.
    if (/^[A-Z][\w$]*$/.test(raw)) {
      return apply(raw);
    }
    const clean = raw.toLowerCase();
    // Not `slot` either: switching into one here would be a one-way door —
    // insert a slot from the palette instead.
    if (/^[a-z][a-z0-9-]*$/.test(clean) && clean !== committedRef.current && clean !== 'slot') {
      apply(clean);
    } else {
      updateDraft(committedRef.current);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || (e.key === 'Tab' && matches.length)) {
      e.preventDefault();
      const picked = matches[Math.min(highlight, matches.length - 1)];
      commit(picked ? picked.name : draftRef.current);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      // Put the text back before blurring, or the blur below would commit
      // whatever was being typed — the opposite of what Escape means.
      updateDraft(committedRef.current);
      inputRef.current?.blur();
    }
  };

  return { ...model, commit, onKeyDown };
}

export function TagField(props: TagFieldProps) {
  const state = useTagField(props);
  return <TagFieldView state={state} />;
}

function TagFieldView({ state }: { readonly state: ReturnType<typeof useTagField> }) {
  const {
    draft,
    setFocused,
    highlight,
    setHighlight,
    popupPos,
    wrapRef,
    inputRef,
    draftRef,
    updateDraft,
    matches,
    commit,
    onKeyDown,
  } = state;
  return (
    <div className="props-field" ref={wrapRef}>
      <label onClick={noLabelActivation}>
        <span className="prop-label">
          <TagIcon size={12} className="prop-label-icon" />
          Tag
        </span>
      </label>
      <input
        maxLength={LIMITS.tagNameCharsMax}
        ref={inputRef}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          updateDraft(e.target.value);
          setHighlight(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // The ref, not `draft`: a pick blurs the input in the same tick it
          // sets the text, so the state this handler closed over is stale.
          commit(draftRef.current);
        }}
        onKeyDown={onKeyDown}
      />
      {popupPos && (
        <div
          className="dd-popup class-suggest"
          style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width }}
        >
          {matches.map((o, i) => (
            <div
              key={o.name}
              className={`dd-option ${i === highlight ? 'highlight' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                commit(o.name);
                inputRef.current?.blur();
              }}
            >
              <span className="dd-option-icon">{tagOptionIcon(o)}</span>
              <span className="dd-option-label">{o.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MapSourcePicker({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const {
    loopContext,
    bindCtx,

    fields,
    update,

    commitSource,

    sourceMenu,
    setSourceMenu,

    isNoSource,
  } = state;
  return (
    <>
      {sourceMenu && (
        <FieldDataPicker
          pos={sourceMenu}
          bindCtx={bindCtx || loopContext}
          tree={listsOnly(dataTree(bindCtx || loopContext || {}))}
          current={isNoSource ? null : sourceChip(fields.data) || fields.data.trim()}
          onPick={(path) => {
            setSourceMenu(null);
            // Picking swaps the source and keeps the code after it: a
            // list chosen again is still `.filter(…)`-ed the same way.
            commitSource(withSource(fields.data, path));
          }}
          onWrite={() => {
            setSourceMenu(null);
            if (isNoSource) {
              update({ data: '' });
            }
          }}
          onClose={() => setSourceMenu(null)}
        />
      )}
    </>
  );
}

function MapDataField({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const {
    dataCtx,

    fields,
    update,

    commitSource,
    dataRef,

    sourceMenu,
    setSourceMenu,
    insertAt,

    dataApiRef,

    openInsert,
    openSourceMenu,

    isNoSource,
  } = state;
  return (
    <div className="props-field" style={{ marginTop: 8 }} ref={dataRef}>
      <label onClick={noLabelActivation}>
        <span className="prop-label">Data</span>
        <BindHandle
          active={insertAt?.field === 'data'}
          onOpen={() => openInsert('data', dataRef)}
        />
      </label>
      {/* One field, holding one expression. What names the source is
                drawn as a chip inside it — the same purple a binding wears
                everywhere else — and everything after it is ordinary code, so
                `.filter(…)` or `[1]` is typed where it reads. The chip IS the
                way to another list: it is the thing on screen that names the
                one in use, so pressing it opens the picker, and the chevron
                that used to sit beside it was a second button for the job the
                chip was already doing. The pencil goes to where the list is
                declared, which is usually another file. */}
      <div className="prop-expr-row">
        <ExprInput
          value={isNoSource ? '' : fields.data}
          syncValue={isNoSource ? '' : fields.data}
          placeholder="Choose or write a list…"
          chip={sourceChip(fields.data)}
          apiRef={dataApiRef}
          onChipClick={() => (sourceMenu ? setSourceMenu(null) : openSourceMenu())}
          onChange={(v) => update({ data: v })}
          onCommit={(v) => commitSource(v.trim() || NO_SOURCE)}
        />
        <SourceEditButton
          name={referencedName(fields.data)}
          dataCtx={dataCtx}
          anchorRef={dataRef}
        />
      </div>
      <MapSourcePicker state={state} />
    </div>
  );
}

function MapNames({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const {
    fields,
    update,
    commit,
    commitOnEnter,

    itemBad,
    indexBad,
  } = state;
  return (
    <>
      <div className="props-field">
        <label onClick={noLabelActivation}>
          <span className="prop-label">Item name</span>
        </label>
        <input
          value={fields.item}
          placeholder="e.g. service"
          spellCheck={false}
          style={itemBad ? { borderColor: 'var(--red)' } : undefined}
          onChange={(e) => update({ item: e.target.value })}
          onBlur={() => commit(fields)}
          onKeyDown={commitOnEnter}
        />
      </div>
      <div className="props-field">
        <label onClick={noLabelActivation}>
          <span className="prop-label">Index name</span>
          <span className="type-tag">optional</span>
        </label>
        <input
          value={fields.index}
          placeholder="e.g. index"
          spellCheck={false}
          style={indexBad ? { borderColor: 'var(--red)' } : undefined}
          onChange={(e) => update({ index: e.target.value })}
          onBlur={() => commit(fields)}
          onKeyDown={commitOnEnter}
        />
      </div>
    </>
  );
}

function MapCodeField({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const {
    node,

    onSetText,

    codeRef,

    insertAt,

    codeApiRef,
    openInsert,

    parseableNow,
  } = state;
  return (
    <div className="props-field" style={{ marginTop: parseableNow ? 2 : 0 }} ref={codeRef}>
      <label onClick={noLabelActivation}>
        <span className="prop-label">
          <CodeIcon size={12} className="prop-label-icon" />
          Code
        </span>
        <BindHandle
          active={insertAt?.field === 'code'}
          onOpen={() => openInsert('code', codeRef)}
        />
      </label>
      <ExprInput
        value={node.head}
        syncValue={node.head}
        apiRef={codeApiRef}
        onCommit={(v) => v !== node.head && onSetText(v)}
      />
    </div>
  );
}

function MapInsertPicker({ state }: { readonly state: ReturnType<typeof useMapEditor> }) {
  const {
    node,
    loopContext,
    bindCtx,

    onSetText,

    commitSource,

    insertAt,
    setInsertAt,
    dataApiRef,
    codeApiRef,
  } = state;
  return (
    <>
      {insertAt && (
        <FieldDataPicker
          pos={insertAt.pos}
          bindCtx={bindCtx || loopContext}
          current={null}
          onPick={(path) => {
            const field = insertAt.field;
            setInsertAt(null);
            const next =
              field === 'data'
                ? dataApiRef.current?.insert(path)
                : codeApiRef.current?.insert(path);
            if (next == null) {
              return;
            }
            if (field === 'data') {
              commitSource(next.trim() || NO_SOURCE);
            } else if (next !== node.head) {
              onSetText(next);
            }
          }}
          onClose={() => setInsertAt(null)}
        />
      )}
    </>
  );
}

function mapRenames(head: string, next: MapFields): readonly Rename[] {
  const previous = parseMapHead(head);
  if (!previous) {
    return [];
  }
  const renames: Rename[] = [];
  for (const key of ['item', 'index'] as const) {
    if (previous[key] && next[key] && previous[key] !== next[key]) {
      renames.push({ from: previous[key], to: next[key] });
    }
  }
  assert(renames.length <= 2, 'MapEditor: rename count exceeded');
  return renames;
}
