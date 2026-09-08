// The agent conversation's reducer: a stream of ACP session/update
// notifications becoming turns and blocks.
//
//   node test/agent-store.js
//
// The Agent panel shows whatever electron/acp.js relays from the agent, and
// three things about how that stream is folded are easy to break quietly:
//
//  - streamed text is ONE block, not one per chunk — and a thought chunk
//    arriving mid-answer starts its own block rather than joining the text.
//  - a tool_call_update carries only what changed; a status-only update must
//    not blank the title, the locations or the output it did not mention.
//  - an agent turn is opened by the first update after the user's, and the
//    user's own turn is never appended to.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundle = path.join(buildDir, 'agent-store.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export { applyUpdate, withConfigValue } from './src/panels/agentStore.js';\n`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'js',
    },
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { applyUpdate, withConfigValue } = require(bundle);

  const text = (t) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
  const thought = (t) => ({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: t } });

  // --- Streaming --------------------------------------------------------------
  const user = { id: 'u1', role: 'user', blocks: [{ id: 'b', type: 'text', text: 'hi' }] };
  let turns = [user];
  turns = applyUpdate(turns, text('Hel'));
  turns = applyUpdate(turns, text('lo'));
  check('the first update after the user opens an agent turn', turns.length === 2 && turns[1].role === 'agent');
  check('the user turn is left alone', turns[0] === user);
  check('streamed text is one block', turns[1].blocks.length === 1 && turns[1].blocks[0].text === 'Hello');

  turns = applyUpdate(turns, thought('hmm'));
  turns = applyUpdate(turns, thought(' yes'));
  turns = applyUpdate(turns, text(' world'));
  check(
    'a thought in the middle is its own block, and the text after it another',
    turns[1].blocks.map((b) => b.type).join(',') === 'text,thought,text' && turns[1].blocks[1].text === 'hmm yes' && turns[1].blocks[2].text === ' world'
  );
  check('an update does not mutate the previous snapshot', turns[1].blocks.length === 3);

  // --- Tool calls --------------------------------------------------------------
  turns = applyUpdate(turns, {
    sessionUpdate: 'tool_call',
    toolCallId: 't1',
    title: 'Read note.txt',
    kind: 'read',
    status: 'pending',
    locations: [{ path: '/p/src/note.txt' }],
  });
  turns = applyUpdate(turns, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });
  let tool = turns[1].blocks.find((b) => b.type === 'tool');
  check('a status-only update keeps the title', tool.title === 'Read note.txt' && tool.status === 'in_progress');
  check('...and the locations', tool.locations.length === 1);
  turns = applyUpdate(turns, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 't1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'hello' } }],
  });
  tool = turns[1].blocks.find((b) => b.type === 'tool');
  check('the output lands when it arrives', tool.status === 'completed' && tool.content[0].content.text === 'hello');
  turns = applyUpdate(turns, { sessionUpdate: 'tool_call_update', toolCallId: 't9', status: 'failed', title: 'Late' });
  check('an update for a call never announced still shows up', turns[1].blocks.some((b) => b.id === 't9' && b.status === 'failed'));

  // --- Plan --------------------------------------------------------------------
  turns = applyUpdate(turns, { sessionUpdate: 'plan', entries: [{ content: 'a', status: 'pending' }] });
  turns = applyUpdate(turns, { sessionUpdate: 'plan', entries: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
  const plans = turns[1].blocks.filter((b) => b.type === 'plan');
  check('a new plan replaces the old one rather than stacking', plans.length === 1 && plans[0].entries.length === 2);

  // --- Unknown updates ---------------------------------------------------------
  const before = turns;
  turns = applyUpdate(turns, { sessionUpdate: 'usage_update', used: 12 });
  check('an update the panel has no block for changes nothing', turns === before);

  // --- Config values -----------------------------------------------------------
  const opts = [{ id: 'mode', currentValue: 'default' }, { id: 'model', currentValue: 'sonnet' }];
  const moved = withConfigValue(opts, 'mode', 'plan');
  check('a config change moves the one option', moved[0].currentValue === 'plan' && moved[1] === opts[1]);
  check('...without touching the original', opts[0].currentValue === 'default');

  if (failures.length) {
    console.error(`agent-store: ${failures.length} of ${checked} checks failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`agent-store: ${checked} checks passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
