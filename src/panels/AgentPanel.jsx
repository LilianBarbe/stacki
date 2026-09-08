import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Dropdown from '../ui/Dropdown.jsx';
import MoreMenu from '../ui/MoreMenu.jsx';
import AutoTextarea from '../ui/AutoTextarea.jsx';
import { PlusIcon, CheckIcon, ChevronDownIcon, HistoryIcon } from '../ui/Icons.jsx';
import { relativeTime } from './HistoryPanel.jsx';
import * as store from './agentStore.js';
import { EFFORT_LEVELS, parseUserText, titleOf } from './agentStore.js';

// The Agent panel: a coding agent in the left rail, at the same rank as Code
// or the CMS, talking about the open project.
//
// Laid out the way Zed lays out its agent panel — the thread above, the
// composer below with its controls on one line, the list of threads in the
// thread's place while it is open — but in Stacki's clothes. The agent is
// spoken to over ACP (see electron/acp.js), which is what makes the controls
// generic: the composer shows one dropdown per config option the agent
// advertises (mode and model today; effort the day the adapter offers it,
// under the category the protocol reserves for it), so nothing here knows
// which agent is on the other end. Only Claude Agent is offered for now.
//
// The one thing a sidebar can do that the terminal dock can't: with the
// crosshair on, the canvas selection travels with every message — the file,
// the name the canvas shows for it, and the lines it lands on — so the agent
// reads the markup the person means rather than some other use of the same
// component.

const AGENT_NAME = 'Claude Agent';
const FOLLOW_KEY = 'stacki.agent.followSelection';
const TITLE_MAX = 40;
// The order the dropdowns sit in, by the protocol's categories. Anything the
// agent adds outside them goes after.
const CATEGORY_ORDER = ['mode', 'model', 'thought_level'];

const readFollow = () => {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'off';
  } catch {
    return true;
  }
};
const storeFollow = (on) => {
  try {
    localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode / quota */
  }
};

const EFFORT_OPTIONS = EFFORT_LEVELS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

const shorten = (text) => (text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text);

// --- Icons the rest of the app has no use for ------------------------------

const Svg = ({ children, size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', flexShrink: 0 }}
    aria-hidden="true"
  >
    {children}
  </svg>
);
const SendIcon = () => (
  <Svg>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);
const StopIcon = () => (
  <Svg size={12}>
    <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);
const CrosshairIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
  </Svg>
);

// --- Pieces of a turn ---------------------------------------------------------

// The agent writes Markdown. Rendered to elements, never to HTML strings —
// what the model says is not the app's to trust as markup — and a link opens
// in the browser rather than steering the app's own window.
const mdComponents = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void window.avb?.openExternal?.(href);
      }}
    >
      {children}
    </a>
  ),
};
function Markdown({ text }) {
  return (
    <div className="agent-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ThoughtBlock({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-thought">
      <button type="button" className="agent-thought-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide thinking' : 'Thinking…'}
      </button>
      {open && <div className="agent-text">{text}</div>}
    </div>
  );
}

const STATUS_LABEL = { pending: 'waiting', in_progress: 'running', completed: 'done', failed: 'failed' };

