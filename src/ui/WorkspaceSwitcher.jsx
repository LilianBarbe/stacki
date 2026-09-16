import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BranchIcon, CheckIcon, ChevronDownIcon } from './Icons.jsx';
import useDismiss from './useDismiss.js';
import { cleanError } from '../cleanError.js';

const DEPENDENCY_LABELS = {
  ready: 'Dependencies ready',
  missing: 'Setup needed',
  queued: 'Preparation queued…',
  installing: 'Preparing in background…',
  failed: 'Preparation failed',
};

export default function WorkspaceSwitcher({ project, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const selecting = useRef(false);
  const preparing = useRef(new Set());
  const dismiss = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, dismiss);

  const updateDependencies = useCallback((projectPath, dependencies) => {
    setWorkspaces((rows) => rows.map((w) => w.projectPath === projectPath ? { ...w, dependencies } : w));
  }, []);

  useEffect(() => window.avb.onDependencyState?.(({ projectPath, ...dependencies }) => {
    updateDependencies(projectPath, dependencies);
  }), [updateDependencies]);

  const prepare = async (workspace) => {
    if (preparing.current.has(workspace.projectPath)) return;
    preparing.current.add(workspace.projectPath);
    updateDependencies(workspace.projectPath, { state: 'queued' });
    try {
      const dependencies = await window.avb.prepareWorkspace({
        projectPath: project.path,
        targetPath: workspace.projectPath,
      });
      updateDependencies(workspace.projectPath, dependencies);
    } catch (err) {
      updateDependencies(workspace.projectPath, { state: 'failed', error: cleanError(err) });
    } finally {
      preparing.current.delete(workspace.projectPath);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.avb.gitWorktrees({ projectPath: project.path })
      .then((rows) => { if (!cancelled) setWorkspaces(rows || []); })
      .catch((err) => { if (!cancelled) setError(cleanError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, project.path, revision]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const refresh = () => setRevision((n) => n + 1);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('focus', refresh);
    };
  }, [open]);

  const choose = async (workspace) => {
    if (selecting.current || !workspace.available) return;
    if (workspace.current) { dismiss(); return; }
    selecting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSelect(workspace.projectPath);
      dismiss();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      selecting.current = false;
      setBusy(false);
    }
  };

  const search = query.trim().toLowerCase();
  const filtered = workspaces.filter((w) =>
    [w.name, w.branch, w.path].some((s) => s?.toLowerCase().includes(search))
  );
  const navigate = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const buttons = [...wrapRef.current.querySelectorAll('.workspace-option:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Enter') {
      if (event.target.tagName === 'INPUT') { event.preventDefault(); buttons[0].click(); }
      return;
    }
    event.preventDefault();
    const next = index < 0
      ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div className="workspace-switcher" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="workspace-trigger"
        title={`${project.path}\nSwitch Git workspace`}
        aria-label={`Switch Git workspace: ${project.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={busy}
        onClick={() => { setQuery(''); setOpen((value) => !value); }}
      >
        <BranchIcon size={13} />
        <span>{busy ? 'Switching…' : project.name}</span>
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <div className="workspace-menu" role="dialog" aria-label="Git workspaces" aria-busy={loading || busy} onKeyDown={navigate}>
          <div className="workspace-heading">
            <strong>Git workspaces</strong>
            <button className="ghost" disabled={loading || busy} onClick={() => setRevision((n) => n + 1)}>Refresh</button>
          </div>
          <input
            autoFocus
            type="search"
            aria-label="Search workspaces"
            placeholder="Search workspaces…"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
          {error && <div className="workspace-message error-text" role="alert">{error}</div>}
          <div className="workspace-list">
            {loading ? <p className="workspace-message" role="status">Loading workspaces…</p> : filtered.map((w) => (
              <div className="workspace-row" key={w.path}>
              <button
                className={`workspace-option ${w.current ? 'current' : ''}`}
                aria-current={w.current ? 'true' : undefined}
                title={w.projectPath}
                disabled={busy || !w.available}
                onClick={() => choose(w)}
              >
                <BranchIcon size={14} />
                <span className="workspace-detail">
                  <span className="workspace-name">{w.name}</span>
                  <span>{w.branch || `Detached · ${w.head?.slice(0, 7) || 'HEAD'}`}</span>
                  <span className="workspace-path">{w.projectPath}</span>
                  {w.preview && <span className="workspace-setup-status" title={w.preview.url || undefined}>
                    {w.preview.state === 'running' ? `Preview running · ${w.preview.url}` : 'Starting preview…'}
                  </span>}
                  {w.available && w.dependencies && (
                    <span className="workspace-setup-status" role="status">{DEPENDENCY_LABELS[w.dependencies.state]}</span>
                  )}
                  {w.dependencies?.error && <span className="workspace-setup-error">{w.dependencies.error}</span>}
                  {!w.available && <span>Project unavailable</span>}
                </span>
                {w.current && <CheckIcon size={13} />}
              </button>
              {!w.current && w.available && ['missing', 'failed'].includes(w.dependencies?.state) && (
                <button
                  className="workspace-prepare ghost"
                  aria-label={`Prepare ${w.name} in background`}
                  title="Install dependencies in background while you keep working"
                  disabled={busy}
                  onClick={() => prepare(w)}
                >{w.dependencies.state === 'failed' ? 'Retry' : 'Prepare'}</button>
              )}
              </div>
            ))}
            {!loading && !error && !filtered.length && (
              <p className="workspace-message">{workspaces.length ? 'No matching workspaces.' : 'No Git workspaces found for this project.'}</p>
            )}
          </div>
          <p className="workspace-note">Prepare installs dependencies ahead of time. Once opened, each workspace keeps its own preview running on a separate address. Switching saves the current page and reconnects to that preview.</p>
        </div>
      )}
    </div>
  );
}
