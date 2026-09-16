import { assert } from '../shared/assert';
import { BOUNDARY_LIMITS, data as parseData } from '../shared/boundary';
import { toArray, toRecord } from '../shared/record';
export interface CmsFile {
  readonly rel: string;
  readonly name: string;
  readonly dir: string;
  readonly error?: string;
  readonly data?: unknown;
}
export interface Collection {
  readonly rel: string;
  readonly name: string;
  readonly dir: string;
  readonly label: string;
  readonly error: string | null;
  readonly items: readonly unknown[];
  readonly single: boolean;
  readonly rootKey: string | null;
  readonly raw?: Readonly<Record<string, unknown>>;
}
export interface CmsField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
}
type ObjectEdit = (object: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

// Turns the JSON files under src/ into something a CMS can show: a collection
// of items, each with typed fields. Nothing here is configured — the shape is
// inferred from the data that's already in the file, so a designer can edit
// content without knowing it's JSON.

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/;
const COLOR_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  toRecord(value) !== undefined;

/**
 * A value the CMS carries as source rather than data: `{ __expr: "new
 * Date().getFullYear() - FOUNDED" }`. Anything in a data file or a page's
 * frontmatter that isn't a literal arrives this way, so it can still be seen
 * and edited — as code — instead of being invisible. Written back verbatim.
 * The same marker is produced and consumed in electron/jsCollections.js.
 */
export const EXPR_KEY = '__expr';
export const isExpr = (
  value: unknown,
): value is Record<string, unknown> & { readonly __expr: string } =>
  isPlainObject(value) && typeof value[EXPR_KEY] === 'string';

// Field types, most specific first. When items disagree about a field (one has
// a short string, another a paragraph) the earlier type wins.
export const CMS_FIELD_TYPES = [
  'code',
  'objects',
  'object',
  'list',
  'boolean',
  'number',
  'color',
  'email',
  'phone',
  'link',
  'image',
  'date',
  'longtext',
  'text',
  'empty',
] as const;
export type FieldType = (typeof CMS_FIELD_TYPES)[number];

export function inferType(value: unknown): FieldType {
  // A name bound to a picture is a picture. The file says which one — the CMS
  // is handed that beside the name — so the field can show it and swap it,
  // rather than showing the word `dailyDevotionals` in a code box.
  if (isExpr(value)) {
    return typeof value['__asset'] === 'string' && IMAGE_RE.test(value['__asset'])
      ? 'image'
      : 'code';
  }
  if (value === null || value === undefined || value === '') {
    return 'empty';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  const values = toArray(value);
  if (values) {
    if (values.length && values.every(isPlainObject)) {
      return 'objects';
    }
    return 'list';
  }
  if (isPlainObject(value)) {
    return 'object';
  }
  const s = String(value);
  if (IMAGE_RE.test(s)) {
    return 'image';
  }
  if (COLOR_RE.test(s)) {
    return 'color';
  }
  if (DATE_RE.test(s)) {
    return 'date';
  }
  if (s.startsWith('mailto:') || EMAIL_RE.test(s)) {
    return 'email';
  }
  if (s.startsWith('tel:')) {
    return 'phone';
  }
  // Only absolute URLs — a relative path is as likely to be a slug or a
  // filename as a link, and a URL input would fight the user over it.
  if (/^https?:\/\//.test(s)) {
    return 'link';
  }
  if (s.length > 80 || s.includes('\n')) {
    return 'longtext';
  }
  return 'text';
}

// Human label for a file or key: "site-settings.json" → "Site settings",
// "featuredImage" → "Featured image".
export function labelize(raw: unknown): string {
  const base = String(raw).replace(/\.json$/i, '');
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) {
    return base;
  }
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// How a file maps onto a collection:
//   [ {...}, {...} ]              → a list of items
//   { "posts": [ {...} ] }        → the same, remembering the wrapper key
//   { "title": "...", ... }       → one item (a settings file)
// Files whose object has several arrays stay a single item, so each array
// shows up as its own repeater field rather than guessing which one is "the"
// collection.
export function collectionOf(file: CmsFile): Collection {
  const base = {
    rel: file.rel,
    name: file.name,
    dir: file.dir,
    label: labelize(file.name),
    error: file.error || null,
  };
  const data = file.data;
  if (file.error || data === undefined) {
    return { ...base, items: [], single: false, rootKey: null };
  }

  const rows = toArray(data);
  if (rows) {
    return { ...base, rootKey: null, items: rows, single: false };
  }
  if (isPlainObject(data)) {
    const arrayKeys = Object.keys(data).filter((k) => Array.isArray(data[k]));
    const rootKey = arrayKeys[0];
    const rows = rootKey === undefined ? null : toArray(data[rootKey]);
    if (arrayKeys.length === 1 && rootKey !== undefined && rows?.every(isPlainObject)) {
      // `raw` keeps the wrapper's other keys so writing back doesn't drop them.
      return { ...base, rootKey, raw: data, items: rows, single: false };
    }
    return { ...base, rootKey: null, items: [data], single: true };
  }
  // A bare string/number at the top level: one item holding that value.
  return { ...base, rootKey: null, items: [data], single: true };
}

// Puts edited items back in the shape the file had.
export function reassemble(collection: Collection, items: readonly unknown[]): unknown {
  if (collection.single) {
    return items[0] ?? {};
  }
  if (collection.rootKey) {
    return { ...(collection.raw || {}), [collection.rootKey]: items };
  }
  return items;
}

// The fields of a collection: the union of every item's keys, in the order
// they first appear, with a type inferred from the values present.
export function fieldsOf(items: readonly unknown[]): readonly CmsField[] {
  assert(items.length <= BOUNDARY_LIMITS.itemsMax, 'CMS item count exceeds limit');
  const order = [];
  const types = new Map<string, FieldType>();
  for (const item of items) {
    if (!isPlainObject(item)) {
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      if (!types.has(key)) {
        order.push(key);
        types.set(key, inferType(value));
      } else {
        const seen = types.get(key);
        assert(seen !== undefined, 'Known CMS field must have a type');
        const next = inferType(value);
        if (
          next !== 'empty' &&
          (seen === 'empty' || CMS_FIELD_TYPES.indexOf(next) < CMS_FIELD_TYPES.indexOf(seen))
        ) {
          types.set(key, next);
        }
      }
    }
  }
  return order.map((key) => {
    const type = types.get(key);
    assert(type !== undefined, 'Ordered CMS field must have a type');
    return { key, label: labelize(key), type };
  });
}

const TITLE_KEYS = [
  'name',
  'title',
  'label',
  'heading',
  'headline',
  'question',
  'slug',
  'id',
  'key',
];

// What to call an item in the list. Falls back to the first short string.
export function titleOf(item: unknown, index: number): string {
  if (!isPlainObject(item)) {
    // A list of plain values labels itself; blank ones still need a handle.
    const own = String(item ?? '').trim();
    return own || `Item ${index + 1}`;
  }
  for (const key of TITLE_KEYS) {
    const v = item[key];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && v.trim() && v.length <= 60) {
      return v.trim();
    }
  }
  return `Item ${index + 1}`;
}

// A blank value of the same shape, so "New item" arrives with the collection's
// fields already in place instead of an empty object.
export function blankLike(value: unknown, depth = 0): unknown {
  assert(depth <= BOUNDARY_LIMITS.depthMax, 'CMS value exceeds depth limit');
  const type = inferType(value);
  if (type === 'boolean') {
    return false;
  }
  if (type === 'number') {
    return 0;
  }
  if (type === 'objects') {
    return [];
  }
  if (type === 'list') {
    return [];
  }
  if (type === 'object' && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = blankLike(v, depth + 1);
    }
    return out;
  }
  return '';
}

