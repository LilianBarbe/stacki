import React, { useEffect, useRef, useState } from 'react';
import type { Item } from '../arrayValue';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { DragIcon, PlusIcon, TrashIcon, CloseIcon } from '../ui/Icons.jsx';
import { arrayItems, arrayText, blankLike, itemLabel, moveItem } from '../arrayValue.js';

// A prop that takes a list, edited as a list.
//
// The value is an array literal in the file — `options={["Designer",
// "Developer"]}` — and every row here is one item of it. Drag a row to reorder,
// press the bin to drop it, press the last row to add one, and click a row to
// open it.
//
// Opening is a popup rather than an input in the row, because an item is not
// always one thing: `{ value: "us", label: "United States" }` is a row with two
// fields, and there is no room beside the row's own name for either of them.
// One place to edit an item, whatever the item turns out to be.
//
// Every action writes the whole array back, because that is what the file
// holds: one value, not a list of values. The code editor is still one press of
// `{}` away, and it is the only field that can hold an array this cannot show —
// a spread, a call, a name standing for a list elsewhere (see arrayValue.js).

// The fields of one item, in a box anchored to its row.
interface Position {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}
interface ItemEditorProps {
  readonly item: Item;
  readonly pos: Position;
  readonly onChange: (item: Item) => void;
  readonly onClose: () => void;
}
function ItemEditor({ item, pos, onChange, onClose }: ItemEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    firstRef.current?.select();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const NodeType = ref.current?.ownerDocument.defaultView?.Node;
      if (NodeType && e.target instanceof NodeType && !ref.current?.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // A word is one field called Value; an object is its own fields, named as the
  // file names them. Either way the popup is a list of labelled boxes, so there
  // is one thing to learn rather than two.
  const fields = item.fields || [{ key: 'value', text: item.text, quote: item.quote }];
  const set = (i: number, text: string) => {
    if (item.fields) {
      onChange({ ...item, fields: item.fields.map((f, at) => (at === i ? { ...f, text } : f)) });
      return;
    }
    onChange({ ...item, text });
  };

  return (
    <div
      ref={ref}
      className="attr-editor list-item-editor"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="var-src-head">
        <span className="var-src-name">{item.fields ? 'Item' : 'Value'}</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" title="Close" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      {fields.map((field, i) => (
        <label className="list-item-field" key={field.key}>
          <span>{field.key}</span>
          <input
            ref={i === 0 ? firstRef : null}
            value={field.text}
            spellCheck={false}
            maxLength={LIMITS.attrCharsMax}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </label>
      ))}
    </div>
  );
}

// What an empty list has to say for itself, if anything. The Add item button
// under it already says that the list is empty and what to do about it, so a
// note is drawn only when it adds something the button doesn't. A declared
// default of `[]` adds nothing: it is the same sentence a second time, written
// in code, over the button that says it in words.
export function emptyNote(placeholder: unknown) {
  const text = String(placeholder ?? '').trim();
  return !text || /^\[\s*\]$/.test(text) ? '' : text;
}

interface ListFieldProps {
  readonly value?: string | null;
  readonly placeholder?: string | null;
  readonly onChange: (value: string, immediate: boolean) => void;
}
type Editor =
  | { readonly kind: 'closed' }
  | { readonly kind: 'existing'; readonly index: number; readonly pos: Position }
  | { readonly kind: 'pending'; readonly item: Item; readonly pos: Position };
type Drag =
  | { readonly kind: 'idle' }
  | { readonly kind: 'dragging'; readonly index: number; readonly gap: number | null };

export default function ListField(props: ListFieldProps) {
  const state = useListField(props);
  const note = emptyNote(props.placeholder);
  return (
    <div className="list-field" onDragOver={(event) => event.preventDefault()} onDrop={state.drop}>
      {state.items.length === 0 && note ? <div className="list-field-empty">{note}</div> : null}
      {state.items.map((item, index) => (
        <ListRow key={index} item={item} index={index} state={state} />
      ))}
      <button
        type="button"
        className="list-field-add"
        onClick={(event) => state.openAt(event, null, blankLike(state.items))}
      >
        <PlusIcon size={12} />
        Add item
      </button>
      <ListEditor state={state} />
    </div>
  );
}

