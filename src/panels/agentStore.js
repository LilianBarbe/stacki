// The agent conversations, kept outside the panel.
//
// The left panel unmounts whenever another rail tab opens, and a thread that
// vanished the moment you glanced at the navigator would be no thread at all.
// So the threads, their turns and the questions the agent is waiting on live
// here, and the panel is a view of them: it mounts, subscribes, and finds the
// conversation where it left it — including whatever the agent said while the
// panel was closed. The agent process in main outlives the panel the same way;
// a project switch, a restart, or the app closing retires it.
//
// Every thread the agent has opened in this process stays loaded, so coming
// back to one is a switch, not a reload; a thread that is only known from the
// agent's own list is loaded the first time it is opened. A thread keeps
// running when another is on screen, and says so with a dot in the list —
// orange while the agent works, green once an answer has landed unread.
//
// Names and archiving are the app's: ACP has no word for either, so they live
// in localStorage per project, over the agent's own titles.
//
// The pure part — how a stream of session/update notifications becomes turns
// and blocks — is `applyUpdate`, exported so it can be tested without a DOM.

import { cleanError } from '../cleanError.js';

let seq = 0;
const nextId = () => `t${++seq}`;

const EMPTY = {
  projectPath: null,
  status: 'idle', // idle | starting | ready | error | exited — the agent process
  error: null,
  gen: 0, // which agent process; an exit from an older one is not news
  agentInfo: null,
  currentId: null,
  threads: {}, // sessionId -> thread, see makeThread
  listing: false, // the agent's list is on its way
  commands: [], // slash commands the agent advertises
};

let snapshot = EMPTY;
const listeners = new Set();

const set = (patch) => {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
};

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getSnapshot = () => snapshot;

// --- What the app remembers about threads ---------------------------------------

const LOCAL_KEY = (projectPath) => `stacki.agent.threads:${projectPath}`;
let local = { names: {}, archived: [] };

function readLocal(projectPath) {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(projectPath));
    const data = raw ? JSON.parse(raw) : {};
    return { names: data.names || {}, archived: Array.isArray(data.archived) ? data.archived : [] };
  } catch {
    return { names: {}, archived: [] };
  }
}
function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY(snapshot.projectPath), JSON.stringify(local));
  } catch {
    /* private mode / quota — the names just won't outlive the session */
  }
}

function makeThread(id, extra = {}) {
  return {
    id,
    agentTitle: '', // what the agent's list calls it
    title: local.names[id] || '', // the app's name for it, else the agent's
    updatedAt: new Date().toISOString(),
    loaded: false, // its turns are here (opened in this process)
    loading: false, // being replayed
    turns: [], // [{ id, role: 'user' | 'agent', blocks, attached? }]
    configOptions: [],
    permissions: [], // requests the agent is waiting on, oldest first
    running: false, // a prompt is in flight
    unread: false, // an answer landed while another thread was on screen
    archived: local.archived.includes(id),
    ...extra,
  };
}

const threadOf = (id) => (id && snapshot.threads[id]) || null;
export const current = (s = snapshot) => (s.currentId && s.threads[s.currentId]) || null;

function patchThread(id, patch) {
  const t = snapshot.threads[id];
  if (!t) return;
  const next = typeof patch === 'function' ? patch(t) : patch;
  set({ threads: { ...snapshot.threads, [id]: { ...t, ...next } } });
}

// What a thread is called: the app's name, the agent's, the first thing said
// in it, or nothing yet.
export function titleOf(t) {
  if (!t) return 'New thread';
  if (t.title) return t.title;
  const first = t.turns.find((turn) => turn.role === 'user');
  const text = first ? parseUserText(first.blocks.map((b) => b.text || '').join('')).text.replace(/\s+/g, ' ').trim() : '';
  return text || 'New thread';
}

// --- Turning updates into turns -------------------------------------------------

// A text-like chunk lands on the last block of its type when that block is
// the last one, so streamed text stays one block rather than one per chunk.
function appendChunk(turn, type, content) {
  const text = content?.type === 'text' ? content.text : content?.type ? `[${content.type}]` : '';
  if (!text) return;
  const last = turn.blocks[turn.blocks.length - 1];
  if (last && last.type === type) {
    turn.blocks[turn.blocks.length - 1] = { ...last, text: last.text + text };
  } else {
    turn.blocks.push({ id: nextId(), type, text });
  }
}

// Claude Code records a slash command — a model switch, say — as a user
// message wrapped in tags, and its output as another. A loaded thread replays
// them like anything the person typed; they were never that, so they go.
const COMMAND_NOISE =
  /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder)>[\s\S]*?<\/\1>/g;
