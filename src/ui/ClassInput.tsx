import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { assert } from '../../shared/assert';
import { LIMITS } from '../../shared/limits';
import { CheckIcon } from './Icons.jsx';

// Classes in a scale are named for it: gap-2 sits beside gap-1 and gap-4,
// margin-top-6 beside margin-top-2. Everything up to the last dash or
// underscore is the family; clicking a tag offers the rest of it.
const collator = new Intl.Collator(undefined, { numeric: true });

function familyPrefix(cls: string) {
  const cut = Math.max(cls.lastIndexOf('-'), cls.lastIndexOf('_'));
  return cut > 0 ? cls.slice(0, cut + 1) : null;
}

// Token editor for class-list props: each class renders as a tag, a text
// caret can sit between any two tags (click a tag to place the caret after
// it, Backspace removes the tag before the caret), and typing filters a
// suggestion list of every class used across the project.
interface ClassInputProps {
  readonly value?: string | null;
  readonly suggestions?: readonly string[];
  readonly onChange: (value: string, immediate: boolean) => void;
}
interface PopupPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}
interface Family {
  readonly index: number;
  readonly options: readonly string[];
  readonly left: number;
  readonly top: number;
}
export default function ClassInput(props: ClassInputProps) {
  const state = useClassInput(props);
  const { wrapRef, focused, setCaret, tokens, inputRef } = state;
  return (
    <>
      <div
        ref={wrapRef}
        className={`class-input ${focused ? 'focused' : ''}`}
        onMouseDown={(e) => {
          if (e.target === wrapRef.current) {
            e.preventDefault();
            setCaret(tokens.length);
            inputRef.current?.focus();
          }
        }}
      >
        <ClassTokens state={state} />
      </div>
      <ClassSuggestions state={state} />
      <ClassFamilyMenu state={state} />
    </>
  );
}

function useClassInput({ value, suggestions = [], onChange }: ClassInputProps) {
  assert((value?.length ?? 0) <= LIMITS.attrCharsMax, 'ClassInput: value limit exceeded');
  assert(suggestions.length <= 100_000, 'ClassInput: suggestion limit exceeded');
  const tokens = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [caret, setCaret] = useState(tokens.length);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPos, setPopupPos] = useState<PopupPosition | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const at = Math.min(caret, tokens.length);

  const tokenActions = classTokenActions({ tokens, at, setCaret, setDraft, onChange });
  const familyState = useClassFamily(tokens, onChange);
  const matches = classMatches(draft, suggestions, tokens);
  useLayoutEffect(() => {
    if (!focused || !matches.length || !wrapRef.current) {
      setPopupPos(null);
      return;
    }
    const r = wrapRef.current.getBoundingClientRect();
    setPopupPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [focused, matches.length, draft]);

  return {
    ...tokenActions,
    ...familyState,
    tokens,
    at,
    setCaret,
    draft,
    setDraft,
    focused,
    setFocused,
    highlight,
    setHighlight,
    popupPos,
    wrapRef,
    inputRef,
    matches,
    suggestions,
  };
}

