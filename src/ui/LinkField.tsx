import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attr } from '../../shared/page-node';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import Dropdown from './Dropdown.jsx';
import AssetField from './AssetField.jsx';
import { ElementLinkIcon, FileIcon, PhoneIcon, ElementImageIcon } from './Icons.jsx';

// Webflow-style link settings for href props: a Type segmented control
// (URL / Page / Section / Email / Phone / Asset) whose fields all compile
// down to one href string. Plain URL mode stays available for anything
// custom; the value's shape picks the initial type.
//
// context: { pages: [{name, route}], sectionIds: [string], projectPath }

const TYPES = [
  { id: 'url', title: 'URL', icon: <ElementLinkIcon size={13} /> },
  { id: 'page', title: 'Page', icon: <FileIcon size={13} /> },
  { id: 'section', title: 'Page section', icon: <b style={{ fontSize: 12 }}>#</b> },
  { id: 'email', title: 'Email', icon: <b style={{ fontSize: 12 }}>@</b> },
  { id: 'phone', title: 'Phone', icon: <PhoneIcon size={13} /> },
  { id: 'asset', title: 'File / asset', icon: <ElementImageIcon size={13} /> },
] as const;
type LinkType = (typeof TYPES)[number]['id'];
interface LinkPage {
  readonly name: string;
  readonly route: string;
}

function detectType(str: string, pages: readonly LinkPage[] | undefined): LinkType {
  if (!str) {
    return 'url';
  }
  if (str.startsWith('#')) {
    return 'section';
  }
  if (str.startsWith('mailto:')) {
    return 'email';
  }
  if (str.startsWith('tel:')) {
    return 'phone';
  }
  if ((pages || []).some((p) => p.route === str)) {
    return 'page';
  }
  if (str.startsWith('/') && /\.[a-z0-9]+$/i.test(str)) {
    return 'asset';
  }
  return 'url';
}

function parseMailto(str: string) {
  const m = String(str).match(/^mailto:([^?]*)(?:\?(.*))?$/);
  if (!m) {
    return { email: '', subject: '' };
  }
  let subject = '';
  try {
    subject = new URLSearchParams(m[2] || '').get('subject') || '';
  } catch {
    /* malformed query — leave subject empty */
  }
  return { email: m[1] || '', subject };
}

interface LinkContext {
  readonly pages?: readonly LinkPage[];
  readonly sectionIds?: readonly string[];
  readonly projectPath: string;
}
interface LinkFieldProps {
  readonly value?: Attr | null;
  readonly context: LinkContext;
  readonly onChange: (value: Attr, immediate?: boolean) => void;
}
type Commit = (value: string, options?: { readonly immediate: boolean }) => void;
export default function LinkField({ value, context, onChange }: LinkFieldProps) {
  const text = value?.type === 'string' ? value.value : '';
  const [type, setType] = useState(() => detectType(text, context.pages));
  const lastRef = useRef(text);
  assert((context.pages?.length ?? 0) <= LIMITS.scanEntriesMax, 'LinkField: page limit exceeded');
  assert(
    (context.sectionIds?.length ?? 0) <= LIMITS.treeNodesMax,
    'LinkField: section limit exceeded',
  );
  useEffect(() => {
    if (text !== lastRef.current) {
      setType(detectType(text, context.pages));
      lastRef.current = text;
    }
  }, [text, context.pages]);
  const commit: Commit = (next, options) => {
    lastRef.current = next;
    onChange({ type: 'string', value: next }, options?.immediate ?? false);
  };
  return (
    <>
      <LinkTypes type={type} setType={setType} />
      <LinkControl type={type} text={text} context={context} commit={commit} />
    </>
  );
}

function LinkControl({
  type,
  text,
  context,
  commit,
}: {
  readonly type: LinkType;
  readonly text: string;
  readonly context: LinkContext;
  readonly commit: Commit;
}) {
  switch (type) {
    case 'url':
      return (
        <input
          value={text}
          placeholder="#"
          spellCheck={false}
          onChange={(event) => commit(event.target.value)}
        />
      );
    case 'page':
      return (
        <Dropdown
          value={(context.pages || []).some((page) => page.route === text) ? text : ''}
          placeholder="Choose a page…"
          options={(context.pages || []).map((page) => ({
            value: page.route,
            label: `${page.name.replace(/\.(astro|md)$/i, '')}  ·  ${page.route}`,
          }))}
          onChange={(value) => commit(value, { immediate: true })}
        />
      );
    case 'section':
      return <LinkSection text={text} sections={context.sectionIds ?? []} commit={commit} />;
    case 'email':
      return <LinkEmail text={text} commit={commit} />;
    case 'phone':
      return (
        <input
          value={text.startsWith('tel:') ? text.slice(4) : ''}
          placeholder="e.g. +14155551212"
          spellCheck={false}
          onChange={(event) => commit(`tel:${event.target.value.replace(/\s+/g, '')}`)}
        />
      );
    case 'asset':
      return (
        <AssetField
          value={detectType(text, context.pages) === 'asset' ? text : ''}
          mediaKind="asset"
          projectPath={context.projectPath}
          showModeToggle={false}
          onChange={(value, immediate) => commit(value || '', { immediate: immediate ?? false })}
        />
      );
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function LinkSection({
  text,
  sections,
  commit,
}: {
  readonly text: string;
  readonly sections: readonly string[];
  readonly commit: Commit;
}) {
  if (sections.length > 0) {
    return (
      <Dropdown
        value={text.startsWith('#') && sections.includes(text.slice(1)) ? text : ''}
        placeholder="Choose a section…"
        options={sections.map((id) => ({ value: `#${id}`, label: `#${id}` }))}
        onChange={(value) => commit(value, { immediate: true })}
      />
    );
  }
  return (
    <div className="link-note">
      No elements on this page have an <code>id</code> yet — set one in an element's attributes to
      anchor-link to it.
    </div>
  );
}

function LinkEmail({ text, commit }: { readonly text: string; readonly commit: Commit }) {
  const { email, subject } = parseMailto(text);
  return (
    <>
      <input
        value={email}
        placeholder="e.g. bob@gmail.com"
        spellCheck={false}
        onChange={(event) =>
          commit(
            `mailto:${event.target.value.trim()}${
              subject ? `?subject=${encodeURIComponent(subject)}` : ''
            }`,
          )
        }
      />
      <input
        value={subject}
        placeholder="Subject (optional)"
        onChange={(event) =>
          commit(
            `mailto:${email}${
              event.target.value ? `?subject=${encodeURIComponent(event.target.value)}` : ''
            }`,
          )
        }
      />
    </>
  );
}

function LinkTypes({
  type,
  setType,
}: {
  readonly type: LinkType;
  readonly setType: (type: LinkType) => void;
}) {
  const { rowRef, btnRefs, indicator } = useLinkIndicator(type);
  return (
    <div className="link-types" ref={rowRef}>
      {indicator && <span className="link-types-indicator" style={indicator} />}
      {TYPES.map((t) => (
        <button
          key={t.id}
          ref={(element) => {
            btnRefs.current[t.id] = element;
          }}
          type="button"
          className={type === t.id ? 'on' : ''}
          title={t.title}
          onClick={() => setType(t.id)}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

function useLinkIndicator(type: LinkType) {
  // Sliding highlight behind the active type button. Measuring once on mount
  // isn't enough: the Settings pane is display:none while the Style tab is up,
  // so a field that mounts behind it measures a zero-wide chip — invisible,
  // and it would stay that way until the type was changed. Re-measure after
  // every render (the panel re-renders when the tab comes back) and whenever
  // the row itself resizes (panel drag, or gaining a box on reveal).
  const rowRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const typeRef = useRef(type);
  typeRef.current = type;
  const [indicator, setIndicator] = useState<{
    readonly left: number;
    readonly width: number;
  } | null>(null);
  const measure = () => {
    const el = btnRefs.current[typeRef.current];
    const next = el && el.offsetWidth ? { left: el.offsetLeft, width: el.offsetWidth } : null;
    // Same numbers must yield the same object, or measuring on every render
    // would re-render forever.
    setIndicator((prev) =>
      prev && next && prev.left === next.left && prev.width === next.width ? prev : next,
    );
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    if (!rowRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const ro = new ResizeObserver(measure);
    ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, []);

  return { rowRef, btnRefs, indicator };
}