export function stripCommandNoise(text) {
  const clean = String(text || '').replace(COMMAND_NOISE, '');
  return clean.trim() ? clean : '';
}

// A user message as a loaded thread replays it is the whole prompt that went:
// the words, then the selection tag above, then what the adapter made of the
// attached resource (an @-link and a <context> block holding the file's
// lines). This takes it apart again: the words alone, and the chip.
const SELECTION_TAG = /\s*<stacki-selection([^>]*)>[\s\S]*?<\/stacki-selection>/g;
const LEGACY_NOTE = /\s*\(The user is looking at [^)]*\)/g;
const AT_LINK = /\s*\[@[^\]]*\]\(file:\/\/[^)]*\)/g;
const CONTEXT_BLOCK = /\s*<context\b[^>]*>[\s\S]*?<\/context>/g;
const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1].replace(/&quot;/g, '"') : null;
};
export function parseUserText(raw) {
  let attached = null;
  const text = String(raw || '')
    .replace(SELECTION_TAG, (_m, attrs) => {
      const lines = attr(attrs, 'lines');
      const [a, b] = lines ? lines.split(':').map((n) => parseInt(n, 10)) : [];
      attached = { rel: attr(attrs, 'file') || '', label: attr(attrs, 'label'), startLine: a || null, endLine: b || a || null };
      return '';
    })
    .replace(LEGACY_NOTE, '')
    .replace(AT_LINK, '')
    .replace(CONTEXT_BLOCK, '')
    .trim();
  return { text, attached };
}

// Only the fields an update actually carries replace the ones on the block:
// a tool_call_update that says just `status` must not blank out the title.
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

export function applyUpdate(turns, update) {
  const last = turns[turns.length - 1];
  const open = last && last.role === 'agent' ? last : null;
  const withTurn = (mutate) => {
    const turn = open ? { ...open, blocks: [...open.blocks] } : { id: nextId(), role: 'agent', blocks: [] };
    mutate(turn);
    return open ? [...turns.slice(0, -1), turn] : [...turns, turn];
  };
  switch (update?.sessionUpdate) {
    case 'agent_message_chunk':
      return withTurn((t) => appendChunk(t, 'text', update.content));
    case 'agent_thought_chunk':
      return withTurn((t) => appendChunk(t, 'thought', update.content));
    case 'tool_call':
      return withTurn((t) => {
        t.blocks.push({
          id: update.toolCallId,
          type: 'tool',
          title: update.title || 'Tool',
          kind: update.kind || 'other',
          status: update.status || 'pending',
          content: update.content || [],
          locations: update.locations || [],
          rawInput: update.rawInput,
        });
      });
    case 'tool_call_update':
      return withTurn((t) => {
        const i = t.blocks.findIndex((b) => b.type === 'tool' && b.id === update.toolCallId);
        const patch = defined({
          title: update.title,
          kind: update.kind,
          status: update.status,
          content: update.content,
          locations: update.locations,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
        });
        if (i < 0) {
          t.blocks.push({ id: update.toolCallId, type: 'tool', title: 'Tool', kind: 'other', status: 'pending', content: [], locations: [], ...patch });
        } else {
          t.blocks[i] = { ...t.blocks[i], ...patch };
        }
      });
    case 'user_message_chunk': {
      // Only seen when a thread is loaded back: the person's side of it,
      // replayed chunk by chunk like the agent's.
      const text = update.content?.type === 'text' ? stripCommandNoise(update.content.text) : '';
      if (!text) return turns;
      if (last && last.role === 'user') {
        const blocks = [...last.blocks];
        const tail = blocks[blocks.length - 1];
        if (tail?.type === 'text') blocks[blocks.length - 1] = { ...tail, text: tail.text + text };
        else blocks.push({ id: nextId(), type: 'text', text });
        return [...turns.slice(0, -1), { ...last, blocks }];
      }
      return [...turns, { id: nextId(), role: 'user', blocks: [{ id: nextId(), type: 'text', text }], attached: null }];
    }
    case 'plan':
      return withTurn((t) => {
        const block = { id: 'plan', type: 'plan', entries: update.entries || [] };
        const i = t.blocks.findIndex((b) => b.type === 'plan');
        if (i < 0) t.blocks.push(block);
        else t.blocks[i] = block;
      });
    default:
      return turns;
  }
}

// The options the agent advertises, with one of them moved. `config_option_update`
// carries the whole list again; `current_mode_update` only names the mode.
export function withConfigValue(options, configId, value) {
  return (options || []).map((o) => (o.id === configId ? { ...o, currentValue: value } : o));
}

