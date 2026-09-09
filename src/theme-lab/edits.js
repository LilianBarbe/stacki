// Theme Lab — the unsaved overrides.
//
// Token edits live as inline custom properties on <html> (which beats every
// `:root` rule) and in localStorage, so a reload keeps what is being tried
// until it is written to the file or reset.
//
// Rule edits (a declaration changed on one rule of one sheet) are applied to
// the live CSSOM rule and remembered by file + selector + ordinal; they are put
// back whenever the stylesheets are re-indexed.

const KEY = 'stacki.themeLab.edits';
const RULES_KEY = 'stacki.themeLab.ruleEdits';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(key, obj) {
  try {
    if (Object.keys(obj).length) localStorage.setItem(key, JSON.stringify(obj));
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — the live overrides still work for this session */
  }
}

// ---- tokens

export const loadEdits = () => read(KEY);
export const storeEdits = (edits) => write(KEY, edits);

export function applyEdit(name, value) {
  document.documentElement.style.setProperty(name, value);
}

export function dropEdit(name) {
  document.documentElement.style.removeProperty(name);
}

export function applyEdits(edits) {
  for (const [name, value] of Object.entries(edits)) applyEdit(name, value);
}

// Called once at startup so the overrides are in place before first paint.
export function restoreSavedEdits() {
  applyEdits(loadEdits());
}

// ---- rules

export const loadRuleEdits = () => read(RULES_KEY);
export const storeRuleEdits = (edits) => write(RULES_KEY, edits);

export const ruleEditKey = (e) => `${e.file}\n${e.selector}\n${e.ordinal}\n${e.prop}`;

// The live rule for an edit, in the current index — null once the sheet has
// been replaced and not yet re-indexed.
export function findRule(index, e) {
  return index.rules.find((r) => r.file === e.file && r.selector === e.selector && r.ordinal === e.ordinal) || null;
}

// Puts a declaration on a live rule; an empty value removes it.
export function applyRuleEdit(index, e) {
  const entry = findRule(index, e);
  if (!entry) return false;
  if (e.value === '') entry.rule.style.removeProperty(e.prop);
  else entry.rule.style.setProperty(e.prop, e.value, e.important ? 'important' : '');
  return true;
}

// Restores the value the rule had before the edit (or removes an added one).
export function revertRuleEdit(index, e) {
  const entry = findRule(index, e);
  if (!entry) return false;
  if (e.old == null) entry.rule.style.removeProperty(e.prop);
  else entry.rule.style.setProperty(e.prop, e.old, e.important ? 'important' : '');
  return true;
}

export function applyRuleEdits(index, edits) {
  for (const e of Object.values(edits)) applyRuleEdit(index, e);
}
