import React, { useEffect, useRef, useState } from 'react';
import { assert } from '../../shared/assert.mjs';
import { LIMITS } from '../../shared/limits.mjs';
import { PlusIcon, CloseIcon } from '../ui/Icons.jsx';
import ListFieldRow from '../ui/ListFieldRow.jsx';
import {
  arrayItems,
  arrayText,
  blankLike,
  itemLabel,
  moveItem,
} from '../arrayValue.js';
function ItemEditor({ item, pos, trigger, onChange, onClose }) {
  const ref = useListEditorDismiss(trigger, onClose);
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus();
    firstRef.current?.select();
  }, []);
  // A word is one field called Value; an object is its own fields, named as the
  // file names them. Either way the popup is a list of labelled boxes, so there
  // is one thing to learn rather than two.
  const fields = item.fields || [
    { key: 'value', text: item.text, quote: item.quote },
  ];
  const set = (i, text) => {
    if (item.fields) {
      onChange({
        ...item,
        fields: item.fields.map((f, at) => (at === i ? { ...f, text } : f)),
      });
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
function useListEditorDismiss(trigger, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      // The active row handles its own toggle; dismissing here would reopen it on click.
      if (e.composedPath().includes(trigger)) {
        return;
      }
      const NodeType = ref.current?.ownerDocument.defaultView?.Node;
      if (
        NodeType &&
        e.target instanceof NodeType &&
        !ref.current?.contains(e.target)
      ) {
        onClose();
      }
    };
    const onKey = (e) => {
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
  }, [onClose, trigger]);
  return ref;
}
// What an empty list has to say for itself, if anything. The Add item button
// under it already says that the list is empty and what to do about it, so a
// note is drawn only when it adds something the button doesn't. A declared
// default of `[]` adds nothing: it is the same sentence a second time, written
// in code, over the button that says it in words.
export function emptyNote(placeholder) {
  const text = String(placeholder ?? '').trim();
  return !text || /^\[\s*\]$/.test(text) ? '' : text;
}
export default function ListField({
  value,
  placeholder,
  disabled,
  itemsMin,
  itemsMax,
  valueCharsMax,
  onChange,
}) {
  const props = {
    value,
    placeholder,
    disabled,
    itemsMin,
    itemsMax,
    valueCharsMax,
    onChange,
  };
  const state = useListField(props);
  const note = emptyNote(props.placeholder);
  return (
    <div
      className="list-field"
      onDragOver={(event) => event.preventDefault()}
      onDrop={state.drop}
    >
      {state.items.length === 0 && note ? (
        <div className="list-field-empty">{note}</div>
      ) : null}
      {state.items.length > 0 && (
        <div
          className="list-field-items"
          onScroll={() => closeListRowEditor(state)}
        >
          {state.items.map((item, index) => (
            <ListRow key={index} item={item} index={index} state={state} />
          ))}
        </div>
      )}
      <button
        type="button"
        className="list-field-add"
        disabled={state.disabled || state.items.length >= state.itemsMax}
        onClick={(event) => {
          if (state.editor.kind === 'pending') {
            state.closePending();
          } else {
            state.openAt(event, null, blankLike(state.items));
          }
        }}
      >
        <PlusIcon size={12} />
        Add item
      </button>
      <ListEditor state={state} />
    </div>
  );
}
function useListField(props) {
  const {
    value,
    onChange,
    disabled = false,
    itemsMin = 0,
    itemsMax = LIMITS.scanEntriesMax,
    valueCharsMax = LIMITS.attrCharsMax,
  } = props;
  assert(
    (value?.length ?? 0) <= valueCharsMax,
    'ListField: value limit exceeded',
  );
  const items = arrayItems(value) || [];
  assert(items.length <= itemsMax, 'ListField: item count limit exceeded');
  const [editor, setEditor] = useState({ kind: 'closed' });
  const write = (next, options) => {
    if (disabled) {
      return;
    }
    const text = arrayText(next);
    assert(text.length <= valueCharsMax, 'ListField: output limit exceeded');
    assert(
      next.length <= itemsMax,
      'ListField: output item count limit exceeded',
    );
    onChange(text, options.immediate, options.change);
  };
  const { drag, setDrag, drop } = useListDrag(items, write);
  const openAt = (event, index, item) => {
    setEditor(listEditorAt(event.currentTarget, index, item));
  };
  const closePending = () => {
    setEditor({ kind: 'closed' });
    const item = pendingListItem(editor);
    if (item) {
      write([...items, item], { immediate: true, change: { kind: 'add' } });
    }
  };
  const remove = (index) => {
    if (disabled || items.length <= itemsMin) {
      return;
    }
    setEditor({ kind: 'closed' });
    write(
      items.filter((_, current) => current !== index),
      {
        immediate: true,
        change: { kind: 'remove', index },
      },
    );
  };
  return {
    items,
    editor,
    setEditor,
    drag,
    setDrag,
    write,
    openAt,
    closePending,
    remove,
    drop,
    disabled,
    itemsMin,
    itemsMax,
  };
}
function listEditorAt(trigger, index, item) {
  const pos = listPopupPosition(trigger);
  return index === null
    ? { kind: 'pending', item, pos, trigger }
    : { kind: 'existing', index, pos, trigger };
}
function pendingListItem(editor) {
  if (editor.kind !== 'pending') {
    return undefined;
  }
  const said = editor.item.fields
    ? editor.item.fields.some((field) => String(field.text).trim())
    : String(editor.item.text).trim();
  return said ? editor.item : undefined;
}
function useListDrag(items, write) {
  const [drag, setDrag] = useState({ kind: 'idle' });
  const drop = () => {
    if (drag.kind === 'dragging' && drag.gap !== null) {
      const next = moveItem(items, drag.index, drag.gap);
      // A drop into the original gap must not create an undo/save operation.
      if (next.some((item, index) => item !== items[index])) {
        write(next, {
          immediate: true,
          change: { kind: 'move', index: drag.index, gap: drag.gap },
        });
      }
    }
    setDrag({ kind: 'idle' });
  };
  return { drag, setDrag, drop };
}
function listPopupPosition(element) {
  const row = element.closest('.list-field-row') || element;
  const rectangle = row.getBoundingClientRect();
  const width = Math.max(rectangle.width, 220);
  return {
    left: Math.max(8, Math.min(rectangle.left, window.innerWidth - width - 8)),
    top: Math.min(rectangle.bottom + 4, Math.max(60, window.innerHeight - 220)),
    width,
  };
}
function ListRow({ item, index, state }) {
  const { drag, editor, setDrag, remove, drop } = state;
  const dragging = drag.kind === 'dragging' ? drag.index : null;
  const gap = drag.kind === 'dragging' ? drag.gap : null;
  const open = editor.kind === 'existing' && editor.index === index;
  return (
    <ListFieldRow
      className={`${dragging === index ? 'is-dragging' : ''} ${gap === index ? 'is-before' : ''} ${gap === index + 1 ? 'is-after' : ''} ${open ? 'is-open' : ''}`}
      rowProps={{
        draggable: !state.disabled,
        onDragStart: (event) => startListDrag(event, state, index),
        onDragEnd: () => setDrag({ kind: 'idle' }),
        onDragOver: (event) => {
          if (drag.kind === 'idle') {
            return;
          }
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          const gap =
            event.clientY - box.top < box.height / 2 ? index : index + 1;
          setDrag({ ...drag, gap });
        },
        onDrop: (event) => {
          event.preventDefault();
          event.stopPropagation();
          drop();
        },
      }}
      expanded={open}
      disabled={state.disabled}
      removeDisabled={state.disabled || state.items.length <= state.itemsMin}
      removeLabel={`Remove ${itemLabel(item) || 'item'}`}
      onOpen={(event) => toggleListRow(event, state, index, item)}
      onRemove={() => remove(index)}
    >
      {itemLabel(item) || <span className="list-field-blank">Empty</span>}
    </ListFieldRow>
  );
}
function toggleListRow(event, state, index, item) {
  if (state.editor.kind === 'existing' && state.editor.index === index) {
    state.write(state.items, {
      immediate: true,
      change: { kind: 'edit', index },
    });
    state.setEditor({ kind: 'closed' });
    return;
  }
  state.openAt(event, index, item);
}
function startListDrag(event, state, index) {
  if (state.disabled) {
    return;
  }
  state.setDrag({ kind: 'dragging', index, gap: null });
  state.setEditor({ kind: 'closed' });
  event.dataTransfer.effectAllowed = 'move';
  try {
    event.dataTransfer.setData('text/plain', String(index));
  } catch {
    // Drag data is optional because this list keeps its gesture in local state.
  }
}
function ListEditor({ state }) {
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
          trigger={editor.trigger}
          onChange={(next) =>
            write(
              items.map((item, index) =>
                index === editor.index ? next : item,
              ),
              {
                immediate: false,
                change: { kind: 'edit', index: editor.index },
              },
            )
          }
          onClose={() => closeListRowEditor(state)}
        />
      );
    }
    case 'pending':
      return (
        <ItemEditor
          item={editor.item}
          pos={editor.pos}
          trigger={editor.trigger}
          onChange={(item) =>
            setEditor((current) =>
              current.kind === 'pending' ? { ...current, item } : current,
            )
          }
          onClose={closePending}
        />
      );
    default: {
      const exhaustive = editor;
      return exhaustive;
    }
  }
}
function closeListRowEditor(state) {
  if (state.editor.kind === 'existing') {
    // Commit before dismissing so scrolling cannot leave a popup detached from its row.
    state.write(state.items, {
      immediate: true,
      change: { kind: 'edit', index: state.editor.index },
    });
    state.setEditor({ kind: 'closed' });
  }
}
