import CmsSettings from './CmsSettings';
import {bestType, withDeclaredTypes} from './cmsTypes';
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

