// A coding agent in the left panel, spoken to over the Agent Client Protocol.
//
// ACP is JSON-RPC over the agent's stdin/stdout, one JSON object per line —
// the protocol Zed and JetBrains host their agent panels on. The app is the
// CLIENT: it starts the agent, opens a session in the project, sends prompts,
// and streams what comes back to the renderer. And it serves the agent too:
// when the agent wants to read or write a file it asks the client, which is
// what lets every write land through the app rather than around it. The
// watcher in main.js then sees the change exactly as it sees an editor's.
//
// Nothing in here depends on Electron — the IPC registration takes `ipcMain`
// and `send` as arguments — so a plain Node test can drive AcpAgent against a
// fake agent (see test/acp-host.js).
//
// One agent process, one session, at a time: the panel is a conversation
// about the open project, and a project switch retires it.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PROTOCOL_VERSION = 1;
const STDERR_KEEP = 4000; // the tail of stderr, for the error a dead agent left

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

// The one containment rule, same as the asset protocol's: the agent reads and
// writes inside the open project and nowhere else.
function insideRoot(root, p) {
  const abs = path.resolve(root, String(p || ''));
  if (abs === root || abs.startsWith(root + path.sep)) return abs;
  throw new RpcError(INVALID_PARAMS, 'Refusing to touch a file outside the open project.');
}

// The environment the agent runs in. Electron's fingerprints come off it the
// way they do for the terminal, plus one that matters here: Claude Code
// refuses to start inside another Claude Code session, and `npm run dev`
// launched from one carries CLAUDECODE into everything the app spawns.
function agentEnv(base = process.env) {
  const env = { ...base };
  for (const key of [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS',
    'NODE_PATH',
    'INIT_CWD',
    'VITE_DEV_SERVER_URL',
  ]) {
    delete env[key];
  }
  for (const key of Object.keys(env)) if (key.startsWith('npm_')) delete env[key];
  return env;
}

// ---------------------------------------------------------------------------
// The agent process
// ---------------------------------------------------------------------------

