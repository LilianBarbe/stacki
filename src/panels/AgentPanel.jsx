import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Dropdown from '../ui/Dropdown.jsx';
import MoreMenu from '../ui/MoreMenu.jsx';
import AutoTextarea from '../ui/AutoTextarea.jsx';
import { PlusIcon, CheckIcon, ChevronDownIcon } from '../ui/Icons.jsx';
import * as store from './agentStore.js';

// The Agent panel: a coding agent in the left rail, at the same rank as Code
// or the CMS, talking about the open project.
//
// Laid out the way Zed lays out its agent panel — the thread above, the
// composer below with its controls on one line — but in Stacki's clothes.
// The agent is spoken to over ACP (see electron/acp.js), which is what makes
// the controls generic: the composer shows one dropdown per config option the
// agent advertises (mode and model today; effort the day the adapter offers
// it, under the category the protocol reserves for it), so nothing here knows
// which agent is on the other end. Only Claude Agent is offered for now.
//
// The one thing a sidebar can do that the terminal dock can't: with the
// crosshair on, the canvas selection travels with every message — the file
// and the lines the person is looking at, so the agent lands on the markup
// they mean rather than some other use of the same component.

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
  const where = block.locations?.[0]?.path;
  const rel = where && projectPath && where.startsWith(projectPath + '/') ? where.slice(projectPath.length + 1) : where;
  const outputs = (block.content || []).map((c, i) => {
    if (c.type === 'diff') {
      const p = c.path && projectPath && c.path.startsWith(projectPath + '/') ? c.path.slice(projectPath.length + 1) : c.path;
      return (
        <div key={i} className="agent-tool-out">
          {c.oldText == null ? `created ${p}` : `edited ${p}`}
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

function Turn({ turn, projectPath }) {
  if (turn.role === 'user') {
    const a = turn.attached;
    return (
      <div className="agent-turn user">
        {turn.blocks.map((b) => b.text).join('')}
        {a && (
          <div className="agent-attached">
            {a.rel}
            {a.startLine && (a.startLine === a.endLine ? ` L${a.startLine}` : ` L${a.startLine}–${a.endLine}`)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="agent-turn agent">
      {turn.blocks.map((b) => {
        if (b.type === 'text') return <div key={b.id} className="agent-text">{b.text}</div>;
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

// --- The panel ------------------------------------------------------------------

export default function AgentPanel({ project, selectionKey }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const projectPath = project?.path || null;
  const [draft, setDraft] = useState('');
  const [follow, setFollow] = useState(readFollow);
  const threadRef = useRef(null);
  const stickRef = useRef(true); // scrolled to the bottom, so new text should keep it there

  useEffect(() => {
    store.ensure(projectPath);
  }, [projectPath]);

  // Follow the conversation down unless the person has scrolled up to read.
  const { turns, permissions, running } = state;
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, permissions, running]);
  const onThreadScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  // The selection as the chip shows it — from the key alone, no round trip.
  // The lines are only fetched when a message actually goes.
  const selection = useMemo(() => {
    if (!selectionKey) return null;
    const hash = selectionKey.indexOf('#');
    const file = hash < 0 ? selectionKey : selectionKey.slice(0, hash);
    const where = hash < 0 ? '' : selectionKey.slice(hash + 1);
    return { key: selectionKey, file, where };
  }, [selectionKey]);

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
    if (at.startLine && at.endLine) {
      const text = at.text.split('\n').slice(at.startLine - 1, at.endLine).join('\n');
      return { rel: at.rel, uri, startLine: at.startLine, endLine: at.endLine, text };
    }
    return { rel: at.rel, uri, startLine: null, endLine: null, text: null };
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || running || state.status !== 'ready') return;
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

  const title = useMemo(() => {
    const first = turns.find((t) => t.role === 'user');
    if (!first) return 'New thread';
    const text = first.blocks.map((b) => b.text).join('').replace(/\s+/g, ' ').trim();
    return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text;
  }, [turns]);

  const options = useMemo(() => {
    const list = state.session?.configOptions || [];
    const rank = (o) => {
      const i = CATEGORY_ORDER.indexOf(o.category);
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    return [...list].filter((o) => o.type === 'select').sort((a, b) => rank(a) - rank(b));
  }, [state.session]);
  const hasEffort = options.some((o) => o.category === 'thought_level');

  const menuItems = [
    { label: 'Agent', disabled: true },
    { label: AGENT_NAME, icon: <CheckIcon size={12} /> },
    { label: 'Restart agent', onSelect: () => projectPath && store.start(projectPath) },
  ];

  const ready = state.status === 'ready';
  const busy = state.status === 'starting';

  return (
    <div className="agent-panel">
      <div className="panel-header">
        <h2 title={title}>{title}</h2>
        <div className="agent-header-actions">
          <button
            type="button"
            title="New thread"
            disabled={!projectPath || busy}
            onClick={() => projectPath && store.start(projectPath)}
          >
            <PlusIcon size={14} />
          </button>
          <MoreMenu items={menuItems} title="Agent options" width={170} />
        </div>
      </div>

      <div className="agent-thread" ref={threadRef} onScroll={onThreadScroll}>
        {!projectPath && <div className="props-empty agent-empty">Open a project to talk to {AGENT_NAME} about it.</div>}
        {projectPath && busy && <div className="props-empty agent-empty">Starting {AGENT_NAME}…</div>}
        {projectPath && ready && !turns.length && (
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

      <div className="agent-composer">
        {follow && selection && (
          <div className="agent-context" title={selection.key}>
            <CrosshairIcon />
            <span className="agent-context-file">{selection.file}</span>
            {selection.where === 'frontmatter' && <span className="agent-context-where">frontmatter</span>}
            {selection.where && selection.where !== 'frontmatter' && <span className="agent-context-where">selection</span>}
          </div>
        )}
        <AutoTextarea
          value={draft}
          minRows={2}
          placeholder={`Message ${AGENT_NAME}…`}
          disabled={!ready}
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
          {!hasEffort && (
            <button
              type="button"
              className="dd-trigger agent-config"
              disabled
              title="Effort — the Claude Agent adapter does not offer it yet"
            >
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
            <button type="button" className="agent-send" title="Send (Enter)" disabled={!ready || !draft.trim()} onClick={send}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