// An update goes to the thread it names, on screen or not.
function handleUpdate(sessionId, update) {
  const t = threadOf(sessionId);
  if (!t) return;
  switch (update?.sessionUpdate) {
    case 'config_option_update':
      patchThread(sessionId, { configOptions: update.configOptions || [] });
      return;
    case 'current_mode_update':
      patchThread(sessionId, { configOptions: withConfigValue(t.configOptions, 'mode', update.currentModeId) });
      return;
    case 'available_commands_update':
      set({ commands: update.availableCommands || [] });
      return;
    case 'usage_update':
      return;
    default:
      patchThread(sessionId, { turns: applyUpdate(t.turns, update) });
  }
}

// --- The bridge to main ---------------------------------------------------------

const avb = () => (typeof window !== 'undefined' ? window.avb : null);

let wired = false;
function wire() {
  const api = avb();
  if (wired || !api?.onAcpUpdate) return;
  wired = true;
  api.onAcpUpdate(({ sessionId, update }) => handleUpdate(sessionId, update));
  api.onAcpPermission((request) => {
    patchThread(request.sessionId, (t) => ({ permissions: [...t.permissions, request] }));
  });
  api.onAcpExit((info) => {
    // A restart kills the agent before it: that exit is the old process's,
    // not this one's, and must not be read as the new agent dying.
    if (!info || info.gen !== snapshot.gen || snapshot.status === 'idle') return;
    const why = info.error || (info.stderr ? info.stderr.split('\n').slice(-3).join('\n') : '');
    const threads = {};
    for (const [id, t] of Object.entries(snapshot.threads)) threads[id] = { ...t, running: false, permissions: [] };
    set({ status: 'exited', threads, error: why ? `The agent exited.\n${why}` : 'The agent exited.' });
  });
}

// Starts the agent afresh in the project, with one new thread — the first
// open, a Restart, and the way back from an error.
export async function start(projectPath) {
  wire();
  local = readLocal(projectPath);
  set({ ...EMPTY, projectPath, status: 'starting' });
  try {
    const r = await avb().acpStart({ projectPath });
    // A later start may have superseded this one while it was on its way.
    if (snapshot.projectPath !== projectPath || snapshot.status !== 'starting') return;
    const t = makeThread(r.sessionId, { loaded: true, configOptions: r.configOptions || [] });
    set({ status: 'ready', gen: r.gen || 0, agentInfo: r.agentInfo || null, currentId: t.id, threads: { [t.id]: t } });
  } catch (err) {
    if (snapshot.projectPath !== projectPath) return;
    set({ status: 'error', error: cleanError(err) });
  }
}

// What the panel calls on mount: a conversation already going for this
// project is left alone; anything else starts one.
export function ensure(projectPath) {
  if (!projectPath) return;
  if (snapshot.projectPath === projectPath && snapshot.status !== 'idle') return;
  void start(projectPath);
}

// A fresh thread on the agent already running; a restart only when there is
// nothing running to ask.
export async function newThread() {
  const { projectPath, status } = snapshot;
  if (!projectPath) return;
  if (status !== 'ready') return start(projectPath);
  try {
    const r = await avb().acpNew();
    const t = makeThread(r.sessionId, { loaded: true, configOptions: r.configOptions || [] });
    set({ currentId: t.id, threads: { ...snapshot.threads, [t.id]: t }, error: null });
  } catch (err) {
    set({ error: cleanError(err) });
  }
}

// Puts a thread on screen. One opened before in this process is just shown;
// one the agent only listed is loaded first — it replays as updates under its
// own id, which is why the entry exists before the request goes.
export async function openThread(id) {
  const t = threadOf(id);
  if (!t || snapshot.status !== 'ready') return;
  if (t.loaded || t.loading) {
    set({ currentId: id, threads: { ...snapshot.threads, [id]: { ...t, unread: false } } });
    return;
  }
  set({ currentId: id, error: null });
  patchThread(id, { loading: true, turns: [], unread: false });
  try {
    const r = await avb().acpLoad({ sessionId: id });
    patchThread(id, { loading: false, loaded: true, configOptions: r?.configOptions || [] });
  } catch (err) {
    patchThread(id, { loading: false });
    set({ error: cleanError(err) });
  }
}

