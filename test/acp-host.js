// The ACP host: the app as a client of a coding agent.
//
//   node test/acp-host.js
//
// electron/acp.js speaks JSON-RPC over an agent's stdio. What has to hold, and
// is checked here against a fake agent written for the purpose (so no Claude,
// no network, no login):
//
//  - the handshake returns the session with the config options the agent
//    advertises — the panel's dropdowns come from nowhere else.
//  - session/update notifications reach the update callback in order.
//  - the agent's file reads and writes are served, and confined to the
//    project: a path outside it gets an error, not a file.
//  - a permission request waits for the answer; cancelling the turn answers
//    every open one with "cancelled" so the agent can stop waiting.
//  - a dead agent rejects what was in flight and reports its exit once.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { AcpAgent, openSession, agentEnv, findClaudeCli, insideRoot } = require('../electron/acp.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

// A fake agent: answers the handshake, and on a prompt exercises the client —
// two writes (one inside the project, one outside), a read, a permission
// request — then reports what each returned in a final text chunk, as JSON,
// so the test can read the client's answers back from the agent's side.
const FAKE_AGENT = `
const readline = require('node:readline');
let seq = 0;
const pending = new Map();
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const request = (method, params) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); out({ jsonrpc: '2.0', id, method, params }); });
const update = (sessionId, update) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
const text = (sessionId, t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
  const reply = (result) => out({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      reply({ protocolVersion: 1, agentInfo: { name: 'fake', version: '0' }, agentCapabilities: {} });
      break;
    case 'session/new':
      reply({ sessionId: 's1', configOptions: [
        { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default',
          options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] },
      ] });
      break;
    case 'session/set_config_option':
      reply({ configOptions: [{ id: m.params.configId, currentValue: m.params.value }] });
      break;
    case 'session/prompt': {
      const sid = m.params.sessionId;
      const asked = m.params.prompt.map((b) => b.text).join('');
      if (asked === 'hang') {
        const perm = await request('session/request_permission', { sessionId: sid,
          toolCall: { toolCallId: 't2', title: 'wait' }, options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }] });
        reply({ stopReason: perm.result.outcome.outcome === 'cancelled' ? 'cancelled' : 'end_turn' });
        break;
      }
      text(sid, 'hello ');
      const inside = await request('fs/write_text_file', { sessionId: sid, path: process.env.FAKE_INSIDE, content: 'written by agent' });
      const outside = await request('fs/write_text_file', { sessionId: sid, path: process.env.FAKE_OUTSIDE, content: 'nope' });
      const read = await request('fs/read_text_file', { sessionId: sid, path: process.env.FAKE_INSIDE, line: 1, limit: 1 });
      const perm = await request('session/request_permission', { sessionId: sid,
        toolCall: { toolCallId: 't1', title: 'rm -rf /', kind: 'execute' },
        options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }, { optionId: 'reject', kind: 'reject_once', name: 'Reject' }] });
      const unknown = await request('terminal/create', { sessionId: sid, command: 'ls' });
      text(sid, JSON.stringify({ inside, outside, read, perm, unknown }));
      reply({ stopReason: 'end_turn' });
      break;
    }
    case 'session/cancel':
      break;
    default:
      out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
  }
});
`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-acp-'));
  const root = path.join(dir, 'project');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const fake = path.join(dir, 'fake-agent.js');
  fs.writeFileSync(fake, FAKE_AGENT);
  const inside = path.join(root, 'src', 'made-by-agent.txt');
  const outside = path.join(dir, 'escaped.txt');

  // --- The environment the agent gets ---------------------------------------
  const env = agentEnv({ PATH: '/usr/bin', CLAUDECODE: '1', npm_config_x: 'y', HOME: '/h' });
  check('CLAUDECODE is stripped, so Claude Code does not refuse a nested start', !('CLAUDECODE' in env));
  check('npm_* vars are stripped', !('npm_config_x' in env));
  check('the rest of the environment is kept', env.PATH === '/usr/bin' && env.HOME === '/h');

  // --- Finding Claude Code ----------------------------------------------------
  const fakeHome = path.join(dir, 'home');
  const onPath = path.join(dir, 'bin');
  fs.mkdirSync(onPath, { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.claude', 'local', 'bin'), { recursive: true });
  check('no CLI anywhere means none', findClaudeCli({ PATH: onPath }, fakeHome) === null);
  fs.writeFileSync(path.join(fakeHome, '.claude', 'local', 'bin', 'claude'), '');
  check('the local install is found when PATH has none', findClaudeCli({ PATH: onPath }, fakeHome) === path.join(fakeHome, '.claude', 'local', 'bin', 'claude'));
  fs.writeFileSync(path.join(onPath, 'claude'), '');
  check('one on PATH wins', findClaudeCli({ PATH: onPath }, fakeHome) === path.join(onPath, 'claude'));
  fs.mkdirSync(path.join(dir, 'dirnamed', 'claude'), { recursive: true });
  check('a directory called claude is not it', findClaudeCli({ PATH: path.join(dir, 'dirnamed') }, path.join(dir, 'nohome')) === null);

  // --- Containment ----------------------------------------------------------
  check('a path inside the project resolves', insideRoot(root, path.join(root, 'a.txt')) === path.join(root, 'a.txt'));
  let refused = null;
  try {
    insideRoot(root, path.join(root, '..', 'escaped.txt'));
  } catch (err) {
    refused = err;
  }
  check('a path that climbs out of the project is refused', !!refused && /outside the open project/.test(refused.message));

  // --- Handshake ------------------------------------------------------------
  const updates = [];
  const permissions = [];
  const exits = [];
  const agent = new AcpAgent({
    command: process.execPath,
    args: [fake],
    cwd: root,
    env: { ...process.env, FAKE_INSIDE: inside, FAKE_OUTSIDE: outside },
    projectRoot: root,
    onUpdate: (p) => updates.push(p),
    onPermission: (p) => permissions.push(p),
    onExit: (info) => exits.push(info),
  }).start();

  const session = await openSession(agent, { cwd: root, version: 'test' });
  check('the session id comes back', session.sessionId === 's1');
  check('the agent identifies itself', session.agentInfo?.name === 'fake');
  check(
    'the config options the agent advertises come back as-is',
    session.configOptions.length === 1 && session.configOptions[0].id === 'mode' && session.configOptions[0].options.length === 2
  );

  // --- A turn ---------------------------------------------------------------
  // Answer the permission request as soon as it shows up, the way the panel
  // would once the person clicks.
  const answering = (async () => {
    while (!permissions.length) await new Promise((r) => setTimeout(r, 5));
    const req = permissions[0];
    check('the permission request carries the tool call and its options', req.toolCall?.toolCallId === 't1' && req.options?.length === 2);
    check('the request has an id to answer it by', typeof req.requestId === 'string');
    check('answering it succeeds', agent.answerPermission(req.requestId, { outcome: 'selected', optionId: 'reject' }));
    check('answering it twice does not', !agent.answerPermission(req.requestId, { outcome: 'selected', optionId: 'allow' }));
  })();
  const result = await agent.request('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] });
  await answering;
  check('the prompt resolves with the stop reason', result.stopReason === 'end_turn');

  const texts = updates.map((u) => u.update?.content?.text).filter(Boolean);
  check('the update stream arrives in order', texts[0] === 'hello ' && texts.length === 2);
  let seen = {};
  try {
    seen = JSON.parse(texts[1]);
  } catch {
    /* checked below */
  }
  check('a write inside the project lands', fs.existsSync(inside) && fs.readFileSync(inside, 'utf8') === 'written by agent');
  check('the agent saw the write succeed', seen.inside && !seen.inside.error);
  check('a write outside the project does not land', !fs.existsSync(outside));
  check('the agent saw it refused', seen.outside?.error && /outside the open project/.test(seen.outside.error.message));
  check('a read with line/limit returns those lines', seen.read?.result?.content === 'written by agent');
  check('the agent got the permission answer', seen.perm?.result?.outcome?.optionId === 'reject');
  check('a method the client does not serve gets "method not found"', seen.unknown?.error?.code === -32601);

  // --- Cancelling a turn answers what was being asked ---------------------
  const hanging = agent.request('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'hang' }] });
  while (permissions.length < 2) await new Promise((r) => setTimeout(r, 5));
  agent.notify('session/cancel', { sessionId: 's1' });
  agent.cancelPermissions();
  const cancelled = await hanging;
  check('cancelling answers the open permission request so the agent can stop', cancelled.stopReason === 'cancelled');

  // --- An agent error surfaces as a rejection with its code ----------------
  let errored = null;
  try {
    await agent.request('session/no_such_thing', {});
  } catch (err) {
    errored = err;
  }
  check('an error from the agent rejects with its code', errored && errored.code === -32601);

  // --- Exit ---------------------------------------------------------------
  const inFlight = agent.request('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'hang' }] });
  while (permissions.length < 3) await new Promise((r) => setTimeout(r, 5));
  agent.kill();
  let died = null;
  try {
    await inFlight;
  } catch (err) {
    died = err;
  }
  check('killing the agent rejects what was in flight', !!died);
  while (!exits.length) await new Promise((r) => setTimeout(r, 5));
  check('the exit is reported once', exits.length === 1);
  check('a request after the exit is refused', await agent.request('x', {}).then(() => false, () => true));

  fs.rmSync(dir, { recursive: true, force: true });

  if (failures.length) {
    console.error(`acp-host: ${failures.length} of ${checked} checks failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`acp-host: ${checked} checks passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
