// Theme Lab — the unsaved overrides. They live as inline custom properties on
// <html> (which beats every `:root` rule) and in localStorage, so a reload keeps
// what is being tried until it is written to the file or reset.

const KEY = 'stacki.themeLab.edits';

export function loadEdits() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function storeEdits(edits) {
  try {
    if (Object.keys(edits).length) localStorage.setItem(KEY, JSON.stringify(edits));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the inline overrides still work for this session */
  }
}

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