function useListField({ value, onChange }: ListFieldProps) {
  assert((value?.length ?? 0) <= LIMITS.attrCharsMax, 'ListField: value limit exceeded');
  const items = arrayItems(value) || [];
  const [editor, setEditor] = useState<Editor>({ kind: 'closed' });
  const [drag, setDrag] = useState<Drag>({ kind: 'idle' });
  const write = (
    next: readonly Item[],
    options: { readonly immediate: boolean } = { immediate: true },
  ) => {
    const text = arrayText(next);
    assert(text.length <= LIMITS.attrCharsMax, 'ListField: output limit exceeded');
    onChange(text, options.immediate);
  };
  const openAt = (event: React.MouseEvent<HTMLElement>, index: number | null, item: Item): void => {
    const row = event.currentTarget.closest('.list-field-row') || event.currentTarget;
    const rectangle = row.getBoundingClientRect();
    const width = Math.max(rectangle.width, 220);
    const pos = {
      left: Math.max(8, Math.min(rectangle.left, window.innerWidth - width - 8)),
      top: Math.min(rectangle.bottom + 4, Math.max(60, window.innerHeight - 220)),
      width,
    };
    setEditor(index === null ? { kind: 'pending', item, pos } : { kind: 'existing', index, pos });
  };
  const closePending = (): void => {
    setEditor({ kind: 'closed' });
    if (editor.kind !== 'pending') {
      return;
    }
    const said = editor.item.fields
      ? editor.item.fields.some((field) => String(field.text).trim())
      : String(editor.item.text).trim();
    if (said) {
      write([...items, editor.item]);
    }
  };
  const remove = (index: number): void => {
    setEditor({ kind: 'closed' });
    write(items.filter((_, current) => current !== index));
  };
  const drop = (): void => {
    if (drag.kind === 'dragging' && drag.gap !== null) {
      const next = moveItem(items, drag.index, drag.gap);
      // A drop into the original gap must not create an undo/save operation.
      if (next.some((item, index) => item !== items[index])) {
        write(next);
      }
    }
    setDrag({ kind: 'idle' });
  };
  return { items, editor, setEditor, drag, setDrag, write, openAt, closePending, remove, drop };
}
type ListState = ReturnType<typeof useListField>;

function ListRow({
  item,
  index,
  state,
}: {
  readonly item: Item;
  readonly index: number;
  readonly state: ListState;
}) {
  const { drag, editor, setDrag, setEditor, openAt, remove, drop } = state;
  const dragging = drag.kind === 'dragging' ? drag.index : null;
  const gap = drag.kind === 'dragging' ? drag.gap : null;
  const open = editor.kind === 'existing' && editor.index === index;
  return (
    <div
      className={`list-field-row ${dragging === index ? 'is-dragging' : ''} ${
        gap === index ? 'is-before' : ''
      } ${gap === index + 1 ? 'is-after' : ''} ${open ? 'is-open' : ''}`}
      draggable
      onDragStart={(event) => {
        setDrag({ kind: 'dragging', index, gap: null });
        setEditor({ kind: 'closed' });
        event.dataTransfer.effectAllowed = 'move';
        try {
          event.dataTransfer.setData('text/plain', String(index));
        } catch {
          /* Optional in Chromium. */
        }
      }}
      onDragEnd={() => setDrag({ kind: 'idle' })}
      onDragOver={(event) => {
        if (drag.kind === 'idle') {
          return;
        }
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const gap = event.clientY - box.top < box.height / 2 ? index : index + 1;
        setDrag({ ...drag, gap });
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        drop();
      }}
    >
      <span className="list-field-grip" aria-hidden="true">
        <DragIcon size={12} />
      </span>
      <button
        type="button"
        className="list-field-text"
        onClick={(event) => openAt(event, index, item)}
      >
        {itemLabel(item) || <span className="list-field-blank">Empty</span>}
      </button>
      <button
        type="button"
        className="ghost list-field-remove"
        title="Remove"
        onClick={() => remove(index)}
      >
        <TrashIcon size={12} />
      </button>
    </div>
  );
}

function ListEditor({ state }: { readonly state: ListState }) {
  const { editor, items, write, setEditor, closePending } = state;
  switch (editor.kind) {
    case 'closed':
      return null;
    case 'existing': {
      const item = items[editor.index];
      if (!item) {
        return null;
      }
      return (
        <ItemEditor
          item={item}
          pos={editor.pos}
          onChange={(next) =>
            write(
              items.map((item, index) => (index === editor.index ? next : item)),
              { immediate: false },
            )
          }
          onClose={() => {
            write(items, { immediate: true });
            setEditor({ kind: 'closed' });
          }}
        />
      );
    }
    case 'pending':
      return (
        <ItemEditor
          item={editor.item}
          pos={editor.pos}
          onChange={(item) =>
            setEditor((current) => (current.kind === 'pending' ? { ...current, item } : current))
          }
          onClose={closePending}
        />
      );
    default: {
      const exhaustive: never = editor;
      return exhaustive;
    }
  }
}
