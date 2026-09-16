import MergeConflictModal from './MergeConflictModal';
import SwitchBranchModal from './SwitchBranchModal';
import {repoSlug, webUrl, useGitHubStatus} from './gitPublish';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cleanError } from '../cleanError.js';
import { BranchIcon, CheckIcon, ExternalIcon, CloseIcon, MergeIcon, TrashIcon } from '../ui/Icons.jsx';
import { branchNameError, sanitizeBranchName } from '../branchName.js';
import { mergeBranchAction, deleteBranchAction, tidyUp } from '../gitActions.js';
import Code from '../ui/Code.jsx';
import FileBrowser from '../ui/FileBrowser.jsx';
import BranchActions from '../ui/BranchActions.jsx';
import useDismiss from '../ui/useDismiss.js';

// Branch/status chip in the title bar. Opens a dropdown with branch
// switching, branch creation, commit + push, and GitHub publishing.
export default function GitChip({ project, showToast, flushSave, onWorktreeChanged }) {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [error, setError] = useState(null);
  // Label of the action in flight, or null. Doubles as the busy flag so the
  // chip itself can say what it's doing while the dropdown is closed.
  const [busy, setBusy] = useState(null);
  const working = busy !== null;
  const [showPublish, setShowPublish] = useState(false);
  const [switchTo, setSwitchTo] = useState(null); // branch awaiting a dirty-tree decision
  const [conflict, setConflict] = useState(null); // {branch, from, files:[{path,ours,theirs}]}
  // Which files this commit will include. `null` means "all of them", which is
  // what the button has always done — the list only appears once someone opens
  // it, so the common case is unchanged and picking is a thing you go and do.
  const [picked, setPicked] = useState(null);
  const [changed, setChanged] = useState([]);
  const [picking, setPicking] = useState(false);
  const wrapRef = useRef(null);

  const refresh = async () => {
    const result = await window.avb.gitInfo(project.path);
    setInfo(result);
    return result;
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [project.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closes on a click anywhere else — including into the canvas, which is an
  // iframe and so raises its clicks in a document this one never hears. See
  // useDismiss.
  useDismiss(
    wrapRef,
    open,
    useCallback(() => setOpen(false), [])
  );

  // The full list, not the capped summary git:info carries for the chip: a
  // file missing from this list is a file that silently cannot be saved.
  useEffect(() => {
    if (!picking || !open) {return;}
    window.avb
      .gitStatus({ projectPath: project.path })
      .then((f) => {
        setChanged(f || []);
        // Everything ticked to begin with, so opening the list and pressing
        // save does what pressing save without opening it would have done.
        setPicked((cur) => (cur === null ? (f || []).map((x) => x.path) : cur));
      })
      .catch(() => setChanged([]));
  }, [picking, open, project.path, info?.dirty, info?.head]);

  const act = async (fn, successMsg, label = 'Working…') => {
    setBusy(label);
    setError(null);
    try {
      await flushSave();
      await fn();
      await refresh();
      // Checkout/pull rewrite the working tree — re-read what's open so the
      // editor and preview show the branch that's actually checked out.
      if (onWorktreeChanged) {await onWorktreeChanged();}
      if (successMsg) {showToast(successMsg, 'success');}
    } catch (err) {
      const msg = cleanError(err);
      // A failed branch switch leaves you on the branch you were already on,
      // so this has to stay on screen — a toast that fades is how edits end
      // up on the wrong branch without anyone noticing.
      setError(msg);
      setOpen(true);
      showToast(msg, 'error');
      setBusy(null);
      return false;
    }
    setBusy(null);
    return true;
  };

  // Just switch.
  //
  // Git carries uncommitted work across a switch by itself whenever the files
  // involved do not differ between the two branches, which is nearly always.
  // Asking first turned that ordinary case into a dialog about a problem that
  // was not going to happen.
  //
  // It still matters that the work moved — this editor saves to disk
  // constantly, so changes following you to another branch is exactly how they
  // get committed somewhere they do not belong. That is said afterwards, in
  // the toast, rather than asked beforehand.
  //
  // The question only gets put when git refuses, which it does cleanly and
  // without moving HEAD, and only for the files it names.
  const requestSwitch = (branch) => {
    if (branch === info.branch) {return;}
    const wasDirty = info.dirty;
    setOpen(false);
    act(
      async () => {
        const r = await window.avb.gitCheckout({ projectPath: project.path, branch });
        if (r?.blocked) {
          // These files differ between the branches, so the work genuinely
          // cannot come along. Now there is something to decide.
          setSwitchTo({ branch, files: r.files || [] });
          setOpen(true);
          return;
        }
        if (r?.error) {showToast(r.error, 'error');}
        else if (r?.restored) {showToast(`Picked your changes back up on ${branch}`, 'success');}
        else if (wasDirty) {showToast(`On ${branch} — your changes came with you`, 'success');}
        else {showToast(`Switched to ${branch}`, 'success');}
      },
      null,
      'Switching…'
    );
  };

  const switchNow = (branch) =>
    act(
      () => window.avb.gitCheckout({ projectPath: project.path, branch }),
      `Switched to ${branch}`,
      'Switching…'
    );

  // Leave the work where it was written and pick it up again on the way back.
  // No commit, nothing carried onto a branch it does not belong to.
  const parkThenSwitch = (branch) => {
    const from = info.branch;
    return act(
      async () => {
        const r = await window.avb.gitCheckout({
          projectPath: project.path,
          branch,
          parkFirst: true,
        });
        // The switch worked; anything else to say is about the changes.
        if (r?.error) {showToast(r.error, 'error');}
        else if (r?.restored) {showToast(`Picked your changes back up on ${branch}`, 'success');}
        return r;
      },
      `On ${branch} — your changes are waiting on ${from}`,
      'Switching…'
    );
  };

  // Both live in gitActions.js — the History panel offers the same two, and
  // they should ask the same questions in the same words wherever they are.
  // `act` is what differs: it is this component's busy state and error box.
  const mergeBranch = (branch) =>
    mergeBranchAction({
      projectPath: project.path,
      branch,
      into: info.branch,
      trunk: info.trunk,
      run: (fn, label) => act(fn, null, label),
      showToast,
      onConflict: (r) => {
        setConflict(r);
        setOpen(false);
      },
    });

  const deleteBranch = (branch) =>
    deleteBranchAction({
      projectPath: project.path,
      branch,
      parked: (info.parked || []).includes(branch),
      run: (fn, label) => act(fn, null, label),
      showToast,
    });

  const commitThenSwitch = (branch, message) => {
    const from = info.branch;
    return act(
      async () => {
        await window.avb.gitCommit({ projectPath: project.path, message });
        await window.avb.gitCheckout({ projectPath: project.path, branch });
      },
      `Committed to ${from}, now on ${branch}`,
      'Committing…'
    );
  };

  // Publishing is driven from the modal so it can show each step and keep the
  // form (and any error) in place instead of closing on a fire-and-forget.
  const publish = async ({ repoName, isPrivate, onStep }) => {
    setBusy('Publishing…');
    try {
      await flushSave();
      const state = await refresh();
      if (state.dirty || state.branch === '(no commits yet)') {
        onStep('Committing changes…');
        await window.avb.gitCommit({
          projectPath: project.path,
          message: 'Initial commit from Stacki',
        });
      }
      onStep('Creating repository and pushing…');
      const res = await window.avb.gitPublish({
        projectPath: project.path,
        repoName,
        isPrivate,
      });
      await refresh();
      return res?.url || null;
    } finally {
      setBusy(null);
    }
  };

  if (!info) {return null;}

  if (!info.isRepo) {
    return (
      <button
        className="git-chip"
        disabled={working}
        onClick={() =>
          act(
            () => window.avb.gitInit(project.path),
            'Initialized git repository',
            'Initializing…'
          )
        }
      >
        {working ? <span className="mini-spinner" /> : <BranchIcon size={12} />}
        {working ? busy : 'Initialize Git'}
      </button>
    );
  }

  // Everything is `paths: undefined` — the same call the button has always
  // made. Only a list narrowed by hand is sent as one.
  const allPicked = !picking || picked === null || picked.length === changed.length;
  const commit = () => {
    const message = commitMsg.trim() || 'Update from Stacki';
    const paths = allPicked ? undefined : picked;
    setCommitMsg('');
    act(
      () => window.avb.gitCommit({ projectPath: project.path, message, paths }),
      paths ? `Saved ${paths.length} file${paths.length === 1 ? '' : 's'}` : 'Changes committed',
      'Committing…'
    ).then(() => {
      setPicked(null);
      setPicking(false);
    });
  };

  // Three distinct states, because "0 commits ahead" and "never pushed" mean
  // very different things — see hasUpstream in git:info.
  const pushLabel = !info.hasUpstream
    ? `Push ${info.branch} to origin`
    : info.ahead > 0
      ? `Push ${info.ahead} commit${info.ahead === 1 ? '' : 's'}`
      : 'Everything pushed';
  const canPush = info.hasUpstream ? info.ahead > 0 : true;
  // Why this name can't be created, or null. Checked against the branches that
  // exist, so "already taken" is caught here rather than by git.
  const branchError = branchNameError(newBranch, info.branches || []);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className={`git-chip ${working ? 'busy' : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          refresh();
        }}
      >
        {working ? (
          <>
            <span className="mini-spinner" />
            {busy}
          </>
        ) : (
          <>
            <BranchIcon size={12} />
            <span className={`dot ${info.dirty ? 'dirty' : ''}`} />
            {info.branch}
            {info.ahead > 0 && <span style={{ color: 'var(--text-faint)' }}>↑{info.ahead}</span>}
          </>
        )}
      </button>

      {open && (
        <div className="dropdown">
          {error && (
            <div className="git-error">
              {error}
              <button className="ghost" title="Dismiss" onClick={() => setError(null)}>
                <CloseIcon size={11} />
              </button>
            </div>
          )}
          <h3>Branches</h3>
          {info.branches.map((b) => (
            <div
              key={b}
              className={`list-item ${b === info.branch ? 'active' : ''}`}
              onClick={() => requestSwitch(b)}
            >
              <span className="icon" style={{ width: 14 }}>
                {b === info.branch ? <CheckIcon size={12} /> : null}
              </span>
              <span className="label">{b}</span>
              {(info.parked || []).includes(b) && b !== info.branch && (
                <span className="branch-parked" title="Changes waiting on this branch">
                  changes waiting
                </span>
              )}
              <BranchActions
                branch={b}
                current={info.branch}
                trunk={info.trunk}
                disabled={working}
                onMerge={mergeBranch}
                onDelete={deleteBranch}
              />
            </div>
          ))}
          {/* The rules git checks are checked here instead, where the name is
              being typed: a character it refuses never lands in the field, and
              what's left — the shape of the whole name, a name already taken —
              is said before Enter does anything. Sending it and reporting back
              "fatal: 'my branch' is not a valid branch name" loses the name and
              explains it in git's words. */}
          <div className="dropdown-row">
            <input
              placeholder="new-branch-name"
              value={newBranch}
              aria-invalid={!!branchError}
              onChange={(e) => setNewBranch(sanitizeBranchName(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranch.trim() && !branchError) {
                  const name = newBranch.trim();
                  setNewBranch('');
                  act(
                    () =>
                      window.avb.gitCheckout({
                        projectPath: project.path,
                        branch: name,
                        create: true,
                      }),
                    `Created branch ${name}`,
                    'Creating branch…'
                  );
                }
              }}
            />
          </div>
          {branchError && <div className="git-hint">{branchError}</div>}

          <div className="divider" />
          <h3>Commit</h3>
          <div className="dropdown-row" style={{ flexDirection: 'column', gap: 6 }}>
            <input
              placeholder="Commit message"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && info.dirty && !working) {commit();}
              }}
            />
            {/* The list is closed by default. Someone who just wants to save
                everything should never have to look at a file list to do it —
                that is the whole difference between this and a git client. */}
            {info.dirty && (
              <button
                className="git-pick-toggle"
                onClick={() => setPicking((v) => !v)}
              >
                {picking ? 'Commit everything instead' : 'Choose what to commit…'}
              </button>
            )}

            {picking && info.dirty && (
              <div className="git-pick">
                {/* The same browser the History panel shows, in picking mode.
                    Only the changed files here: committing is about what has
                    changed, and the rest of the project would be a haystack
                    around the needle. */}
                <FileBrowser
                  files={changed}
                  selectable
                  selected={picked || []}
                  onSelect={setPicked}
                  emptyMessage="Nothing has changed."
                  autoFocusSearch
                />
              </div>
            )}

            <button
              className="primary"
              disabled={working || !info.dirty || (picking && !(picked || []).length)}
              onClick={commit}
            >
              {/* When the list is open and everything happens to be ticked,
                  "Commit all changes" is true but reads as if the picking was
                  ignored. Say the count instead — it matches what is on
                  screen. */}
              {!info.dirty
                ? 'Nothing to commit'
                : !picking
                  ? 'Commit all changes'
                  : `Commit ${(picked || []).length} file${(picked || []).length === 1 ? '' : 's'}`}
            </button>
          </div>

          <div className="divider" />
          <h3>GitHub</h3>
          <div className="dropdown-row" style={{ flexDirection: 'column', gap: 6 }}>
            {info.remote ? (
              <>
                <button
                  className="repo-link"
                  title={`Open ${repoSlug(info.remote)} on GitHub`}
                  onClick={() => window.avb.openExternal(webUrl(info.remote))}
                >
                  <span className="repo-slug">{repoSlug(info.remote)}</span>
                  <ExternalIcon size={11} />
                </button>
                <button
                  className="primary"
                  disabled={working || !canPush}
                  onClick={() =>
                    act(
                      () =>
                        window.avb.gitPush({ projectPath: project.path, branch: info.branch }),
                      `Pushed ${info.branch} to origin`,
                      'Pushing…'
                    )
                  }
                >
                  {pushLabel}
                </button>
                {info.dirty && (
                  <div className="hint-text">
                    You have uncommitted changes — commit them first to include them.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="hint-text">
                  This project isn’t on GitHub yet.
                </div>
                <button
                  className="primary"
                  disabled={working}
                  onClick={() => {
                    setOpen(false);
                    setShowPublish(true);
                  }}
                >
                  Publish to GitHub…
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {conflict && (
        <MergeConflictModal
          conflict={conflict}
          busy={busy}
          onCancel={() => setConflict(null)}
          onResolve={async (choices) => {
            const done = await act(
              async () => {
                const r = await window.avb.gitResolveMerge({
                  projectPath: project.path,
                  branch: conflict.branch,
                  choices,
                });
                // The tidy-up was chosen back when the merge was started, before
                // anyone knew it would clash. It still applies now it is settled.
                if (conflict.deleteAfter) {
                  await tidyUp({
                    projectPath: project.path,
                    branch: conflict.branch,
                    into: r.into,
                    changed: true,
                    showToast,
                  });
                } else {
                  showToast(`Merged ${conflict.branch} into ${r.into}`, 'success');
                }
              },
              null,
              'Merging…'
            );
            if (done) {setConflict(null);}
          }}
        />
      )}

      {switchTo && (
        <SwitchBranchModal
          from={info.branch}
          to={switchTo.branch}
          files={switchTo.files}
          busy={busy}
          onCancel={() => setSwitchTo(null)}
          onLeaveHere={async () => {
            if (await parkThenSwitch(switchTo.branch)) {setSwitchTo(null);}
          }}
          onCommitFirst={async (message) => {
            if (await commitThenSwitch(switchTo.branch, message)) {setSwitchTo(null);}
          }}
        />
      )}

      {showPublish && (
        <PublishModal
          projectPath={project.path}
          defaultName={project.name}
          branch={info.branch}
          onClose={() => setShowPublish(false)}
          onPublish={publish}
          openExternal={(u) => window.avb.openExternal(u)}
        />
      )}
    </div>
  );
}

function PublishModal({ projectPath, defaultName, branch, onClose, onPublish, openExternal }) {
  const [name, setName] = useState(
    defaultName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  );
  const [isPrivate, setIsPrivate] = useState(true);
  const preflight = useGitHubStatus(projectPath);
  const gh = preflight.kind === 'ready' ? preflight.status : null;
  const [phase, setPhase] = useState('form'); // form | publishing | done
  const [step, setStep] = useState('');
  const [error, setError] = useState(null);
  const [url, setUrl] = useState(null);

  const publishing = phase === 'publishing';
  const ready = gh?.installed && gh?.authed;

  const go = async () => {
    setError(null);
    setPhase('publishing');
    setStep('Preparing…');
    try {
      const result = await onPublish({
        repoName: name.trim(),
        isPrivate,
        onStep: setStep,
      });
      setUrl(result);
      setPhase('done');
    } catch (err) {
      setError(cleanError(err));
      setPhase('form'); // keep the form filled in so it can be retried
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && !publishing && onClose()}
    >
      <div className="modal">
        <div className="modal-header">
          {phase === 'done' ? 'Published to GitHub' : 'Publish to GitHub'}
        </div>

        {phase === 'done' ? (
          <>
            <div className="modal-body">
              <div className="publish-done">
                <CheckIcon size={14} />
                <span>
                  {name} is on GitHub and <strong>{branch}</strong> has been pushed.
                </span>
              </div>
              {url && (
                <button className="repo-link" onClick={() => openExternal(url)}>
                  <span className="repo-slug">{repoSlug(url)}</span>
                  <ExternalIcon size={11} />
                </button>
              )}
            </div>
            <div className="modal-footer">
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div>
                <label>Repository name</label>
                <input
                  autoFocus
                  value={name}
                  disabled={publishing}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim() && ready && !publishing) {go();}
                  }}
                />
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  disabled={publishing}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                Private repository
              </label>

              {preflight.kind === 'loading' && <div className="hint-text">Checking GitHub CLI…</div>}
              {preflight.kind === 'error' && <div className="error-text">{preflight.error}</div>}

              {gh && !gh.installed && (
                <div className="error-text">
                  GitHub CLI (gh) isn’t installed. Install it from cli.github.com, then run
                  {' '}<code>gh auth login</code>.
                </div>
              )}
              {gh?.installed && !gh.authed && (
                <div className="error-text">
                  GitHub CLI isn’t signed in. Run <code>gh auth login</code> in a terminal,
                  then reopen this dialog.
                </div>
              )}
              {ready && !publishing && !error && (
                <div className="hint-text">
                  Commits any pending changes, creates the repo as{' '}
                  {isPrivate ? 'private' : 'public'}, and pushes <strong>{branch}</strong>
                  {gh.user ? ` to ${gh.user}` : ''}.
                </div>
              )}

              {publishing && (
                <div className="publish-progress">
                  <span className="mini-spinner" />
                  <span>{step}</span>
                </div>
              )}

              {error && <div className="error-text">{error}</div>}
            </div>

            <div className="modal-footer">
              <button onClick={onClose} disabled={publishing}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!name.trim() || !ready || publishing}
                onClick={go}
              >
                {publishing ? 'Publishing…' : error ? 'Try again' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
