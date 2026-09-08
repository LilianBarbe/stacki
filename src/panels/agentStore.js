// The agent conversation, kept outside the panel.
//
// The left panel unmounts whenever another rail tab opens, and a thread that
// vanished the moment you glanced at the navigator would be no thread at all.
// So the session, the turns and the questions the agent is waiting on live
// here, and the panel is a view of them: it mounts, subscribes, and finds the
// conversation where it left it — including whatever the agent said while the
// panel was closed. The agent process in main outlives the panel the same way;
// a project switch, a New Thread, or the app closing retires it.
//
// The pure part — how a stream of session/update notifications becomes turns
// and blocks — is `applyUpdate`, exported so it can be tested without a DOM.

import { cleanError } from '../cleanError.js';

let seq = 0;
const nextId = () => `t${++seq}`;

const EMPTY = {
  projectPath: null,
  status: 'idle', // idle | starting | ready | error | exited
  error: null,
  session: null, // { sessionId, agentInfo, configOptions, ... } from main
  turns: [], // [{ id, role: 'user' | 'agent', blocks, attached? }]
  permissions: [], // requests the agent is waiting on, oldest first
  commands: [], // slash commands the agent advertises
  running: false, // a prompt is in flight
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

// --- Turning updates into turns -------------------------------------------

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

function handleUpdate(update) {
  switch (update?.sessionUpdate) {
    case 'config_option_update':
      set({ session: { ...snapshot.session, configOptions: update.configOptions || [] } });
      return;
    case 'current_mode_update':
      set({ session: { ...snapshot.session, configOptions: withConfigValue(snapshot.session?.configOptions, 'mode', update.currentModeId) } });
      return;
    case 'available_commands_update':
      set({ commands: update.availableCommands || [] });
      return;
    case 'usage_update':
      return;
    default:
      set({ turns: applyUpdate(snapshot.turns, update) });
  }
}

// --- The bridge to main -----------------------------------------------------

const avb = () => (typeof window !== 'undefined' ? window.avb : null);
const mine = (sessionId) => !!snapshot.session && snapshot.session.sessionId === sessionId;

let wired = false;
function wire() {
  const api = avb();
  if (wired || !api?.onAcpUpdate) return;
  wired = true;
  api.onAcpUpdate(({ sessionId, update }) => {
    if (mine(sessionId)) handleUpdate(update);
  });
  api.onAcpPermission((request) => {
    if (mine(request.sessionId)) set({ permissions: [...snapshot.permissions, request] });
  });
  api.onAcpExit((info) => {
    // A restart kills the agent before it: that exit is the old session's,
    // not this one's, and must not be read as the new agent dying.
    if (!mine(info?.sessionId)) return;
    const why = info?.error || (info?.stderr ? info.stderr.split('\n').slice(-3).join('\n') : '');
    set({
      status: 'exited',
      running: false,
      permissions: [],
      error: why ? `The agent exited.\n${why}` : 'The agent exited.',
    });
  });
}

// Starts a fresh session in the project — also what New Thread does.
export async function start(projectPath) {
  wire();
  set({ ...EMPTY, projectPath, status: 'starting' });
  try {
    const session = await avb().acpStart({ projectPath });
    // A later start may have superseded this one while it was on its way.
    if (snapshot.projectPath !== projectPath || snapshot.status !== 'starting') return;
    set({ session, status: 'ready' });
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

// `attachment` is the canvas selection, resolved to a file and lines by the
// panel: { rel, uri, startLine, endLine, text }.
export async function sendPrompt(text, attachment) {
  const { session, running } = snapshot;
  if (!session || running || !text.trim()) return;
  const prompt = [{ type: 'text', text }];
  let attached = null;
  if (attachment) {
    const lines =
      attachment.startLine && attachment.endLine
        ? attachment.startLine === attachment.endLine
          ? `line ${attachment.startLine}`
          : `lines ${attachment.startLine}–${attachment.endLine}`
        : null;
    prompt.push({
      type: 'text',
      text:
        `\n\n(The user is looking at ${attachment.rel}${lines ? `, ${lines},` : ''} on Stacki's canvas — ` +
        `that selection is what this message is about.)`,
    });
    if (attachment.text != null) {
      prompt.push({
        type: 'resource',
        resource: { uri: attachment.uri, mimeType: 'text/plain', text: attachment.text },
      });
    } else {
      prompt.push({ type: 'resource_link', uri: attachment.uri, name: attachment.rel });
    }
    attached = { rel: attachment.rel, startLine: attachment.startLine, endLine: attachment.endLine };
  }
  set({
    turns: [...snapshot.turns, { id: nextId(), role: 'user', blocks: [{ id: nextId(), type: 'text', text }], attached }],
    running: true,
    error: null,
  });
  try {
    await avb().acpPrompt({ sessionId: session.sessionId, prompt });
  } catch (err) {
    if (mine(session.sessionId)) set({ error: cleanError(err) });
  } finally {
    if (mine(session.sessionId)) set({ running: false, permissions: [] });
  }
}

export async function cancel() {
  const { session } = snapshot;
  if (!session) return;
  try {
    await avb().acpCancel({ sessionId: session.sessionId });
  } catch {
    /* the prompt's own rejection reports it */
  }
}

export async function setConfig(configId, value) {
  const { session } = snapshot;
  if (!session) return;
  // Optimistic: the dropdown shows the pick at once; the agent's answer, when
  // it carries the list, is what stays.
  set({ session: { ...session, configOptions: withConfigValue(session.configOptions, configId, value) } });
  try {
    const result = await avb().acpSetConfig({ sessionId: session.sessionId, configId, value });
    if (result?.configOptions && mine(session.sessionId)) {
      set({ session: { ...snapshot.session, configOptions: result.configOptions } });
    }
  } catch (err) {
    if (mine(session.sessionId)) set({ error: cleanError(err) });
  }
}

export async function answerPermission(requestId, optionId) {
  set({ permissions: snapshot.permissions.filter((p) => p.requestId !== requestId) });
  try {
    await avb().acpPermission({ requestId, optionId });
  } catch {
    /* the agent has gone; its exit says so */
  }
}

// A fresh thread on the agent already running; a restart only when there is
// nothing running to ask.
export async function newThread() {
  const { projectPath, session, status } = snapshot;
  if (!projectPath) return;
  if (!session || status !== 'ready') return start(projectPath);
  set({ status: 'starting', turns: [], permissions: [], error: null, running: false });
  try {
    const next = await avb().acpNew();
    set({ session: { ...session, ...next }, status: 'ready' });
  } catch (err) {
    set({ status: 'error', error: cleanError(err) });
  }
}

// The threads the agent remembers for this project, newest first. A thread
// exists from its first message, so a fresh one is not in the list yet.
export async function listThreads() {
  if (!snapshot.session) return [];
  try {
    const result = await avb().acpList();
    return (result?.sessions || []).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } catch (err) {
    set({ error: cleanError(err) });
    return [];
  }
}

// Loads a thread back. The agent replays it as updates under the loaded id,
// so that id is the live one from here on — set before the request goes, or
// the replay would be filtered out as some other session's.
export async function loadThread(sessionId) {
  const { session, status, running } = snapshot;
  if (!session || running || status !== 'ready' || sessionId === session.sessionId) return;
  set({ session: { ...session, sessionId }, status: 'starting', turns: [], permissions: [], error: null });
  try {
    const next = await avb().acpLoad({ sessionId });
    set({ session: { ...snapshot.session, ...next }, status: 'ready' });
  } catch (err) {
    set({ status: 'error', error: cleanError(err) });
  }
}

export function clearError() {
  set({ error: null });
}
