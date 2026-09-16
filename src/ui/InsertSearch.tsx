import React, { useEffect, useMemo, useRef, useState } from 'react';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { HTML_TAGS } from '../elementSchemas.js';
import { rankInsertItems } from '../insertRank.js';
import { ASTRO_ASSETS } from '../astroAssets.js';
import {
  elementIcon,
  ElementComponentIcon,
  LayoutIcon,
  RepeatIcon,
  BranchIcon,
  TextIcon,
  CommentIcon,
  CodeIcon,
  SearchIcon,
  astroAssetIcon,
} from './Icons.jsx';

const TABS = [
  { key: 'all', label: 'All results' },
  { key: 'components', label: 'Components' },
  { key: 'elements', label: 'Elements' },
  { key: 'other', label: 'Other' },
] as const;
type Tab = (typeof TABS)[number]['key'];

// Quick-insert palette (⌘F / ⌘E): fuzzy-searches components, HTML tags, and
// special node types; Enter or click inserts at the current selection.
interface InsertComponent {
  readonly name: string;
  readonly folder?: string;
  readonly isLayout?: boolean;
}
export type InsertChoice =
  | { readonly type: 'component' | 'astroAsset'; readonly name: string }
  | { readonly type: 'element'; readonly tag: string }
  | {
      readonly type: 'map' | 'cond' | 'text' | 'comment' | 'expr' | 'doctype' | 'style' | 'script';
    };
export type InsertItem = InsertChoice & {
  readonly label: string;
  readonly sub?: string;
  readonly search?: string;
  readonly cat: 'components' | 'elements' | 'other';
  readonly icon: React.ReactNode;
};
interface InsertSearchProps {
  readonly components?: readonly InsertComponent[];
  readonly allowSlot?: boolean;
  readonly onInsert: (item: InsertItem) => void;
  readonly onClose: () => void;
}
export default function InsertSearch(props: InsertSearchProps) {
  const { onInsert, onClose } = props;
  const state = useInsertSearch(props);
  const { query, setQuery, tab, setTab, highlight, setHighlight, listRef, results } = state;
  return (
    <div className="insert-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="insert-palette"
        onKeyDown={(event) => insertKey(event, state, onInsert, onClose)}
      >
        <div className="insert-search-row">
          <SearchIcon size={14} />
          <input
            autoFocus
            value={query}
            placeholder="Search components, elements…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="insert-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`insert-tab ${tab === t.key ? 'on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="insert-results" ref={listRef}>
          {results.map((item, i) => (
            <div
              key={`${item.type}-${item.label}`}
              className={`insert-item ${i === highlight ? 'highlight' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onInsert(item)}
            >
              <span className="insert-item-icon">{item.icon}</span>
              <span className="insert-item-label">{item.label}</span>
              {item.sub && <span className="insert-item-sub">{item.sub}</span>}
            </div>
          ))}
          {results.length === 0 && <div className="props-empty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}

function useInsertSearch({ components, allowSlot }: InsertSearchProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo(
    () => insertItems(components ?? [], { allowSlot }),
    [components, allowSlot],
  );
  // The words, and where they land: see src/insertRank.js. The trailing space
  // is meaningful, so the query is not trimmed on the way in.
  const results = useMemo(() => {
    const items = allItems.filter((i) => tab === 'all' || i.cat === tab);
    return rankInsertItems(items, query).slice(0, 60);
  }, [allItems, query, tab]);

  useEffect(() => setHighlight(0), [query, tab]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.children[highlight];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  return { query, setQuery, tab, setTab, highlight, setHighlight, listRef, results };
}

type InsertState = ReturnType<typeof useInsertSearch>;
function insertKey(
  event: React.KeyboardEvent,
  state: InsertState,
  onInsert: (item: InsertItem) => void,
  onClose: () => void,
): void {
  const { results, highlight, setHighlight, tab, setTab } = state;
  const e = event;
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlight((h) => Math.min(h + 1, results.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlight((h) => Math.max(h - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = results[highlight];
    if (item) {
      onInsert(item);
    }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(idx + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length];
    assert(next !== undefined, 'InsertSearch: next tab exists');
    setTab(next.key);
  }
}
function insertItems(
  components: readonly InsertComponent[],
  options: {
    readonly allowSlot: boolean | undefined;
  },
): InsertItem[] {
  assert(components.length <= LIMITS.scanEntriesMax, 'InsertSearch: component limit exceeded');
  const items = [
    ...insertComponents(components),
    ...insertAssets(),
    ...insertTags(options),
    ...OTHER_ITEMS,
  ];
  assert(
    items.length <= LIMITS.scanEntriesMax + HTML_TAGS.length + 11,
    'InsertSearch: combined item limit exceeded',
  );
  // Project components stay first so a local Image is not shadowed by Astro's.
  return items;
}
function insertComponents(components: readonly InsertComponent[]): InsertItem[] {
  return components.map((c): InsertItem => ({
    type: 'component',
    name: c.name,
    label: c.name,
    sub: c.folder || 'component',
    cat: 'components',
    icon: c.isLayout ? (
      <LayoutIcon size={15} style={{ color: '#79e09c' }} />
    ) : (
      <ElementComponentIcon size={15} style={{ color: '#79e09c' }} />
    ),
  }));
}
function insertAssets(): InsertItem[] {
  return ASTRO_ASSETS.map((a): InsertItem => ({
    type: 'astroAsset',
    name: a.name,
    label: `<${a.name}>`,
    sub: 'astro:assets',
    search: `${a.name} astro assets image picture optimised responsive`,
    cat: 'components',
    icon: astroAssetIcon(a.name, 15),
  }));
}
function insertTags({ allowSlot }: { readonly allowSlot: boolean | undefined }): InsertItem[] {
  return (allowSlot ? [...HTML_TAGS, 'slot'].sort() : HTML_TAGS).map((tag): InsertItem => ({
    type: 'element',
    tag,
    label: `<${tag}>`,
    search: tag === 'slot' ? 'slot children content' : tag,
    ...(tag === 'slot' ? { sub: 'what the caller passes in' } : {}),
    cat: 'elements',
    icon: elementIcon(tag, 14),
  }));
}
const OTHER_ITEMS: readonly InsertItem[] = [
  {
    type: 'map',
    label: 'Loop',
    sub: 'items.map',
    cat: 'other',
    icon: <RepeatIcon size={14} style={{ color: '#c4afff' }} />,
  },
  {
    type: 'cond',
    label: 'Condition',
    sub: 'if / else',
    search: 'condition if else ternary show hide',
    cat: 'other',
    icon: <BranchIcon size={14} style={{ color: '#c4afff' }} />,
  },
  { type: 'text', label: 'Text', cat: 'other', icon: <TextIcon size={14} /> },
  { type: 'comment', label: 'Comment', cat: 'other', icon: <CommentIcon size={14} /> },
  {
    type: 'expr',
    label: 'Code Expression',
    sub: '{ }',
    cat: 'other',
    icon: <CodeIcon size={14} />,
  },
  {
    type: 'doctype',
    label: 'Doctype',
    sub: '<!doctype html>',
    search: 'doctype html',
    cat: 'other',
    icon: <CodeIcon size={14} />,
  },
  {
    type: 'style',
    label: 'Style Block',
    sub: '<style>',
    cat: 'other',
    icon: <CodeIcon size={14} />,
  },
  {
    type: 'script',
    label: 'Script Block',
    sub: '<script>',
    cat: 'other',
    icon: <CodeIcon size={14} />,
  },
];