class AcpAgent {
  // `onUpdate(params)` gets every session/update; `onPermission(request)` gets
  // a permission request carrying a `requestId` to answer it by; `onExit(info)`
  // fires once, when the process is gone.
  constructor({ command, args = [], cwd, env, projectRoot, onUpdate, onPermission, onExit }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.root = path.resolve(projectRoot);
    this.onUpdate = onUpdate || (() => {});
    this.onPermission = onPermission || (() => {});
    this.onExit = onExit || (() => {});
    this.proc = null;
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, reject }
    this.permSeq = 0;
    this.permissions = new Map(); // requestId -> resolve
    this.exited = null;
    this.stderr = '';
  }

  start() {
    const proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    proc.on('error', (err) => this.finish({ code: null, signal: null, error: err.message }));
    proc.on('exit', (code, signal) => this.finish({ code, signal }));
    proc.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_KEEP);
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // not ours — an agent that printed to stdout by mistake
      }
      this.handle(msg);
    });
    return this;
  }

  finish(info) {
    if (this.exited) return;
    this.exited = info;
    const why = new Error(info.error || 'The agent exited.');
    for (const { reject } of this.pending.values()) reject(why);
    this.pending.clear();
    this.cancelPermissions();
    this.onExit({ ...info, stderr: this.stderrTail() });
  }

  stderrTail() {
    return this.stderr.trim();
  }

  write(msg) {
    if (this.exited || !this.proc?.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
    return true;
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error('The agent exited.'));
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  handle(msg) {
    if (msg.method) {
      void this.incoming(msg);
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      const { code, message, data } = msg.error;
      entry.reject(new RpcError(code, message || 'The agent returned an error.', data));
    } else {
      entry.resolve(msg.result);
    }
  }

  // A request (has an id) or a notification (doesn't) from the agent.
  async incoming({ id, method, params }) {
    let result;
    try {
      result = await this.serve(method, params || {});
    } catch (err) {
      if (id === undefined) return;
      const code = err instanceof RpcError ? err.code : INTERNAL_ERROR;
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code, message: err.message, ...(err.data !== undefined && { data: err.data }) },
      });
      return;
    }
    if (id !== undefined) this.write({ jsonrpc: '2.0', id, result: result ?? null });
  }

  serve(method, params) {
    switch (method) {
      case 'session/update':
        this.onUpdate(params);
        return null;
      case 'session/request_permission':
        return this.askPermission(params);
      case 'fs/read_text_file':
        return this.readTextFile(params);
      case 'fs/write_text_file':
        return this.writeTextFile(params);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  // The agent waits on this until the person answers — or the turn is
  // cancelled, which answers every open question with "cancelled".
  askPermission(params) {
    const requestId = `perm-${++this.permSeq}`;
    return new Promise((resolve) => {
      this.permissions.set(requestId, resolve);
      this.onPermission({ requestId, ...params });
    });
  }

  answerPermission(requestId, outcome) {
    const resolve = this.permissions.get(requestId);
    if (!resolve) return false;
    this.permissions.delete(requestId);
    resolve({ outcome });
    return true;
  }

  cancelPermissions() {
    for (const resolve of this.permissions.values()) resolve({ outcome: { outcome: 'cancelled' } });
    this.permissions.clear();
  }

  // `line` is 1-based and `limit` a number of lines, both optional.
  readTextFile({ path: p, line, limit }) {
    const abs = insideRoot(this.root, p);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      throw new RpcError(INVALID_PARAMS, `Cannot read ${p}: ${err.message}`);
    }
    if (line === undefined && limit === undefined) return { content: text };
    const lines = text.split('\n');
    const start = Math.max(0, (line || 1) - 1);
    const end = limit === undefined ? undefined : start + limit;
    return { content: lines.slice(start, end).join('\n') };
  }

  writeTextFile({ path: p, content }) {
    const abs = insideRoot(this.root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content ?? ''), 'utf8');
    return null;
  }

  kill() {
    if (this.proc && !this.exited) {
      try {
        this.proc.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

// The handshake, then a session in the project. What comes back is what the
// panel builds its controls from: the config options the agent advertises
// (mode, model — and effort, the day the adapter offers it).
async function openSession(agent, { cwd, version }) {
  const init = await agent.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    clientInfo: { name: 'stacki', title: 'Stacki', version: version || '0.0.0' },
  });
  const session = await agent.request('session/new', { cwd, mcpServers: [] });
  return {
    agentInfo: init.agentInfo || null,
    agentCapabilities: init.agentCapabilities || {},
    authMethods: init.authMethods || [],
    ...sessionResult(session),
  };
}

// What a session/new or session/load answer carries that the panel keeps.
function sessionResult(session) {
  return {
    sessionId: session.sessionId,
    configOptions: session.configOptions || [],
    modes: session.modes || null,
    models: session.models || null,
  };
}

// ---------------------------------------------------------------------------
// Which agent
// ---------------------------------------------------------------------------

// Claude Agent, through Zed's ACP adapter, which ships as a dependency. The
// adapter spawns Node on Claude Code's own CLI, and Node cannot read inside an
// asar — so the packaged app keeps an unpacked copy beside the archive (see
// `asarUnpack` in package.json) and runs that one.
function claudeAdapterEntry() {
  const pkgPath = require.resolve('@zed-industries/claude-agent-acp/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin['claude-agent-acp'];
  if (!rel) throw new Error('The Claude Agent adapter has no entry point.');
  return path
    .join(path.dirname(pkgPath), rel)
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerAcpHandlers(ipcMain, { send, resolveNodeBin, version }) {
  let current = null; // { agent, root, sessionId, gen }
  // Counts agent processes. A restart kills one and starts the next, and the
  // exit of the first arrives while the second is coming up — the renderer
  // tells them apart by this.
  let gen = 0;

  const stopCurrent = () => {
    if (!current) return;
    const { agent } = current;
    current = null;
    agent.cancelPermissions();
    agent.kill();
  };

  // Every thread opened on the live agent stays open on it, so any of their
  // ids may be spoken to; the agent itself refuses one it does not know.
  const live = () => {
    if (!current) throw new Error('The agent is not running.');
    return current.agent;
  };

  ipcMain.handle('acp:start', async (_e, { projectPath } = {}) => {
    if (!projectPath) throw new Error('No project is open.');
    stopCurrent();
    const root = path.resolve(projectPath);
    const node = resolveNodeBin();
    if (!node) throw new Error('Node was not found on your PATH — Claude Agent runs on it.');
    const entry = claudeAdapterEntry();
    const thisGen = ++gen;
    const agent = new AcpAgent({
      command: node,
      args: [entry],
      cwd: root,
      env: agentEnv(),
      projectRoot: root,
      onUpdate: (params) => send('acp:update', params),
      onPermission: (request) => send('acp:permission', request),
      onExit: (info) => {
        if (current && current.agent === agent) current = null;
        send('acp:exit', { ...info, gen: thisGen });
      },
    }).start();
    current = { agent, root, sessionId: null, gen: thisGen };
    try {
      const session = await openSession(agent, { cwd: root, version });
      agent.sessionId = session.sessionId;
      if (current && current.agent === agent) current.sessionId = session.sessionId;
      return { ...session, gen: thisGen };
    } catch (err) {
      const tail = agent.stderrTail();
      if (current && current.agent === agent) stopCurrent();
      throw new Error(tail ? `${err.message}\n${tail}` : err.message);
    }
  });

  ipcMain.handle('acp:prompt', async (_e, { sessionId, prompt } = {}) => {
    const agent = live();
    return agent.request('session/prompt', { sessionId, prompt });
  });

  ipcMain.handle('acp:cancel', async (_e, { sessionId } = {}) => {
    const agent = live();
    agent.notify('session/cancel', { sessionId });
    agent.cancelPermissions();
    return { ok: true };
  });

  // Config options first; the older per-thing methods for an agent that
  // predates them.
  ipcMain.handle('acp:setConfig', async (_e, { sessionId, configId, value } = {}) => {
    const agent = live();
    try {
      return await agent.request('session/set_config_option', { sessionId, configId, value });
    } catch (err) {
      if (err.code !== METHOD_NOT_FOUND) throw err;
      if (configId === 'mode') {
        await agent.request('session/set_mode', { sessionId, modeId: value });
        return null;
      }
      if (configId === 'model') {
        await agent.request('unstable_setSessionModel', { sessionId, modelId: value });
        return null;
      }
      throw err;
    }
  });

  ipcMain.handle('acp:permission', async (_e, { requestId, optionId } = {}) => {
    if (!current) return { ok: false };
    const outcome = optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
    return { ok: current.agent.answerPermission(requestId, outcome) };
  });

  // A fresh thread on the agent already running — cheaper than a restart, and
  // the thread it leaves stays where the history can find it.
  ipcMain.handle('acp:new', async () => {
    const agent = live();
    const session = await agent.request('session/new', { cwd: current.root, mcpServers: [] });
    agent.sessionId = session.sessionId;
    current.sessionId = session.sessionId;
    return sessionResult(session);
  });

  // The threads the agent remembers for this project, newest first is the
  // renderer's business.
  ipcMain.handle('acp:list', async () => {
    const agent = live();
    const result = await agent.request('session/list', { cwd: current.root });
    return { sessions: (result && result.sessions) || [] };
  });

  // Loads a thread back. The agent replays it as session/update notifications
  // under that id BEFORE answering — the renderer has the thread ready for them.
  ipcMain.handle('acp:load', async (_e, { sessionId } = {}) => {
    const agent = live();
    const result = await agent.request('session/load', { sessionId, cwd: current.root, mcpServers: [] });
    agent.sessionId = sessionId;
    current.sessionId = sessionId;
    return sessionResult({ ...(result || {}), sessionId });
  });

  ipcMain.handle('acp:stop', async () => {
    stopCurrent();
    return { ok: true };
  });

  return { cleanup: stopCurrent };
}

module.exports = {
  AcpAgent,
  RpcError,
  openSession,
  agentEnv,
  insideRoot,
  registerAcpHandlers,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
};
