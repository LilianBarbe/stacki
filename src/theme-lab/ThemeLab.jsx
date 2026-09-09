// Theme Lab — a floating window over Stacki's own interface for tuning the
// design tokens and seeing, on screen, what each one paints.
//
//   • Rows are read from tokens.css (and the legacy aliases at the top of
//     styles.css) as text: same names, same order, same groups, same comments.
//   • Hovering a row outlines every element whose styles read that variable,
//     directly or through an alias. Expanding a row lists those rules.
//   • Pick mode (crosshair) turns it round: click anything in the app and the
//     panel lists every rule that styles it, in cascade order, with each
//     declaration editable in place and its alias chain unwound to the literal.
//   • Edits apply live — tokens as inline overrides on <html>, rule edits on the
//     live CSSOM rule — survive a reload, and can be written back into the
//     source files from the dev server, or copied.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import tokensRaw from '../style-panel/tokens.css?raw';
import legacyRaw from '../styles.css?raw';
import { parseRootSource } from './tokensSource.js';
import {
  buildIndex,
  consumersOf,
  elementsFor,
  stylesFor,
  describeElement,
  selectorState,
} from './cssIndex.js';
import {
  loadEdits,
  storeEdits,
  applyEdit,
  dropEdit,
  loadRuleEdits,
  storeRuleEdits,
  ruleEditKey,
  applyRuleEdit,
  revertRuleEdit,
  applyRuleEdits,
} from './edits.js';
import './theme-lab.css';

const TOKENS_FILE = 'src/style-panel/tokens.css';
const LEGACY_FILE = 'src/styles.css';
const WINDOW_KEY = 'stacki.themeLab.window';
const CAN_SAVE = !!import.meta.env.DEV;

const COLOR_RE = /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color\(|transparent$|white$|black$)/i;
const NUMBER_RE = /^-?\d*\.?\d+(px|em|rem|%|ms|s|deg)?$/;
const ALIAS_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;

// ---------------------------------------------------------------- helpers

function kindOf(resolved) {
  if (resolved == null) return 'text';
  if (COLOR_RE.test(resolved)) return 'color';
  if (NUMBER_RE.test(resolved)) return 'number';
  return 'text';
}

// #rgb / #rrggbb / #rrggbbaa / rgb(a) → { hex: '#rrggbb', alpha }
function parseColor(value) {
  const v = value.trim();
  let m = v.match(/^#([0-9a-f]{3,4})$/i);
  if (m) {
    const s = m[1];
    const hex = '#' + s.slice(0, 3).split('').map((c) => c + c).join('');
    const alpha = s.length === 4 ? parseInt(s[3] + s[3], 16) / 255 : 1;
    return { hex: hex.toLowerCase(), alpha };
  }
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) return { hex: ('#' + m[1]).toLowerCase(), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    const c = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, '0'));
    let alpha = 1;
    if (m[4] != null) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: '#' + c.join(''), alpha };
  }
  return null;
}

function formatColor(hex, alpha) {
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
}

// Steps the first number in a value (so `6px 12px` and `0 1px 2px` work too).
function stepNumber(value, delta) {
  const m = value.match(/(-?\d*\.?\d+)([a-z%]*)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];
  const fine = unit === 'em' || unit === 'rem' || (unit === '' && !Number.isInteger(n));
  const next = +(n + delta * (fine ? 0.05 : 1)).toFixed(3);
  return value.slice(0, m.index) + `${next}${unit}` + value.slice(m.index + m[0].length);
}