function ToolBlock({ block, projectPath }) {
  const [open, setOpen] = useState(false);
  const relOf = (p) => (p && projectPath && p.startsWith(projectPath + '/') ? p.slice(projectPath.length + 1) : p);
  const rel = relOf(block.locations?.[0]?.path);
  const outputs = (block.content || []).map((c, i) => {
    if (c.type === 'diff') {
      return (
        <div key={i} className="agent-tool-out">
          {c.oldText == null ? `created ${relOf(c.path)}` : `edited ${relOf(c.path)}`}
        </div>
      );
    }
    if (c.type === 'content' && c.content?.type === 'text' && c.content.text) {
      return (
        <div key={i} className="agent-tool-out">
          {c.content.text}
        </div>
      );
    }
    return null;
  });
  return (
    <div className={`agent-tool-wrap${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`agent-tool is-${block.status || 'pending'}`}
        onClick={() => setOpen((o) => !o)}
        title={STATUS_LABEL[block.status] || block.status}
      >
        <span className="agent-tool-dot" />
        <span className="agent-tool-title">{block.title}</span>
        {rel && <span className="agent-tool-where">{rel.split('/').pop()}</span>}
      </button>
      {open && outputs}
    </div>
  );
}

const PLAN_MARK = { pending: '○', in_progress: '◐', completed: '●' };

function PlanBlock({ entries }) {
  if (!entries.length) return null;
  return (
    <ul className="agent-plan">
      {entries.map((e, i) => (
        <li key={i} className={`is-${e.status || 'pending'}`}>
          <span className="agent-plan-mark">{PLAN_MARK[e.status] || '○'}</span>
          {e.content}
        </li>
      ))}
    </ul>
  );
}

// "src/pages/index.astro Step (164:167)": the file, the name the canvas
// shows, the lines. The same chip above the composer and on the message.
function SelectionChip({ rel, label, startLine, endLine, className = '', title }) {
  return (
    <span className={`agent-chip ${className}`} title={title}>
      <span className="agent-chip-file">{rel}</span>
      {label && <span className="agent-chip-label">{label}</span>}
      {startLine && endLine && <span className="agent-chip-lines">({startLine}:{endLine})</span>}
    </span>
  );
}

function Turn({ turn, projectPath }) {
  if (turn.role === 'user') {
    const raw = turn.blocks.map((b) => b.text || '').join('');
    // A message sent from here knows what it attached; one replayed from the
    // agent's record carries it inside the words, and is taken apart.
    const parsed = parseUserText(raw);
    const attached = turn.attached || parsed.attached;
    return (
      <div className="agent-turn user">
        {attached && <SelectionChip {...attached} className="agent-attached" />}
        <div className="agent-user-text">{parsed.text}</div>
      </div>
    );
  }
  return (
    <div className="agent-turn agent">
      {turn.blocks.map((b) => {
        if (b.type === 'text') return <Markdown key={b.id} text={b.text} />;
        if (b.type === 'thought') return <ThoughtBlock key={b.id} text={b.text} />;
        if (b.type === 'tool') return <ToolBlock key={b.id} block={b} projectPath={projectPath} />;
        if (b.type === 'plan') return <PlanBlock key={b.id} entries={b.entries} />;
        return null;
      })}
    </div>
  );
}

// What the agent is asking leave to do: the tool, the gist of its input, and
// the answers it offered — an "allow" kind reads as the primary one.
function PermissionCard({ request }) {
  const call = request.toolCall || {};
  const input = call.rawInput;
  const gist =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object'
        ? input.command || input.file_path || input.path || JSON.stringify(input, null, 1)
        : '';
  return (
    <div className="agent-permission">
      <div className="agent-permission-title">{call.title || 'Allow this?'}</div>
      {gist && <div className="agent-permission-input">{String(gist).slice(0, 600)}</div>}
      <div className="agent-permission-actions">
        {(request.options || []).map((o) => (
          <button
            key={o.optionId}
            type="button"
            className={/^allow/.test(o.kind || '') ? 'primary' : ''}
            onClick={() => store.answerPermission(request.requestId, o.optionId)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// A name being typed in place of a title — in the header or a list row.
function RenameField({ value, onDone, className = '' }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => onDone(draft);
  return (
    <input
      ref={ref}
      className={`agent-rename ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(null);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// --- The list of threads ----------------------------------------------------------

// Grey when nothing is happening, orange while the agent works in it, green
// once an answer has landed that nobody has looked at.
const dotOf = (t) => (t.running ? 'active' : t.unread ? 'unread' : 'idle');

function ThreadList({ state, onPick }) {
  const [renaming, setRenaming] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const all = Object.values(state.threads);
  const archivedCount = all.filter((t) => t.archived).length;
  const rows = all
    .filter((t) => (showArchived ? t.archived : !t.archived))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return (
    <div className="agent-history">
      {state.listing && !rows.length && <div className="props-empty agent-empty">Loading threads…</div>}
      {!state.listing && !rows.length && (
        <div className="props-empty agent-empty">
          {showArchived ? 'Nothing archived.' : 'No threads yet — the first message starts one.'}
        </div>
      )}
      {rows.map((t) => {
        const name = titleOf(t);
        return (
          <div
            key={t.id}
            className={`agent-thread-row${t.id === state.currentId ? ' on' : ''}`}
            title={name}
            role="button"
            tabIndex={0}
            onClick={() => renaming !== t.id && onPick(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming !== t.id) onPick(t.id);
            }}
          >
            <span className={`agent-dot is-${dotOf(t)}`} />
            {renaming === t.id ? (
              <RenameField
                value={name}
                className="agent-thread-title"
                onDone={(v) => {
                  setRenaming(null);
                  if (v !== null) store.renameThread(t.id, v);
                }}
              />
            ) : (
              <span className="agent-thread-title">{name}</span>
            )}
            <span className="agent-thread-when">{relativeTime(t.updatedAt)}</span>
            <MoreMenu
              title="Thread options"
              width={150}
              items={[
                { label: 'Rename', onSelect: () => setRenaming(t.id) },
                t.archived
                  ? { label: 'Unarchive', onSelect: () => store.archiveThread(t.id, false) }
                  : { label: 'Archive', onSelect: () => store.archiveThread(t.id, true) },
              ]}
            />
          </div>
        );
      })}
      {(archivedCount > 0 || showArchived) && (
        <button type="button" className="agent-history-foot" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? 'Back to threads' : `${archivedCount} archived`}
        </button>
      )}
    </div>
  );
}

// --- The panel ------------------------------------------------------------------

export default function AgentPanel({ project, selectionKey, selectionLabel }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const projectPath = project?.path || null;
  const thread = store.current(state);
  const turns = thread?.turns || [];
  const permissions = thread?.permissions || [];
  const running = !!thread?.running;

  const [draft, setDraft] = useState('');
  const [follow, setFollow] = useState(readFollow);
  // 'thread' or 'history': the list of threads takes the thread's place
  // while it is open, the way Zed's does.
  const [view, setView] = useState('thread');
  const [renaming, setRenaming] = useState(false);
  const threadRef = useRef(null);
  const stickRef = useRef(true); // scrolled to the bottom, so new text should keep it there

  useEffect(() => {
    store.ensure(projectPath);
    setView('thread');
  }, [projectPath]);

  // Follow the conversation down unless the person has scrolled up to read.
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, permissions, running, state.currentId]);
  const onThreadScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  // The selection as the chip shows it. The file and the name come from the
  // key and the canvas at once; the lines take a round trip, made a moment
  // after the selection settles rather than on every hop through the tree.
  const selection = useMemo(() => {
    if (!selectionKey) return null;
    const hash = selectionKey.indexOf('#');
    const file = hash < 0 ? selectionKey : selectionKey.slice(0, hash);
    const where = hash < 0 ? '' : selectionKey.slice(hash + 1);
    return { key: selectionKey, file, where, label: where ? selectionLabel : null };
  }, [selectionKey, selectionLabel]);
  const [located, setLocated] = useState(null); // { key, rel, startLine, endLine }
  useEffect(() => {
    if (!selection || !projectPath) {
      setLocated(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      let at = null;
      try {
        at = await window.avb.locateSelection({ projectPath, key: selection.key });
      } catch {
        at = null;
      }
      if (alive) setLocated(at ? { key: selection.key, rel: at.rel, startLine: at.startLine, endLine: at.endLine } : null);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selection, projectPath]);
  const lines = located && located.key === selection?.key ? located : null;

  const attachment = async () => {
    if (!follow || !selection || !projectPath) return null;
    let at = null;
    try {
      at = await window.avb.locateSelection({ projectPath, key: selection.key });
    } catch {
      at = null;
    }
    if (!at) return null;
    const uri = `file://${projectPath}/${at.rel}`;
    const label = selection.label || null;
    if (at.startLine && at.endLine) {
      const text = at.text.split('\n').slice(at.startLine - 1, at.endLine).join('\n');
      return { rel: at.rel, uri, label, startLine: at.startLine, endLine: at.endLine, text };
    }
    return { rel: at.rel, uri, label, startLine: null, endLine: null, text: null };
  };

  const ready = state.status === 'ready';
  const canSend = ready && !!thread?.loaded && !running;

  const send = async () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft('');
    stickRef.current = true;
    void store.sendPrompt(text, await attachment());
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const toggleFollow = () => {
    setFollow((f) => {
      storeFollow(!f);
      return !f;
    });
  };

  const options = useMemo(() => {
    const list = thread?.configOptions || [];
    const rank = (o) => {
      const i = CATEGORY_ORDER.indexOf(o.category);
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    return [...list].filter((o) => o.type === 'select').sort((a, b) => rank(a) - rank(b));
  }, [thread?.configOptions]);
  // Effort: the agent's own option when it advertises one; else Claude Code's
  // /effort command, when the agent lists it; else a place kept for it.
  const hasEffort = options.some((o) => o.category === 'thought_level');
  const canEffort = !hasEffort && state.commands.some((c) => c.name === 'effort');

  const title = view === 'history' ? 'Threads' : shorten(titleOf(thread));
  const menuItems = [
    { label: 'Agent', disabled: true },
    { label: AGENT_NAME, icon: <CheckIcon size={12} /> },
    thread && { label: 'Rename thread', onSelect: () => setRenaming(true) },
    thread && { label: 'Archive thread', onSelect: () => store.archiveThread(thread.id, true) },
    { label: 'Restart agent', onSelect: () => projectPath && store.start(projectPath) },
  ];

  const openHistory = () => {
    if (view === 'history') {
      setView('thread');
      return;
    }
    setView('history');
    void store.listThreads();
  };
  const pickThread = (id) => {
    setView('thread');
    stickRef.current = true;
    void store.openThread(id);
  };

  const busy = state.status === 'starting';
  const loading = !!thread?.loading;

  return (
    <div className="agent-panel">
      <div className="panel-header">
        {renaming && thread ? (
          <RenameField
            value={titleOf(thread)}
            className="agent-rename-title"
            onDone={(v) => {
              setRenaming(false);
              if (v !== null) store.renameThread(thread.id, v);
            }}
          />
        ) : (
          <h2 title={title}>{title}</h2>
        )}
        <div className="agent-header-actions">
          <button
            type="button"
            title="New thread"
            disabled={!projectPath || busy}
            onClick={() => {
              setView('thread');
              void store.newThread();
            }}
          >
            <PlusIcon size={14} />
          </button>
          <button
            type="button"
            className={view === 'history' ? 'on' : ''}
            title={view === 'history' ? 'Back to the thread' : 'Threads'}
            disabled={!ready && view !== 'history'}
            onClick={openHistory}
          >
            <HistoryIcon size={14} />
          </button>
          <MoreMenu items={menuItems} title="Agent options" width={170} />
        </div>
      </div>

      {view === 'history' && <ThreadList state={state} onPick={pickThread} />}

      <div className="agent-thread" ref={threadRef} onScroll={onThreadScroll} hidden={view === 'history'}>
        {!projectPath && <div className="props-empty agent-empty">Open a project to talk to {AGENT_NAME} about it.</div>}
        {projectPath && busy && <div className="props-empty agent-empty">Starting {AGENT_NAME}…</div>}
        {projectPath && ready && loading && <div className="props-empty agent-empty">Loading the thread…</div>}
        {projectPath && ready && !loading && thread?.loaded && !turns.length && (
          <div className="props-empty agent-empty">
            Ask {AGENT_NAME} about the page you are looking at. With the crosshair on, the canvas selection travels with each message.
          </div>
        )}
        {turns.map((t) => (
          <Turn key={t.id} turn={t} projectPath={projectPath} />
        ))}
        {permissions.map((p) => (
          <PermissionCard key={p.requestId} request={p} />
        ))}
        {state.error && (
          <div className="agent-error">
            {state.error}
            {(state.status === 'error' || state.status === 'exited') && projectPath && (
              <div className="agent-error-actions">
                <button type="button" onClick={() => store.start(projectPath)}>
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="agent-composer" hidden={view === 'history'}>
        {follow && selection && (
          <SelectionChip
            rel={lines?.rel || selection.file}
            label={selection.label}
            startLine={lines?.startLine}
            endLine={lines?.endLine}
            className="agent-context"
            title={selection.key}
          />
        )}
        <AutoTextarea
          value={draft}
          minRows={2}
          placeholder={`Message ${AGENT_NAME}…`}
          disabled={!ready || !thread?.loaded}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="agent-toolbar">
          <button
            type="button"
            className={`agent-follow${follow ? ' on' : ''}`}
            title={follow ? 'The canvas selection goes with each message' : 'Send the canvas selection with each message'}
            onClick={toggleFollow}
          >
            <CrosshairIcon />
          </button>
          <span className="agent-spacer" />
          {options.map((o) => (
            <Dropdown
              key={o.id}
              className="agent-config"
              value={o.currentValue}
              options={(o.options || []).map((c) => ({ value: c.value, label: c.name }))}
              onChange={(v) => store.setConfig(o.id, v)}
              livePreview={false}
            />
          ))}
          {canEffort && (
            <Dropdown
              className={`agent-config${running ? ' agent-config-off' : ''}`}
              value={thread?.effort || ''}
              placeholder="Effort"
              options={EFFORT_OPTIONS}
              onChange={(v) => !running && store.setEffort(v)}
              livePreview={false}
            />
          )}
          {!hasEffort && !canEffort && (
            <button type="button" className="dd-trigger agent-config" disabled title="Effort — this agent does not offer it">
              <span className="dd-label dim">Effort</span>
              <span className="dd-chevron">
                <ChevronDownIcon size={11} />
              </span>
            </button>
          )}
          {running ? (
            <button type="button" className="agent-send stop" title="Stop" onClick={() => store.cancel()}>
              <StopIcon />
            </button>
          ) : (
            <button type="button" className="agent-send" title="Send (Enter)" disabled={!canSend || !draft.trim()} onClick={send}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