// `attachment` is the canvas selection, resolved to a file and lines by the
// panel: { rel, uri, label, startLine, endLine, text }.
export async function sendPrompt(text, attachment) {
  const t = current();
  if (!t || !t.loaded || t.running || snapshot.status !== 'ready' || !text.trim()) return;
  const id = t.id;
  const prompt = [{ type: 'text', text }];
  let attached = null;
  if (attachment) {
    const lines =
      attachment.startLine && attachment.endLine
        ? attachment.startLine === attachment.endLine
          ? `line ${attachment.startLine}`
          : `lines ${attachment.startLine}–${attachment.endLine}`
        : null;
    const shown = attachment.label ? `, the element the canvas shows as “${attachment.label}”` : '';
    // Tagged, because Claude Code records the whole prompt and replays it as
    // the user's words when the thread is loaded back — parseUserText turns
    // this back into the chip it came from rather than showing it as typed.
    const attrs =
      ` file="${attachment.rel}"` +
      (attachment.label ? ` label="${attachment.label.replace(/"/g, '&quot;')}"` : '') +
      (attachment.startLine && attachment.endLine ? ` lines="${attachment.startLine}:${attachment.endLine}"` : '');
    prompt.push({
      type: 'text',
      text:
        `\n\n<stacki-selection${attrs}>\nThe user is looking at ${attachment.rel}${lines ? `, ${lines}` : ''}${shown}, ` +
        `on Stacki's canvas — that selection is what this message is about.\n</stacki-selection>`,
    });
    if (attachment.text != null) {
      prompt.push({ type: 'resource', resource: { uri: attachment.uri, mimeType: 'text/plain', text: attachment.text } });
    } else {
      prompt.push({ type: 'resource_link', uri: attachment.uri, name: attachment.rel });
    }
    attached = { rel: attachment.rel, label: attachment.label || null, startLine: attachment.startLine, endLine: attachment.endLine };
  }
  patchThread(id, (th) => ({
    turns: [...th.turns, { id: nextId(), role: 'user', blocks: [{ id: nextId(), type: 'text', text }], attached }],
    running: true,
    updatedAt: new Date().toISOString(),
  }));
  set({ error: null });
  try {
    await avb().acpPrompt({ sessionId: id, prompt });
  } catch (err) {
    if (threadOf(id)) set({ error: cleanError(err) });
  } finally {
    // An answer that landed while another thread was on screen is unread.
    patchThread(id, { running: false, permissions: [], unread: snapshot.currentId !== id, updatedAt: new Date().toISOString() });
  }
}

export async function cancel() {
  const t = current();
  if (!t) return;
  try {
    await avb().acpCancel({ sessionId: t.id });
  } catch {
    /* the prompt's own rejection reports it */
  }
}

export async function setConfig(configId, value) {
  const t = current();
  if (!t) return;
  // Optimistic: the dropdown shows the pick at once; the agent's answer, when
  // it carries the list, is what stays.
  patchThread(t.id, { configOptions: withConfigValue(t.configOptions, configId, value) });
  try {
    const result = await avb().acpSetConfig({ sessionId: t.id, configId, value });
    if (result?.configOptions) patchThread(t.id, { configOptions: result.configOptions });
  } catch (err) {
    set({ error: cleanError(err) });
  }
}

export async function answerPermission(requestId, optionId) {
  for (const t of Object.values(snapshot.threads)) {
    if (t.permissions.some((p) => p.requestId === requestId)) {
      patchThread(t.id, { permissions: t.permissions.filter((p) => p.requestId !== requestId) });
    }
  }
  try {
    await avb().acpPermission({ requestId, optionId });
  } catch {
    /* the agent has gone; its exit says so */
  }
}

// Asks the agent what it remembers for this project and folds it in: a thread
// already here keeps its turns and its name, one only the agent knows joins.
export async function listThreads() {
  if (snapshot.status !== 'ready') return;
  set({ listing: true });
  try {
    const r = await avb().acpList();
    const threads = { ...snapshot.threads };
    for (const s of r?.sessions || []) {
      const have = threads[s.sessionId];
      const later = have && have.updatedAt > s.updatedAt ? have.updatedAt : s.updatedAt;
      threads[s.sessionId] = have
        ? { ...have, agentTitle: s.title || '', title: local.names[s.sessionId] || s.title || '', updatedAt: later || have.updatedAt }
        : makeThread(s.sessionId, { agentTitle: s.title || '', title: local.names[s.sessionId] || s.title || '', updatedAt: s.updatedAt });
    }
    set({ threads, listing: false });
  } catch (err) {
    set({ listing: false, error: cleanError(err) });
  }
}

export function renameThread(id, name) {
  const t = threadOf(id);
  if (!t) return;
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (clean) local.names[id] = clean;
  else delete local.names[id];
  writeLocal();
  patchThread(id, { title: clean || t.agentTitle || '' });
}

// Archiving the thread on screen opens a fresh one in its place.
export function archiveThread(id, on = true) {
  const t = threadOf(id);
  if (!t) return;
  local.archived = local.archived.filter((x) => x !== id);
  if (on) local.archived.push(id);
  writeLocal();
  patchThread(id, { archived: on });
  if (on && snapshot.currentId === id) void newThread();
}

export function clearError() {
  set({ error: null });
}
