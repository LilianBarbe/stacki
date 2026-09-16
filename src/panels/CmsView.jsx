import FieldRow from './CmsField';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog } from '../ui/ConfirmDialog.jsx';
import {
  PlusIcon,
  CloseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  TrashIcon,
  DragIcon,
  CheckIcon,
  VariableTextSizeIcon,
  ParagraphIcon,
  FieldNumberIcon,
  SwitchIcon,
  ElementImageIcon,
  CalendarIcon,
  ElementLinkIcon,
  MailIcon,
  PhoneCallIcon,
  DropletIcon,
  ElementListDefaultIcon,
  BracesIcon,
  RepeatIcon,
  CodeIcon,
} from '../ui/Icons.jsx';
import AutoTextarea from '../ui/AutoTextarea.jsx';
import AssetField from '../ui/AssetField.jsx';
import ExprInput from '../ui/ExprInput.jsx';
import useListReorder from '../ui/useListReorder.js';
import {
  applyToItems,
  collectionOf,
  dropKey,
  fieldsAt,
  fieldsOf,
  labelize,
  orderKeys,
  putKey,
  renameKey,
  titleOf,
  blankItem,
  duplicateItem,
  emptyValueFor,
  inferType,
  keyFor,
  isPlainObject,
  isExpr,
  EXPR_KEY,
  reassemble,
} from '../cmsSchema.js';

const SAVE_DELAY = 400;

// The field types a collection can hold, each mapping onto a JSON shape.
// A field's type is fixed once it exists: it's inferred from the data, so
// changing it would mean rewriting every item's value.
const FIELD_TYPES = [
  { value: 'text', label: 'Text', Icon: VariableTextSizeIcon, hint: 'A short line' },
  { value: 'longtext', label: 'Long text', Icon: ParagraphIcon, hint: 'A paragraph' },
  { value: 'number', label: 'Number', Icon: FieldNumberIcon, hint: 'A figure' },
  { value: 'boolean', label: 'Toggle', Icon: SwitchIcon, hint: 'On or off' },
  { value: 'image', label: 'Image', Icon: ElementImageIcon, hint: 'From your assets' },
  { value: 'date', label: 'Date', Icon: CalendarIcon, hint: 'A calendar date' },
  { value: 'link', label: 'Link', Icon: ElementLinkIcon, hint: 'A web address' },
  { value: 'email', label: 'Email', Icon: MailIcon, hint: 'An address' },
  { value: 'phone', label: 'Phone', Icon: PhoneCallIcon, hint: 'A number to call' },
  { value: 'color', label: 'Color', Icon: DropletIcon, hint: 'A hex value' },
  { value: 'list', label: 'List of text', Icon: ElementListDefaultIcon, hint: 'Tags, bullets' },
  { value: 'object', label: 'Group', Icon: BracesIcon, hint: 'Fields kept together' },
  { value: 'objects', label: 'Repeating items', Icon: RepeatIcon, hint: 'A list of entries' },
  // Not offered when creating a field: a value is code because the file says
  // so, never because someone picked it from a list.
  { value: 'code', label: 'Code', Icon: CodeIcon, hint: 'A computed value' },
];

// The types you can choose for a new field.
const CREATABLE_TYPES = FIELD_TYPES.filter((t) => t.value !== 'code');

const typeInfo = (type) =>
  FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];