export function blankItem(items: readonly unknown[]): unknown {
  const template = items.find(isPlainObject);
  if (!template) {
    // A collection of plain values (["Halcyon", "Verdant"]) gets another
    // value of the same kind, not an empty object.
    const sample = items.find((i) => i !== null && i !== undefined);
    return sample === undefined ? {} : blankLike(sample);
  }
  const out: Record<string, unknown> = {};
  for (const field of fieldsOf(items)) {
    const sample = items.find((i) => isPlainObject(i) && i[field.key] !== undefined);
    out[field.key] = blankLike(isPlainObject(sample) ? sample[field.key] : '');
  }
  return out;
}

// A typed-in field name becomes a JS-friendly key, so the code that reads the
// file gets `client.jobTitle` rather than `client["Job title"]`.
export function keyFor(name: unknown): string {
  const words = String(name)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) {
    return '';
  }
  return words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

export function emptyValueFor(type: string): unknown {
  if (type === 'code') {
    return { [EXPR_KEY]: '' };
  }
  if (type === 'boolean') {
    return false;
  }
  if (type === 'number') {
    return 0;
  }
  if (type === 'list' || type === 'objects') {
    return [];
  }
  if (type === 'object') {
    return {};
  }
  return '';
}

// Copies an item, giving slug-ish fields a distinct value so duplicates don't
// collide on routes that use them.
export function duplicateItem(item: unknown): unknown {
  const decoded: unknown = JSON.parse(JSON.stringify(item));
  const copy: unknown = parseData(decoded);
  if (isPlainObject(copy)) {
    for (const key of ['slug', 'id']) {
      if (typeof copy[key] === 'string' && copy[key]) {
        copy[key] = `${copy[key]}-copy`;
      }
    }
    for (const key of ['name', 'title']) {
      if (typeof copy[key] === 'string' && copy[key]) {
        copy[key] = `${copy[key]} copy`;
        break;
      }
    }
  }
  return copy;
}