function shortSheet(sheet) {
  return sheet.replace(/^style-panel\//, '').replace(/\.css$/, '');
}

// The Vite dev id is an absolute path; the save endpoint wants it relative to the project.
function projectPath(file) {
  const i = file.indexOf('/src/');
  return i >= 0 ? file.slice(i + 1) : file;
}

function loadWindow() {
  try {
    return JSON.parse(localStorage.getItem(WINDOW_KEY)) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- overlay

// Outlines drawn over the app for a set of elements. Repositioned on scroll and
// resize so they stay glued to what they mark.
function Overlay({ elements, color, label }) {
  const [boxes, setBoxes] = useState([]);
  useEffect(() => {
    if (!elements.length) {
      setBoxes([]);
      return undefined;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const out = [];
      for (const el of elements) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
        out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      setBoxes(out);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const iv = setInterval(schedule, 500);
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [elements]);
  if (!boxes.length) return null;
  return (
    <div className="theme-lab-overlay" data-theme-lab="overlay" style={{ '--tl-outline': color }}>
      {boxes.map((b, i) => (
        <div key={i} className="theme-lab-box" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          {i === 0 && label ? <span className="theme-lab-box-label">{label}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function VarChip({ name, onJump, dim }) {
  return (
    <button type="button" className={`theme-lab-chip${dim ? ' is-dim' : ''}`} onClick={() => onJump(name)} title={`Go to ${name}`}>
      {name}
    </button>
  );
}

function Swatch({ value, kind, onPick }) {
  if (kind !== 'color') return <span className="theme-lab-swatch is-empty" />;
  const parsed = value ? parseColor(value) : null;
  return (
    <label className="theme-lab-swatch" title={value || ''}>
      <span className="theme-lab-swatch-fill" style={{ background: value || 'transparent' }} />
      {parsed ? (
        <input
          type="color"
          value={parsed.hex}
          onChange={(e) => onPick(formatColor(e.target.value, parsed.alpha))}
          aria-label="Pick colour"
        />
      ) : null}
    </label>
  );
}

// A value field: text, ↑↓ steps the first number (⇧ for ×10).
function ValueInput({ value, onChange, onCommit, className, placeholder, autoFocus, ariaLabel }) {
  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      onCommit?.();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const next = stepNumber(value, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    if (next == null) return;
    e.preventDefault();
    onChange(next);
  };
  return (
    <input
      className={className}
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      aria-label={ariaLabel}
    />
  );
}

function Chain({ chain, computed, onJump }) {
  const last = chain[chain.length - 1];
  return (
    <div className="theme-lab-chain">
      {chain.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="theme-lab-arrow">→</span> : null}
          <span className="theme-lab-chain-step" title={`${step.selector}${step.sheet ? ' · ' + step.sheet : ''}`}>
            <VarChip name={step.name} onJump={onJump} />
            {step.selector && step.selector !== ':root' ? <span className="theme-lab-chain-scope">{step.selector}</span> : null}
          </span>
        </React.Fragment>
      ))}
      <span className="theme-lab-arrow">→</span>
      <code className="theme-lab-literal">{last?.value != null && !/var\(/.test(last.value) ? last.value : computed || 'undefined'}</code>
    </div>
  );
}

// ---------------------------------------------------------------- token rows

function TokenRow({
  v,
  edited,
  resolved,
  chain,
  count,
  consumers,
  expanded,
  pinned,
  flash,
  onChange,
  onReset,
  onHover,
  onPin,
  onToggle,
  onJump,
  onHoverRule,
}) {
  const current = edited ?? v.value;
  const kind = kindOf(resolved);
  return (
    <div
      className={`theme-lab-row${edited != null ? ' is-edited' : ''}${pinned ? ' is-pinned' : ''}${flash ? ' is-flash' : ''}${expanded ? ' is-open' : ''}`}
      data-var={v.name}
      onMouseEnter={() => onHover(v.name)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="theme-lab-row-main">
        <Swatch value={resolved} kind={kind} onPick={onChange} />
        <button type="button" className="theme-lab-name" onClick={onToggle} title={v.doc || v.name}>
          <span className="theme-lab-name-text">{v.name}</span>
          <span className="theme-lab-count" title={`${count} rule${count === 1 ? '' : 's'} read this`}>
            {count}
          </span>
        </button>
        <ValueInput className="theme-lab-value" value={current} onChange={onChange} ariaLabel={`Value of ${v.name}`} />
        <button type="button" className="theme-lab-icon" disabled={edited == null} onClick={onReset} title="Reset to the file's value">
          ↺
        </button>
        <button type="button" className={`theme-lab-icon${pinned ? ' is-on' : ''}`} onClick={onPin} title="Keep the highlight on screen">
          ◎
        </button>
      </div>
      {chain.length > 1 || resolved == null ? (
        <div className="theme-lab-row-sub">
          {chain.slice(1).map((step) => (
            <React.Fragment key={step.name}>
              <span className="theme-lab-arrow">→</span>
              <VarChip name={step.name} onJump={onJump} />
            </React.Fragment>
          ))}
          <span className="theme-lab-arrow">→</span>
          <code className={`theme-lab-literal${resolved == null ? ' is-missing' : ''}`}>{resolved ?? 'undefined'}</code>
        </div>
      ) : null}
      {expanded ? (
        <div className="theme-lab-usages">
          {v.doc ? <p className="theme-lab-doc">{v.doc}</p> : null}
          {consumers.length === 0 ? <p className="theme-lab-empty">No rule reads this variable.</p> : null}
          {consumers.map((c, i) => (
            <div
              key={i}
              className="theme-lab-usage"
              onMouseEnter={() => onHoverRule(c)}
              onMouseLeave={() => onHoverRule(null)}
            >
              <span className="theme-lab-usage-sel" title={c.rule.selector}>
                {c.rule.selector}
              </span>
              <span className="theme-lab-usage-prop">
                {c.prop}
                {c.via ? (
                  <>
                    {' '}
                    via <VarChip name={c.via} onJump={onJump} dim />
                  </>
                ) : null}
              </span>
              <span className="theme-lab-usage-sheet">{shortSheet(c.rule.sheet)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- inspector

// One rule that styles the picked element: its selector, and every declaration
// as an editable line. Edits land on the live CSSOM rule at once.
function RuleCard({ item, ruleEdits, onEditRule, onJump, onHoverRule }) {
  const { rule, decls, from } = item;
  const [adding, setAdding] = useState(false);
  const [newProp, setNewProp] = useState('');
  const [newValue, setNewValue] = useState('');
  const state = selectorState(rule.selector);
  const editFor = (prop) => ruleEdits[ruleEditKey({ file: rule.file, selector: rule.selector, ordinal: rule.ordinal, prop })];

  // Declarations added through the panel and not yet saved show up here too.
  const added = Object.values(ruleEdits).filter(
    (e) => e.file === rule.file && e.selector === rule.selector && e.ordinal === rule.ordinal && e.old == null && !decls.some((d) => d.prop === e.prop)
  );
  const lines = [...decls.map((d) => ({ ...d, edit: editFor(d.prop) })), ...added.map((e) => ({ prop: e.prop, value: e.value, refs: [], chains: [], edit: e, isNew: true }))];

  const commitNew = () => {
    const prop = newProp.trim().toLowerCase();
    const value = newValue.trim();
    if (!prop || !value) return;
    onEditRule(rule, prop, value, null);
    setNewProp('');
    setNewValue('');
    setAdding(false);
  };

  return (
    <div className={`theme-lab-rule${state ? ' has-state' : ''}`} onMouseEnter={() => onHoverRule({ rule, prop: '' })} onMouseLeave={() => onHoverRule(null)}>
      <div className="theme-lab-rule-head">
        <span className="theme-lab-rule-sel" title={rule.selector}>
          {rule.selector}
        </span>
        {state ? <span className="theme-lab-rule-state">{state}</span> : null}
        <span className="theme-lab-rule-sheet" title={rule.file}>
          {from ? `${describeElement(from)} · ` : ''}
          {shortSheet(rule.sheet)}
        </span>
      </div>
      {lines.map((d) => {
        const current = d.edit ? d.edit.value : d.value;
        const removed = d.edit && d.edit.value === '';
        return (
          <div key={d.prop} className={`theme-lab-decl${d.edit ? ' is-edited' : ''}${removed ? ' is-removed' : ''}${d.isNew ? ' is-new' : ''}`}>
            <div className="theme-lab-decl-line">
              <Swatch value={d.chains?.[0]?.computed || (kindOf(current) === 'color' ? current : null)} kind={kindOf(d.chains?.[0]?.computed || current)} onPick={(val) => onEditRule(rule, d.prop, val, d.isNew ? null : d.value)} />
              <span className="theme-lab-decl-prop" title={d.important ? '!important' : ''}>
                {d.prop}
                {d.important ? <span className="theme-lab-decl-important">!</span> : null}
              </span>
              <ValueInput
                className="theme-lab-decl-input"
                value={current}
                placeholder={removed ? '(removed)' : ''}
                onChange={(val) => onEditRule(rule, d.prop, val, d.isNew ? null : d.value)}
                ariaLabel={`${rule.selector} ${d.prop}`}
              />
              <button
                type="button"
                className="theme-lab-icon"
                disabled={!d.edit}
                onClick={() => onEditRule(rule, d.prop, null, d.isNew ? null : d.value)}
                title="Reset to the file's value"
              >
                ↺
              </button>
            </div>
            {d.chains?.map((c) => (
              <Chain key={c.ref} chain={c.chain} computed={c.computed} onJump={onJump} />
            ))}
          </div>
        );
      })}
      {adding ? (
        <div className="theme-lab-decl is-new">
          <div className="theme-lab-decl-line">
            <span className="theme-lab-swatch is-empty" />
            <input
              className="theme-lab-decl-newprop"
              value={newProp}
              placeholder="property"
              spellCheck={false}
              autoFocus
              onChange={(e) => setNewProp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false);
              }}
              aria-label="New property"
            />
            <ValueInput className="theme-lab-decl-input" value={newValue} placeholder="value" onChange={setNewValue} onCommit={commitNew} ariaLabel="New value" />
            <button type="button" className="theme-lab-icon" onClick={commitNew} title="Add (Enter)">
              ✓
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="theme-lab-rule-add" onClick={() => setAdding(true)}>
          + property
        </button>
      )}
    </div>
  );
}

function Inspector({ picked, ruleEdits, onEditRule, onJump, onClose, onPickParent, onHoverRule }) {
  const { el, report } = picked;
  const ancestors = [];
  for (let n = el.parentElement, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++) ancestors.push(n);
  const cards = (list) => list.map((item, i) => <RuleCard key={i} item={item} ruleEdits={ruleEdits} onEditRule={onEditRule} onJump={onJump} onHoverRule={onHoverRule} />);
  return (
    <div className="theme-lab-inspect">
      <div className="theme-lab-inspect-head">
        <span className="theme-lab-inspect-el">{describeElement(el)}</span>
        <span className="theme-lab-spacer" />
        <button type="button" className="theme-lab-icon" onClick={onClose} title="Clear">
          ×
        </button>
      </div>
      {ancestors.length ? (
        <div className="theme-lab-crumbs">
          {ancestors.map((n, i) => (
            <button key={i} type="button" className="theme-lab-crumb" onClick={() => onPickParent(n)} title="Inspect this ancestor">
              {describeElement(n)}
            </button>
          ))}
        </div>
      ) : null}
      {report.own.length === 0 ? <p className="theme-lab-empty">No stylesheet rule matches this element — try an ancestor.</p> : null}
      {cards(report.own)}
      {report.inherited.length ? (
        <>
          <div className="theme-lab-inspect-title">Inherited</div>
          {cards(report.inherited)}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- panel

export default function ThemeLab({ onClose }) {
  const groups = useMemo(() => {
    const tokens = parseRootSource(tokensRaw, TOKENS_FILE, 'Tokens');
    const legacy = parseRootSource(legacyRaw, LEGACY_FILE, 'Legacy aliases (styles.css)').map((g) => ({
      ...g,
      title: g.title === 'General' ? 'Legacy aliases (styles.css)' : g.title,
      legacy: true,
    }));
    return [...tokens, ...legacy];
  }, []);
  const sourceMap = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const v of g.vars) m.set(v.name, v);
    return m;
  }, [groups]);

  const [edits, setEdits] = useState(loadEdits);
  const [ruleEdits, setRuleEdits] = useState(loadRuleEdits);
  const [index, setIndex] = useState(() => buildIndex());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set(groups.slice(0, 1).map((g) => g.title)));
  const [expanded, setExpanded] = useState(null);
  const [hoverVar, setHoverVar] = useState(null);
  const [hoverRule, setHoverRule] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [flash, setFlash] = useState(null);
  const [picking, setPicking] = useState(false);
  const [hoverEl, setHoverEl] = useState(null);
  const [picked, setPicked] = useState(null);
  const [status, setStatus] = useState('');
  const [win, setWin] = useState(() => loadWindow() || { x: window.innerWidth - 500, y: 56, w: 480, h: Math.round(window.innerHeight * 0.75) });
  const rootRef = useRef(null);

  // Rule edits still pending go back onto the live rules whenever the sheets
  // are (re-)indexed — after a reload, or after Vite swapped a stylesheet.
  useEffect(() => {
    applyRuleEdits(index, ruleEdits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const reindex = useCallback(() => {
    const next = buildIndex();
    setIndex(next);
    setPicked((p) => (p ? { el: p.el, report: stylesFor(next, p.el) } : p));
  }, []);

  // Resolve a name through edits + source down to its literal.
  const resolve = useCallback(
    (name) => {
      const chain = [];
      let cur = name;
      for (let guard = 0; cur && guard < 12; guard++) {
        const v = edits[cur] ?? sourceMap.get(cur)?.value ?? null;
        if (v == null) return { resolved: null, chain };
        chain.push({ name: cur, value: v });
        const m = v.match(ALIAS_RE);
        if (!m) return { resolved: v, chain };
        cur = m[1];
      }
      return { resolved: null, chain };
    },
    [edits, sourceMap]
  );

  const consumersCache = useMemo(() => new Map(), [index]);
  const consumers = useCallback(
    (name) => {
      if (!consumersCache.has(name)) consumersCache.set(name, consumersOf(index, name));
      return consumersCache.get(name);
    },
    [index, consumersCache]
  );

  // ---- token edits
  const change = (name, value) => {
    setEdits((prev) => {
      const next = { ...prev, [name]: value };
      storeEdits(next);
      return next;
    });
    applyEdit(name, value);
  };
  const reset = (name) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[name];
      storeEdits(next);
      return next;
    });
    dropEdit(name);
  };

  // ---- rule edits: value null resets, '' removes the declaration
  const editRule = (rule, prop, value, old) => {
    const base = { file: rule.file, selector: rule.selector, ordinal: rule.ordinal, prop };
    const key = ruleEditKey(base);
    setRuleEdits((prev) => {
      const next = { ...prev };
      if (value == null) {
        if (next[key]) revertRuleEdit(index, next[key]);
        delete next[key];
      } else {
        const entry = { ...base, value, old: prev[key]?.old ?? old, important: rule.decls.find((d) => d.prop === prop)?.important || false };
        next[key] = entry;
        applyRuleEdit(index, entry);
      }
      storeRuleEdits(next);
      return next;
    });
    // The picked report holds the old values; refresh it so chains follow.
    setPicked((p) => (p ? { el: p.el, report: stylesFor(index, p.el) } : p));
  };

  const editCount = Object.keys(edits).length + Object.keys(ruleEdits).length;

  const resetAll = () => {
    for (const name of Object.keys(edits)) dropEdit(name);
    for (const e of Object.values(ruleEdits)) revertRuleEdit(index, e);
    setEdits({});
    setRuleEdits({});
    storeEdits({});
    storeRuleEdits({});
    setPicked((p) => (p ? { el: p.el, report: stylesFor(index, p.el) } : p));
    setStatus('All edits reset');
  };
  const cssText = () => {
    const chunks = [];
    const byFile = {};
    for (const [name, value] of Object.entries(edits)) {
      const file = sourceMap.get(name)?.file || 'unknown';
      (byFile[file] ||= []).push(`  ${name}: ${value};`);
    }
    for (const [file, lines] of Object.entries(byFile)) chunks.push(`/* ${file} */\n:root {\n${lines.join('\n')}\n}`);
    const byRule = {};
    for (const e of Object.values(ruleEdits)) {
      const key = `${projectPath(e.file)}\n${e.selector}`;
      (byRule[key] ||= []).push(e.value === '' ? `  /* ${e.prop}: removed */` : `  ${e.prop}: ${e.value}${e.important ? ' !important' : ''};`);
    }
    for (const [key, lines] of Object.entries(byRule)) {
      const [file, selector] = key.split('\n');
      chunks.push(`/* ${file} */\n${selector} {\n${lines.join('\n')}\n}`);
    }
    return chunks.join('\n\n');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cssText());
      setStatus('CSS copied');
    } catch {
      setStatus('Could not copy');
    }
  };
  const save = async () => {
    setStatus('Saving…');
    const post = async (url, body) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'save failed');
      return json;
    };
    try {
      const missing = [];
      if (Object.keys(edits).length) {
        const files = {};
        for (const [name, value] of Object.entries(edits)) {
          const file = sourceMap.get(name)?.file;
          if (file) (files[file] ||= {})[name] = value;
        }
        missing.push(...((await post('/__theme-lab/save', { files })).missing || []));
      }
      if (Object.keys(ruleEdits).length) {
        const list = Object.values(ruleEdits).map((e) => ({ file: projectPath(e.file), selector: e.selector, ordinal: e.ordinal, prop: e.prop, value: e.value }));
        missing.push(...((await post('/__theme-lab/save-rules', { edits: list })).missing || []));
      }
      // The files now carry the values; the sheets catch up through HMR a beat
      // later, so the live overrides go once that has landed.
      setTimeout(() => {
        for (const name of Object.keys(edits)) dropEdit(name);
        setEdits({});
        setRuleEdits({});
        storeEdits({});
        storeRuleEdits({});
        reindex();
      }, 700);
      setStatus(missing.length ? `Saved; not found in file: ${missing.join(', ')}` : 'Saved to file');
    } catch (e) {
      setStatus(`Save failed: ${e.message}`);
    }
  };

  // ---- navigation
  const jumpTo = useCallback(
    (name) => {
      const src = sourceMap.get(name);
      if (!src) {
        setStatus(`${name} is not defined in a token file`);
        return;
      }
      const group = groups.find((g) => g.vars.includes(src));
      setQuery('');
      setOpen((prev) => new Set([...prev, group.title]));
      setFlash(name);
      setTimeout(() => {
        rootRef.current?.querySelector(`[data-var="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'center' });
      }, 0);
      setTimeout(() => setFlash((f) => (f === name ? null : f)), 1400);
    },
    [groups, sourceMap]
  );

  // ---- highlight targets
  const highlightVar = hoverVar || pinned;
  const highlighted = useMemo(() => {
    if (hoverRule) return elementsFor([hoverRule]);
    if (!highlightVar) return [];
    return elementsFor(consumers(highlightVar));
  }, [hoverRule, highlightVar, consumers]);
  const highlightLabel = hoverRule ? `${hoverRule.rule.selector}${hoverRule.prop ? ' · ' + hoverRule.prop : ''}` : highlightVar ? `${highlightVar} · ${highlighted.length}` : '';

  // ---- pick mode
  const pickElement = useCallback((el) => setPicked({ el, report: stylesFor(index, el) }), [index]);
  useEffect(() => {
    if (!picking) return undefined;
    const under = (e) => {
      // A synthetic click (keyboard, accessibility) carries no coordinates;
      // its target is the element itself.
      const el = e.clientX || e.clientY ? document.elementFromPoint(e.clientX, e.clientY) : e.target;
      if (!el || !(el instanceof Element) || el.closest('[data-theme-lab]')) return null;
      return el;
    };
    const onMove = (e) => setHoverEl(under(e));
    const onClick = (e) => {
      const el = under(e);
      e.preventDefault();
      e.stopPropagation();
      if (!el) return;
      pickElement(el);
      setPicking(false);
      setHoverEl(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPicking(false);
        setHoverEl(null);
      }
    };
    const stop = (e) => {
      if (!e.target.closest?.('[data-theme-lab]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', stop, true);
    document.addEventListener('mouseup', stop, true);
    document.addEventListener('keydown', onKey, true);
    document.documentElement.classList.add('theme-lab-picking');
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', stop, true);
      document.removeEventListener('mouseup', stop, true);
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.classList.remove('theme-lab-picking');
    };
  }, [picking, pickElement]);

  // ---- window drag + size persistence
  const dragStart = (e) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    const startX = e.clientX - win.x;
    const startY = e.clientY - win.y;
    const move = (ev) => setWin((w) => ({ ...w, x: Math.max(0, ev.clientX - startX), y: Math.max(0, ev.clientY - startY) }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setWin((w) => (Math.abs(w.w - r.width) < 1 && Math.abs(w.h - r.height) < 1 ? w : { ...w, w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(WINDOW_KEY, JSON.stringify(win));
    } catch {
      /* ignore */
    }
  }, [win]);

  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setStatus(''), 4000);
    return () => clearTimeout(t);
  }, [status]);

  // ---- filtering
  const q = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((g) => ({ ...g, vars: q ? g.vars.filter((v) => v.name.includes(q) || v.value.toLowerCase().includes(q) || v.doc.toLowerCase().includes(q)) : g.vars }))
    .filter((g) => g.vars.length);
  const editedTokens = Object.keys(edits)
    .map((name) => sourceMap.get(name))
    .filter(Boolean);
  const editedRules = Object.values(ruleEdits);

  return (
    <>
      <Overlay elements={highlighted} color={hoverRule ? 'var(--color-warning, #fbbf24)' : 'var(--color-selection-bg, #0c8ce9)'} label={highlightLabel} />
      {picking && hoverEl ? <Overlay elements={[hoverEl]} color="var(--color-success, #4ade80)" label={describeElement(hoverEl)} /> : null}
      {!picking && picked ? <Overlay elements={[picked.el]} color="var(--color-success, #4ade80)" label={describeElement(picked.el)} /> : null}
      <div
        ref={rootRef}
        className="theme-lab"
        data-theme-lab="panel"
        style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !picking) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="theme-lab-head" onPointerDown={dragStart}>
          <span className="theme-lab-title">Theme Lab</span>
          <button
            type="button"
            className={`theme-lab-tool${picking ? ' is-on' : ''}`}
            onClick={() => {
              setPicking((p) => !p);
              setHoverEl(null);
            }}
            title="Pick an element in the app to see and edit the rules that style it (Esc to cancel)"
          >
            ⌖ Pick
          </button>
          <button
            type="button"
            className="theme-lab-tool"
            onClick={() => {
              reindex();
              setStatus('Stylesheets re-indexed');
            }}
            title="Re-read the stylesheets"
          >
            ↻
          </button>
          <span className="theme-lab-spacer" />
          <button type="button" className="theme-lab-icon" onClick={onClose} title="Close (⇧⌘T)">
            ×
          </button>
        </div>

        <div className="theme-lab-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter variables…" spellCheck={false} />
          {query ? (
            <button type="button" className="theme-lab-icon" onClick={() => setQuery('')} title="Clear">
              ×
            </button>
          ) : null}
        </div>

        <div className="theme-lab-list">
          {picked ? (
            <Inspector
              picked={picked}
              ruleEdits={ruleEdits}
              onEditRule={editRule}
              onJump={jumpTo}
              onClose={() => setPicked(null)}
              onPickParent={pickElement}
              onHoverRule={setHoverRule}
            />
          ) : null}

          {editCount ? (
            <div className="theme-lab-group is-open">
              <button type="button" className="theme-lab-group-head" onClick={() => setOpen((s) => toggle(s, '__edits'))}>
                <span className="theme-lab-caret">{open.has('__edits') ? '▾' : '▸'}</span>
                Unsaved changes
                <span className="theme-lab-badge">{editCount}</span>
              </button>
              {open.has('__edits') ? (
                <div className="theme-lab-group-body">
                  {editedTokens.map((v) => (
                    <div key={v.name} className="theme-lab-change">
                      <VarChip name={v.name} onJump={jumpTo} />
                      <code className="theme-lab-literal is-old">{v.value}</code>
                      <span className="theme-lab-arrow">→</span>
                      <code className="theme-lab-literal">{edits[v.name]}</code>
                      <span className="theme-lab-spacer" />
                      <button type="button" className="theme-lab-icon" onClick={() => reset(v.name)} title="Reset">
                        ↺
                      </button>
                    </div>
                  ))}
                  {editedRules.map((e) => (
                    <div key={ruleEditKey(e)} className="theme-lab-change">
                      <span className="theme-lab-change-sel" title={`${projectPath(e.file)} · ${e.selector}`}>
                        {e.selector}
                      </span>
                      <span className="theme-lab-change-prop">{e.prop}</span>
                      {e.old != null ? <code className="theme-lab-literal is-old">{e.old}</code> : null}
                      <span className="theme-lab-arrow">→</span>
                      <code className="theme-lab-literal">{e.value === '' ? '(removed)' : e.value}</code>
                      <span className="theme-lab-spacer" />
                      <button type="button" className="theme-lab-icon" onClick={() => editRule({ file: e.file, selector: e.selector, ordinal: e.ordinal, decls: [] }, e.prop, null, e.old)} title="Reset">
                        ↺
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {visibleGroups.map((g) => {
            const isOpen = q ? true : open.has(g.title);
            return (
              <div key={g.title} className={`theme-lab-group${isOpen ? ' is-open' : ''}${g.legacy ? ' is-legacy' : ''}`}>
                <button type="button" className="theme-lab-group-head" onClick={() => setOpen((s) => toggle(s, g.title))}>
                  <span className="theme-lab-caret">{isOpen ? '▾' : '▸'}</span>
                  {g.title}
                  <span className="theme-lab-group-count">{g.vars.length}</span>
                </button>
                {isOpen ? (
                  <div className="theme-lab-group-body">
                    {g.vars.map((v) => {
                      const { resolved, chain } = resolve(v.name);
                      return (
                        <TokenRow
                          key={v.name}
                          v={v}
                          edited={edits[v.name]}
                          resolved={resolved}
                          chain={chain}
                          count={consumers(v.name).length}
                          consumers={expanded === v.name ? consumers(v.name) : []}
                          expanded={expanded === v.name}
                          pinned={pinned === v.name}
                          flash={flash === v.name}
                          onChange={(val) => change(v.name, val)}
                          onReset={() => reset(v.name)}
                          onHover={setHoverVar}
                          onPin={() => setPinned((p) => (p === v.name ? null : v.name))}
                          onToggle={() => setExpanded((x) => (x === v.name ? null : v.name))}
                          onJump={jumpTo}
                          onHoverRule={setHoverRule}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="theme-lab-foot">
          <span className="theme-lab-status">{status || (editCount ? `${editCount} unsaved` : 'Hover a row to see what it paints · Pick to edit an element')}</span>
          <span className="theme-lab-spacer" />
          <button type="button" className="theme-lab-tool" disabled={!editCount} onClick={resetAll} title="Drop every unsaved edit">
            Reset all
          </button>
          <button type="button" className="theme-lab-tool" disabled={!editCount} onClick={copy} title="Copy the edits as CSS">
            Copy CSS
          </button>
          {CAN_SAVE ? (
            <button type="button" className="theme-lab-tool is-primary" disabled={!editCount} onClick={save} title="Write the edits into the source files">
              Save to file
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function toggle(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