// The CMS editor, shown over the canvas while the CMS panel is open: items on
// the left, the selected item's fields on the right. Everything writes back to
// the JSON file it came from, matching its original shape.
export default function CmsView({
  project,
  rel,
  hidden,
  settings,
  showToast,
  onSaved,
  onCloseSettings,
  onDeleted,
  onClose,
  onRecordUndo,
}) {
  const [collection, setCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(0);
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  // Types the user picked when creating a field, keyed by dotted field path.
  // Inference can't tell a phone number from a line of text, and an empty
  // field tells it nothing at all, so these are remembered on disk.
  const [declared, setDeclared] = useState({});

  // An image in a data file is named relative to the file itself
  // ("../assets/hero.png"), which is the form Astro follows back into src/.
  // The fields need that folder to know what a value points at, and where a
  // newly picked one has to point back from.
  const baseDir = `src/${rel}`.replace(/\/[^/]*$/, '');

  // What a picked picture becomes in a data file. A file under public/ is
  // served as it is, so the value is its URL; one under src/ has to be
  // imported, so the main process writes the import and hands back the name to
  // store. A JSON collection can hold neither an import nor a name, so it keeps
  // writing paths — the field falls back to that when this is absent.
  const canImport = String(rel).includes('#');
  const pickAsset = useCallback(
    async (picked) => {
      const res = await window.avb.cmsAssetRef({
        projectPath: project.path,
        rel,
        assetRel: picked.rel,
      });
      return res.value !== undefined ? res.value : { [EXPR_KEY]: res.name, __asset: res.asset };
    },
    [project.path, rel]
  );

  const saveTimer = useRef(null);
  const pending = useRef(null); // items waiting to be written
  // The data currently on disk, so a save can record what it replaced for undo.
  const onDiskRef = useRef(null);
  const moveRef = useRef(null); // set below, once `move` exists

  const load = useCallback(async () => {
    try {
      const [{ data }, { meta }] = await Promise.all([
        window.avb.readCms({ projectPath: project.path, rel }),
        window.avb.cmsMeta(project.path),
      ]);
      onDiskRef.current = data;
      setDeclared(meta?.[rel] || {});
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const c = collectionOf({ rel, name, dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', data });
      setCollection(c);
      setItems(c.items);
      setSel((s) => Math.min(s, Math.max(0, c.items.length - 1)));
    } catch (err) {
      const detail = String(err?.message || err)
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^(Syntax)?Error:\s*/, '');
      setCollection({
        rel,
        label: rel.slice(rel.lastIndexOf('/') + 1),
        items: [],
        error: `This file can't be read as content — ${detail}`,
      });
      setItems([]);
    }
  }, [project.path, rel]);

  useEffect(() => {
    setSel(0);
    setQuery('');
    load();
  }, [load]);

  // External edits (an editor, a git checkout) refresh the view. Our own
  // writes don't come back — the watcher ignores them, so an unsaved edit
  // still in the debounce window is written out before reloading.
  useEffect(
    () => window.avb.onCmsChanged(() => (pending.current ? flushRef.current().then(load) : load())),
    [load]
  );

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || !collection) {return;}
    try {
      const before = onDiskRef.current;
      const after = reassemble(collection, next);
      await window.avb.writeCms({ projectPath: project.path, rel, data: after });
      onDiskRef.current = after;
      // Content edits don't touch the page model, so they need their own undo
      // entry. One step per burst of typing in the same collection.
      if (before !== undefined && onRecordUndo) {
        const put = async (data) => {
          await window.avb.writeCms({ projectPath: project.path, rel, data });
          onDiskRef.current = data;
          await load();
          onSaved?.();
        };
        onRecordUndo({
          label: 'content edit',
          coalesceKey: `cms:${rel}`,
          undo: () => put(before),
          redo: () => put(after),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      onSaved?.(); // the panel's item counts came from before this write
    } catch (err) {
      const message = String(err?.message || err).replace(
        /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
        ''
      );
      // The collection was deleted while this edit was in flight — the delete
      // was deliberate, so there's nothing to report.
      if (/no longer exists/.test(message)) {return;}
      showToast(message, 'error');
    }
  }, [collection, project.path, rel, showToast, onSaved, onRecordUndo, load]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Write the last edit out when leaving, so a quick change followed by a
  // panel switch isn't lost.
  useEffect(() => () => { if (pending.current) {flushRef.current();} }, []);

  const commit = (next) => {
    setItems(next);
    pending.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
  };

  const fields = useMemo(
    () => withDeclaredTypes(fieldsOf(items), declared, []),
    [items, declared]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => !q || titleOf(item, index).toLowerCase().includes(q));
  }, [items, query]);

  // Reordering is by pointer, not the native drag API — see useListReorder.
  // Declared with the other hooks, above the early return below: `move` is
  // defined further down (it needs `commit`), so it's reached through a ref.
  // Disabled while a search is on — the visible rows aren't the whole list, so
  // "drop it here" has no honest answer.
  const reorder = useListReorder({
    count: items.length,
    onMove: (from, to) => moveRef.current?.(from, to),
    disabled: !!query,
  });

  if (!collection) {return <div className={`cms-view ${hidden ? 'hidden' : ''}`} />;}

  const single = collection.single;
  const item = items[sel];

  // --- item operations -------------------------------------------------

  const addItem = () => {
    const next = [...items, blankItem(items)];
    commit(next);
    setSel(next.length - 1);
    setQuery('');
  };

  const duplicate = () => {
    const next = [...items];
    next.splice(sel + 1, 0, duplicateItem(item));
    commit(next);
    setSel(sel + 1);
  };

  const removeItem = async () => {
    if (
      !(await confirmDialog({
        title: `Delete “${titleOf(item, sel)}”?`,
        body: 'It’s removed from this collection.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return;
    }
    const next = items.filter((_, i) => i !== sel);
    commit(next);
    setSel(Math.max(0, Math.min(sel, next.length - 1)));
  };

  const move = (from, to) => {
    if (from === to || to == null) {return;}
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    commit(next);
    setSel(next.indexOf(moved));
  };
  moveRef.current = move;

  const setItemValue = (key, value) => {
    const next = items.map((it, i) => (i === sel ? { ...it, [key]: value } : it));
    commit(next);
  };

  // --- schema operations, from the settings pane -------------------------
  //
  // A field belongs to the collection, not to one item, so each of these
  // rewrites every item at that level.

  const saveDeclared = (next) => {
    setDeclared(next);
    window.avb
      .setCmsMeta({ projectPath: project.path, rel, fields: next })
      .catch(() => {
        /* the types just fall back to inference */
      });
  };

  const addFieldAt = (path, key, type) => {
    if (!key) {return;}
    if (fieldsAt(items, path).some((f) => f.key === key)) {return;}
    saveDeclared({ ...declared, [[...path, key].join('.')]: type });
    commit(applyToItems(items, path, putKey(key, type)));
  };

  // Returns false when the name can't be used, so the row can put the old
  // one back rather than showing a name the data doesn't have.
  const renameFieldAt = (path, from, to) => {
    if (!to || to === from) {return false;}
    if (fieldsAt(items, path).some((f) => f.key === to)) {
      showToast(`This level already has a “${labelize(to)}” field.`, 'error');
      return false;
    }
    const fromPath = [...path, from].join('.');
    const toPath = [...path, to].join('.');
    if (declared[fromPath] || Object.keys(declared).some((k) => k.startsWith(fromPath + '.'))) {
      const next = {};
      for (const [k, v] of Object.entries(declared)) {
        next[k === fromPath || k.startsWith(fromPath + '.') ? toPath + k.slice(fromPath.length) : k] = v;
      }
      saveDeclared(next);
    }
    commit(applyToItems(items, path, renameKey(from, to)));
    return true;
  };

  const removeFieldAt = (path, key) => {
    const gone = [...path, key].join('.');
    if (declared[gone] || Object.keys(declared).some((k) => k.startsWith(gone + '.'))) {
      const next = {};
      for (const [k, v] of Object.entries(declared)) {
        if (k !== gone && !k.startsWith(gone + '.')) {next[k] = v;}
      }
      saveDeclared(next);
    }
    commit(applyToItems(items, path, dropKey(key)));
  };

  const reorderFieldsAt = (path, keys) => {
    commit(applyToItems(items, path, orderKeys(keys)));
  };

  if (settings) {
    return (
      <div className={`cms-view ${hidden ? 'hidden' : ''}`}>
        <CmsSettings
          collection={collection}
          items={items}
          declared={declared}
          saved={saved}
          project={project}
          showToast={showToast}
          onDeleted={onDeleted}
          onAddField={addFieldAt}
          onRenameField={renameFieldAt}
          onRemoveField={removeFieldAt}
          onReorderFields={reorderFieldsAt}
          onDone={onCloseSettings}
        />
      </div>
    );
  }

  return (
    <div className={`cms-view ${hidden ? 'hidden' : ''}`}>
      <div className="cms-items">
        <div className="cms-items-head">
          <span className="cms-items-title">{collection.label}</span>
          {!single && (
            <button className="ghost" title="New item" onClick={addItem}>
              <PlusIcon size={14} />
            </button>
          )}
        </div>

        {!single && items.length > 7 && (
          <div className="cms-search">
            <input
              value={query}
              placeholder="Search items"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        <div className="cms-item-list">
          {filtered.map(({ item: row, index }) => (
            <div
              key={index}
              className={`cms-item ${index === sel ? 'on' : ''} ${reorder.rowClass(index)}`}
              {...reorder.rowProps(index)}
              onClick={() => setSel(index)}
            >
              <span className="cms-item-grip">
                <DragIcon size={12} />
              </span>
              <span className="cms-item-title">{titleOf(row, index)}</span>
              <ChevronRightIcon size={10} />
            </div>
          ))}

          {items.length === 0 && (
            <div className="props-empty">
              Nothing here yet.
              <div style={{ marginTop: 10 }}>
                <button className="primary" onClick={addItem}>
                  Add the first item
                </button>
              </div>
            </div>
          )}
          {items.length > 0 && filtered.length === 0 && (
            <div className="props-empty">No items match “{query}”.</div>
          )}
        </div>
      </div>

      <div className="cms-detail">
        <div className="cms-detail-head">
          <button className="ghost cms-back" title="Close the CMS" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
          <span className="cms-detail-title">
            {item !== undefined ? titleOf(item, sel) : collection.label}
          </span>
          <span className={`cms-saved ${saved ? 'on' : ''}`}>
            <CheckIcon size={11} /> Saved
          </span>
          <span className="cms-detail-path">src/{collection.rel}</span>
          {item !== undefined && !single && (
            <>
              <button className="ghost" title="Duplicate item" onClick={duplicate}>
                <CopyIcon size={13} />
              </button>
              <button className="ghost danger" title="Delete item" onClick={removeItem}>
                <TrashIcon size={13} />
              </button>
            </>
          )}
        </div>

        <div className="cms-detail-body">
          {collection.error && <div className="cms-error">{collection.error}</div>}

          {item !== undefined && !isPlainObject(item) && (
            <div className="cms-card">
              <h3>{single ? collection.label : 'Basic info'}</h3>
              <FieldRow
                label="Value"
                type={inferType(item)}
                value={item}
                projectPath={project.path}
                baseDir={baseDir}
                pickAsset={canImport ? pickAsset : undefined}
                onChange={(v) => commit(items.map((it, i) => (i === sel ? v : it)))}
              />
            </div>
          )}

          {isPlainObject(item) && (
            <div className="cms-card">
              <h3>{single ? collection.label : 'Basic info'}</h3>
              {fields.map((field) => (
                <FieldRow
                  key={field.key}
                  label={field.label}
                  type={
                    item[field.key] === undefined
                      ? field.type
                      : bestType(field.type, item[field.key])
                  }
                  value={item[field.key]}
                  projectPath={project.path}
                  baseDir={baseDir}
                  pickAsset={canImport ? pickAsset : undefined}
                  onChange={(v) => setItemValue(field.key, v)}
                />
              ))}
              {fields.length === 0 && (
                <div className="props-empty">
                  This collection has no fields yet — add them in its settings.
                </div>
              )}
            </div>
          )}

          {item === undefined && !collection.error && (
            <div className="props-empty">Select an item to edit it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Collection settings — the shape of the data rather than its content. Adding,
// renaming, retyping and reordering a field here rewrites every item at once,
// which is why none of it is reachable from the item editor.
function CmsSettings({
  collection,
  items,
  declared,
  saved,
  project,
  showToast,
  onDeleted,
  onAddField,
  onRenameField,
  onRemoveField,
  onReorderFields,
  onDone,
}) {
  return (
    <div className="cms-settings">
      <div className="cms-detail-head">
        <button className="ghost cms-back" title="Back to items" onClick={onDone}>
          <ChevronLeftIcon size={14} />
        </button>
        <span className="cms-detail-title">{collection.label} Settings</span>
        <span className={`cms-saved ${saved ? 'on' : ''}`}>
          <CheckIcon size={11} /> Saved
        </span>
        <span className="cms-detail-path">src/{collection.rel}</span>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>

      <div className="cms-detail-body">
        <div className="cms-card">
          <h3>Collection fields</h3>
          <p className="cms-note">
            {collection.single
              ? 'This file holds one set of fields.'
              : `Shared by all ${items.length} ${items.length === 1 ? 'item' : 'items'}.`}
          </p>
          <FieldSchema
            items={items}
            declared={declared}
            path={[]}
            onAddField={onAddField}
            onRenameField={onRenameField}
            onRemoveField={onRemoveField}
            onReorderFields={onReorderFields}
          />
        </div>

        <div className="cms-card cms-danger">
          <h3>Delete collection</h3>
          <p className="cms-note">
            Moves src/{collection.rel} to the Trash. Pages that import it keep working — they
            switch to an empty list.
          </p>
          <button className="ghost danger" onClick={() => deleteCollection(collection, project, showToast, onDeleted)}>
            <TrashIcon size={12} /> Delete {collection.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// Names the pages that import the collection before it goes, since they're
// rewritten as part of the delete.
async function deleteCollection(collection, project, showToast, onDeleted) {
  const fail = (err) =>
    showToast(
      String(err?.message || err).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''),
      'error'
    );
  let used;
  try {
    used = (await window.avb.cmsUsage({ projectPath: project.path, rel: collection.rel })).files || [];
  } catch (err) {
    fail(err);
    return;
  }
  const where =
    used.length === 0
      ? 'No page uses it.'
      : `${used.length === 1 ? '1 page uses' : `${used.length} pages use`} it (${used
          .slice(0, 3)
          .join(', ')}${used.length > 3 ? `, +${used.length - 3} more` : ''}). ` +
        'They will keep working, showing nothing, until you point them at other data.';
  if (
    !(await confirmDialog({
      title: `Delete the ${collection.label} collection?`,
      body: where,
      confirmLabel: 'Delete collection',
      danger: true,
    }))
  ) {
    return;
  }
  try {
    await window.avb.deleteCms({ projectPath: project.path, rel: collection.rel });
    onDeleted?.();
  } catch (err) {
    fail(err);
  }
}

// The fields defined at one level, with the nested levels folded underneath.
function FieldSchema({ items, declared, path, ...ops }) {
  const fields = withDeclaredTypes(fieldsAt(items, path), declared, path);
  const [expanded, setExpanded] = useState(() => new Set());

  // Each level reorders its own fields; nesting is handled by the hook being
  // per-FieldSchema, so a nested list never answers the level above it.
  const move = (from, to) => {
    if (from === to || to == null) {return;}
    const keys = fields.map((f) => f.key);
    const [moved] = keys.splice(from, 1);
    keys.splice(to > from ? to - 1 : to, 0, moved);
    ops.onReorderFields(path, keys);
  };
  const reorder = useListReorder({ count: fields.length, onMove: move });

  return (
    <div className="cms-schema">
      {fields.map((field, fieldIndex) => {
        const nested = field.type === 'objects' || field.type === 'object';
        const open = expanded.has(field.key);
        const info = typeInfo(field.type === 'empty' ? 'text' : field.type);
        const Icon = info.Icon;
        return (
          <div key={field.key} className="cms-schema-group">
            <div
              className={`cms-schema-row ${reorder.rowClass(fieldIndex)}`}
              {...reorder.rowProps(fieldIndex)}
            >
              <span className="cms-schema-grip">
                <DragIcon size={11} />
              </span>
              {nested ? (
                <button
                  className="ghost cms-schema-expand"
                  title={open ? 'Hide its fields' : 'Show its fields'}
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(field.key) ? next.delete(field.key) : next.add(field.key);
                      return next;
                    })
                  }
                >
                  <ChevronRightIcon size={10} className={open ? 'rotated' : ''} />
                </button>
              ) : (
                <span className="cms-schema-expand" />
              )}
              <input
                key={field.key}
                className="cms-schema-name"
                defaultValue={field.label}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {e.currentTarget.blur();}
                  if (e.key === 'Escape') {
                    e.currentTarget.value = field.label;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  const next = keyFor(e.target.value);
                  if (!next || !ops.onRenameField(path, field.key, next)) {
                    e.target.value = field.label;
                  }
                }}
              />
              <span className="cms-schema-type" title="A field's type is set when it's created">
                <Icon size={13} />
                {info.label}
              </span>
              <button
                className="ghost danger"
                title="Delete field"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: `Delete the “${field.label}” field?`,
                      body: 'Its content is removed from every item in this collection.',
                      confirmLabel: 'Delete field',
                      danger: true,
                    })
                  ) {
                    ops.onRemoveField(path, field.key);
                  }
                }}
              >
                <TrashIcon size={12} />
              </button>
            </div>

            {nested && open && (
              <div className="cms-schema-nested">
                <FieldSchema
                  items={items}
                  declared={declared}
                  path={[...path, field.key]}
                  {...ops}
                />
              </div>
            )}
          </div>
        );
      })}

      {fields.length === 0 && <div className="cms-empty-inline">No fields yet.</div>}

      <AddFieldRow compact={path.length > 0} onAdd={(key, type) => ops.onAddField(path, key, type)} />
    </div>
  );
}

// A declared type wins over the inferred one — that's the point of declaring
// it. The exception is a shape inference is sure about (a list, a group, a
// number): if the data really holds one of those, the control has to match.
const STRUCTURAL = ['object', 'objects', 'list', 'boolean', 'number'];

function withDeclaredTypes(fields, declared, path) {
  if (!declared) {return fields;}
  return fields.map((field) => {
    const chosen = declared[[...path, field.key].join('.')];
    if (!chosen || STRUCTURAL.includes(field.type)) {return field;}
    return { ...field, type: chosen };
  });
}

// The collection-wide type wins unless this item's own value disagrees about
// its shape (a field that's a list here and a string there).
function bestType(collectionType, value) {
  const own = inferType(value);
  if (own === 'empty') {return collectionType;}
  const structural = ['object', 'objects', 'list', 'boolean', 'number'];
  if (structural.includes(own) || structural.includes(collectionType)) {return own;}
  // A logo the sniffer can't recognise ("/logo", "/img?id=2") is still the
  // collection's image field — keep the picker rather than dropping to a
  // bare text box for one odd value.
  if (collectionType === 'image' || collectionType === 'date') {return collectionType;}
  return collectionType === 'longtext' ? 'longtext' : own;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function AddFieldRow({ onAdd, compact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`cms-add ${compact ? 'compact' : ''}`} onClick={() => setOpen(true)}>
        <PlusIcon size={11} /> Add field
      </button>
      {open && (
        <NewFieldDialog
          onAdd={(key, type) => {
            onAdd(key, type);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Pick the type first — it decides what the field can hold, and it can't be
// changed afterwards — then name it.
function NewFieldDialog({ onAdd, onClose }) {
  const [type, setType] = useState(null);
  const [name, setName] = useState('');
  const overlayRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') {return;}
      const open = document.querySelectorAll('.cms-modal-overlay');
      if (open[open.length - 1] !== overlayRef.current) {return;}
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const info = type ? typeInfo(type) : null;
  const submit = () => {
    const key = keyFor(name);
    if (key) {onAdd(key, type);}
  };

  return (
    <div
      ref={overlayRef}
      className="modal-overlay cms-modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal cms-modal cms-type-modal">
        <div className="modal-header cms-modal-header">
          {type && (
            <button className="ghost" title="Back to field types" onClick={() => setType(null)}>
              <ChevronLeftIcon size={13} />
            </button>
          )}
          <span>{type ? `New ${info.label} field` : 'Choose a field type'}</span>
          <button className="ghost" title="Close" onClick={onClose}>
            <CloseIcon size={12} />
          </button>
        </div>

        {!type ? (
          <div className="cms-type-grid">
            {CREATABLE_TYPES.map(({ value, label, Icon, hint }) => (
              <button key={value} className="cms-type-tile" onClick={() => setType(value)}>
                <Icon size={18} />
                <span className="cms-type-name">{label}</span>
                <span className="cms-type-hint">{hint}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="modal-body">
              <div>
                <label>Name</label>
                <input
                  autoFocus
                  value={name}
                  placeholder={`e.g. ${info.label === 'Text' ? 'Subtitle' : info.label}`}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {submit();}
                  }}
                />
              </div>
              {keyFor(name) && (
                <div className="cms-note" style={{ margin: 0 }}>
                  Your code reads this as <code>{keyFor(name)}</code>.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" onClick={submit} disabled={!keyFor(name)}>
                Add field
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