export { isPlainObject };

// ---------------------------------------------------------------------------
// Schema edits — the collection's shape, changed across every item at once.
// A `path` addresses a level: [] is the item itself, ['team'] the objects
// inside each item's `team` array (or its `team` group).
// ---------------------------------------------------------------------------

// Every object living at `path`, for reading the fields defined there.
export function objectsAt(
  items: readonly unknown[],
  path: readonly string[],
): readonly Record<string, unknown>[] {
  assert(path.length <= BOUNDARY_LIMITS.depthMax, 'CMS path exceeds depth limit');
  let current = items.filter(isPlainObject);
  for (const key of path) {
    const next: Record<string, unknown>[] = [];
    for (const obj of current) {
      const value = obj[key];
      const values = toArray(value);
      if (values) {
        next.push(...values.filter(isPlainObject));
      } else if (isPlainObject(value)) {
        next.push(value);
      }
    }
    assert(next.length <= BOUNDARY_LIMITS.itemsMax, 'CMS object count exceeds limit');
    current = next;
  }
  return current;
}

export const fieldsAt = (items: readonly unknown[], path: readonly string[]) =>
  fieldsOf(objectsAt(items, path));

function transformAt(value: unknown, path: readonly string[], fn: ObjectEdit): unknown {
  if (!path.length) {
    return isPlainObject(value) ? fn(value) : value;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const [key, ...rest] = path;
  assert(key !== undefined, 'Nonempty CMS path must have a key');
  const child = value[key];
  if (child === undefined) {
    return value;
  }
  return {
    ...value,
    [key]: toArray(child)
      ? (toArray(child) ?? []).map((c) => transformAt(c, rest, fn))
      : transformAt(child, rest, fn),
  };
}

export function applyToItems(
  items: readonly unknown[],
  path: readonly string[],
  fn: ObjectEdit,
): readonly unknown[] {
  assert(path.length <= BOUNDARY_LIMITS.depthMax, 'CMS path exceeds depth limit');
  assert(items.length <= BOUNDARY_LIMITS.itemsMax, 'CMS item count exceeds limit');
  return items.map((item) => transformAt(item, path, fn));
}

// Renaming rebuilds the object so the field keeps its position in the file.
export const renameKey =
  (from: string, to: string): ObjectEdit =>
  (obj) => {
    if (!(from in obj) || from === to) {
      return obj;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k === from ? to : k] = v;
    }
    return out;
  };

export const dropKey =
  (key: string): ObjectEdit =>
  (obj) => {
    if (!(key in obj)) {
      return obj;
    }
    const out = { ...obj };
    delete out[key];
    return out;
  };

export const putKey =
  (key: string, type: string): ObjectEdit =>
  (obj) =>
    key in obj ? obj : { ...obj, [key]: emptyValueFor(type) };

export const orderKeys =
  (keys: readonly string[]): ObjectEdit =>
  (obj) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in obj) {
        out[k] = obj[k];
      }
    }
    for (const k of Object.keys(obj)) {
      if (!(k in out)) {
        out[k] = obj[k];
      }
    }
    return out;
  };