type ClassState = ReturnType<typeof useClassInput>;
function classTokenActions(options: {
  readonly tokens: readonly string[];
  readonly at: number;
  readonly setCaret: Dispatch<SetStateAction<number>>;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly onChange: ClassInputProps['onChange'];
}) {
  const { tokens, at, setCaret, setDraft, onChange } = options;
  const commit = (next: readonly string[]) => {
    const str = next.join(' ');
    onChange(str, true);
  };

  const addToken = (text: string | undefined) => {
    const t = (text ?? '').trim();
    setDraft('');
    if (!t) {
      return;
    }
    if (tokens.includes(t)) {
      setCaret(tokens.indexOf(t) + 1);
      return;
    }
    const next = [...tokens];
    next.splice(at, 0, t); // insert at the caret
    setCaret(at + 1);
    commit(next);
  };

  const removeAt = (i: number) => {
    if (i < 0 || i >= tokens.length) {
      return;
    }
    const next = tokens.filter((_, j) => j !== i);
    setCaret(Math.max(0, i));
    commit(next);
  };

  return { addToken, removeAt };
}
function useClassFamily(tokens: readonly string[], onChange: ClassInputProps['onChange']) {
  // The family menu: which tag was clicked, what it could become, and where
  // to draw the list. It previews like the prop dropdowns do — arrowing or
  // hovering an option applies it to the page, and closing without picking
  // puts the original back.
  const [family, setFamily] = useState<Family | null>(null);
  const [famHighlight, setFamHighlight] = useState(-1);
  const famOriginal = useRef(''); // the class that was there when it opened
  const famPreview = useRef<string | null>(null); // last previewed class, or null
  const famRef = useRef<HTMLDivElement>(null);

  const actions = classFamilyActions({
    tokens,
    onChange,
    family,
    famOriginal,
    famPreview,
    setFamily,
    setFamHighlight,
  });
  const { closeFamily } = actions;
  useEffect(() => {
    if (!family) {
      return undefined;
    }
    const onDown = (e: MouseEvent) => {
      const ElementType = famRef.current?.ownerDocument.defaultView?.Element;
      if (ElementType && e.target instanceof ElementType && e.target.closest('.class-family')) {
        return;
      }
      closeFamily({ revert: true });
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }); // no deps: the handler closes over the current preview refs

  // Keep the arrowed option in view.
  useEffect(() => {
    if (!family || famHighlight < 0) {
      return;
    }
    famRef.current?.children[famHighlight]?.scrollIntoView({ block: 'nearest' });
  }, [family, famHighlight]);

  return {
    ...actions,
    family,
    setFamily,
    famHighlight,
    setFamHighlight,
    famOriginal,
    famPreview,
    famRef,
  };
}
function classFamilyActions(options: {
  readonly tokens: readonly string[];
  readonly onChange: ClassInputProps['onChange'];
  readonly family: Family | null;
  readonly famOriginal: MutableRefObject<string>;
  readonly famPreview: MutableRefObject<string | null>;
  readonly setFamily: Dispatch<SetStateAction<Family | null>>;
  readonly setFamHighlight: Dispatch<SetStateAction<number>>;
}) {
  const { tokens, onChange, family, famOriginal, famPreview, setFamily, setFamHighlight } = options;
  // One class swapped for another at a fixed position. Previews skip the
  // de-duplication: a transient repeat is invisible and never saved, while
  // collapsing the list mid-preview would shift every index under it.
  const closeFamily = ({ revert }: { readonly revert: boolean }) => {
    if (
      revert &&
      family &&
      famPreview.current !== null &&
      famPreview.current !== famOriginal.current
    ) {
      writeClassAt(
        tokens,
        family.index,
        famOriginal.current,
        { immediate: true, dedupe: false },
        onChange,
      );
    }
    famPreview.current = null;
    setFamily(null);
    setFamHighlight(-1);
  };

  const previewFamily = (n: number) => {
    if (!family) {
      return;
    }
    setFamHighlight(n);
    const cls = family.options[n];
    if (!cls) {
      return;
    }
    const applied = famPreview.current ?? famOriginal.current;
    if (cls === applied) {
      return;
    }
    famPreview.current = cls;
    // Immediate, like every other menu that previews on hover (the prop
    // dropdowns): a preview that waits out the typing debounce reads as lag.
    // Successive hovers still collapse into one save — each reschedules the
    // same timer — and into one undo step, which is keyed on the prop.
    writeClassAt(tokens, family.index, cls, { immediate: true, dedupe: false }, onChange);
  };

  const applyFamily = (n: number) => {
    if (!family) {
      return;
    }
    const cls = family.options[n];
    const i = family.index;
    famPreview.current = null;
    setFamily(null);
    setFamHighlight(-1);
    if (cls) {
      writeClassAt(tokens, i, cls, { immediate: true, dedupe: true }, onChange);
    }
  };

  return { closeFamily, previewFamily, applyFamily };
}
function writeClassAt(
  tokens: readonly string[],
  i: number,
  cls: string,
  { immediate, dedupe }: { readonly immediate: boolean; readonly dedupe: boolean },
  onChange: ClassInputProps['onChange'],
): void {
  let next = tokens.map((t, j) => (j === i ? cls : t));
  if (dedupe) {
    next = next.filter((t, j, all) => all.indexOf(t) === j);
  }
  onChange(next.join(' '), immediate);
}
// Everything sharing this class's prefix — the class itself included, so the
// menu says which one is on. Drawn from the project's classes plus the ones
// already on this element, which may not be used anywhere else yet.
function classFamilyOf(cls: string, suggestions: readonly string[], tokens: readonly string[]) {
  const prefix = familyPrefix(cls);
  if (!prefix) {
    return [];
  }
  const pool = new Set([...suggestions, ...tokens]);
  return [...pool].filter((s) => s.startsWith(prefix)).sort(collator.compare);
}
function classMatches(draft: string, suggestions: readonly string[], tokens: readonly string[]) {
  const query = draft.trim().toLowerCase();
  const matches = query
    ? suggestions
        .filter((s) => s.toLowerCase().includes(query) && !tokens.includes(s))
        .sort((a, b) => {
          // Prefix matches first, then shortest.
          const ap = a.toLowerCase().startsWith(query) ? 0 : 1;
          const bp = b.toLowerCase().startsWith(query) ? 0 : 1;
          return ap - bp || a.length - b.length;
        })
        .slice(0, 12)
    : [];

  return matches;
}
function classInputKey(e: React.KeyboardEvent<HTMLInputElement>, state: ClassState): void {
  const {
    draft,
    removeAt,
    at,
    setCaret,
    tokens,
    matches,
    setHighlight,
    highlight,
    addToken,
    setDraft,
    inputRef,
  } = state;
  // While the family menu is up it owns the arrows and Enter: the caret and
  // the suggestion list are both idle behind it.
  if (classFamilyKey(e, state)) {
    return;
  }
  if (e.key === 'Backspace' && !draft) {
    e.preventDefault();
    removeAt(at - 1);
  } else if (e.key === 'Delete' && !draft) {
    e.preventDefault();
    removeAt(at);
  } else if (e.key === 'ArrowLeft' && !draft) {
    e.preventDefault();
    setCaret(Math.max(0, at - 1));
  } else if (e.key === 'ArrowRight' && !draft) {
    e.preventDefault();
    setCaret(Math.min(tokens.length, at + 1));
  } else if (e.key === 'ArrowDown' && matches.length) {
    e.preventDefault();
    setHighlight((h) => Math.min(h + 1, matches.length - 1));
  } else if (e.key === 'ArrowUp' && matches.length) {
    e.preventDefault();
    setHighlight((h) => Math.max(h - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (matches.length) {
      addToken(matches[Math.min(highlight, matches.length - 1)]);
    } else {
      addToken(draft);
    }
  } else if (e.key === ' ') {
    e.preventDefault();
    addToken(draft);
  } else if (e.key === 'Tab' && draft) {
    e.preventDefault();
    addToken(matches.length ? matches[Math.min(highlight, matches.length - 1)] : draft);
  } else if (e.key === 'Escape') {
    setDraft('');
    inputRef.current?.blur();
  }
}
function classFamilyKey(e: React.KeyboardEvent<HTMLInputElement>, state: ClassState): boolean {
  const { family, previewFamily, famHighlight, applyFamily, closeFamily } = state;
  if (family) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      previewFamily(Math.min(famHighlight + 1, family.options.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      previewFamily(Math.max(famHighlight - 1, 0));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyFamily(famHighlight);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFamily({ revert: true });
      return true;
    }
  }
  return false;
}
function ClassCaret({ state }: { readonly state: ClassState }) {
  const { draft, tokens, inputRef, setDraft, setHighlight, setFocused, addToken } = state;
  // While empty the input is just a caret-width sliver, with negative
  // margins swallowing the flex gap on either side so tags don't spread
  // apart around the cursor.
  const emptyAmongTags = !draft && tokens.length > 0;
  return (
    <input
      key="caret"
      ref={inputRef}
      className={`class-input-field ${emptyAmongTags ? 'empty' : ''}`}
      value={draft}
      style={draft ? { width: `${draft.length + 1}ch` } : undefined}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        setHighlight(0);
      }}
      onKeyDown={(event) => classInputKey(event, state)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft.trim()) {
          addToken(draft);
        }
      }}
    />
  );
}
function ClassTokens({ state }: { readonly state: ClassState }) {
  const {
    tokens,
    at,
    family,
    suggestions,
    setCaret,
    inputRef,
    closeFamily,
    famOriginal,
    famPreview,
    setFamHighlight,
    setFamily,
  } = state;
  const inputEl = <ClassCaret key="caret" state={state} />;
  const items: React.ReactNode[] = [];
  tokens.forEach((t, i) => {
    if (i === at) {
      items.push(inputEl);
    }
    items.push(
      <span
        key={`${t}-${i}`}
        className={`class-tag${family?.index === i ? ' open' : ''}`}
        title={
          classFamilyOf(t, suggestions, tokens).length > 1
            ? 'Click to switch to a related class'
            : 'Click to place the caret after this class'
        }
        onMouseDown={(e) => {
          // preventDefault keeps the inline input from blurring.
          e.preventDefault();
          e.stopPropagation();
          setCaret(i + 1);
          inputRef.current?.focus();
          // Clicking the open tag again closes the menu, keeping whatever was
          // there before the preview.
          if (family?.index === i) {
            closeFamily({ revert: true });
            return;
          }
          closeFamily({ revert: true });
          const options = classFamilyOf(t, suggestions, tokens);
          if (options.length < 2) {
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          famOriginal.current = t;
          famPreview.current = null;
          setFamHighlight(options.indexOf(t));
          setFamily({ index: i, options, left: r.left, top: r.bottom + 5 });
        }}
      >
        {t}
      </span>,
    );
  });
  if (at >= tokens.length) {
    items.push(inputEl);
  }

  return items;
}
function ClassSuggestions({ state }: { readonly state: ClassState }) {
  const { popupPos, matches, highlight, setHighlight, addToken } = state;
  if (!popupPos) {
    return null;
  }
  return (
    <div
      className="dd-popup class-suggest"
      style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width }}
    >
      {matches.map((s, i) => (
        <div
          key={s}
          className={`dd-option ${i === highlight ? 'highlight' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setHighlight(i)}
          onClick={() => addToken(s)}
        >
          <span className="dd-option-label">{s}</span>
        </div>
      ))}
    </div>
  );
}
function ClassFamilyMenu({ state }: { readonly state: ClassState }) {
  const { family, famRef, famHighlight, famOriginal, previewFamily, applyFamily } = state;
  if (!family) {
    return null;
  }
  return (
    <div
      ref={famRef}
      className="dd-popup class-family"
      style={{ left: family.left, top: family.top }}
    >
      {family.options.map((s, i) => (
        <div
          key={s}
          className={`dd-option ${i === famHighlight ? 'highlight' : ''} ${
            s === famOriginal.current ? 'selected' : ''
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => previewFamily(i)}
          onClick={() => applyFamily(i)}
        >
          <span className="dd-check">{s === famOriginal.current && <CheckIcon size={12} />}</span>
          <span className="dd-option-label">{s}</span>
        </div>
      ))}
    </div>
  );
}
