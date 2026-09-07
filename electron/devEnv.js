// The environment `astro dev` is spawned into.
//
// Astro 7 asks am-i-vibing whether it is being run by a coding agent, and if
// it thinks so it runs the dev server as a background daemon with JSON logs:
// the CLI forks, prints a line, and exits. That is a good default for an agent
// — nobody is watching a pipe — and the wrong one here twice over. The pipe
// this app reads is the preview's own health check and the source of the dock's
// Astro tab, so a daemonised server leaves both blank; and the detection is
// made of inherited environment variables, so whether it fires depends on what
// launched Stacki rather than on anything Stacki did. Opened from the Dock the
// server runs in the foreground; opened from a terminal inside Claude Code,
// Codex or Cursor, the same project goes silent.
//
// Dropping the markers is most of the fix, but not all of it: am-i-vibing also
// walks the process tree, so Stacki launched from an agent's own shell is still
// detected through its ancestry, which no environment can hide. The rest is
// ASTRO_DEV_BACKGROUND — the flag Astro's own background.js sets on the daemon
// it forks, meaning "you are the server, run here, don't detect again". That is
// exactly this child's situation: it is the server, and this app is the thing
// supervising it. Setting it turns the detection off outright.
//
// One knock-on: the lock file it writes then says background: true, so
// `astro dev logs` on this project offers a log file the foreground server
// never writes to. The log is in the dock instead, which is the point.

// From am-i-vibing's detector table. Names it also reads but which say nothing
// about an agent on their own (HOME, USER, SHELL, TERM_PROGRAM, PAGER) are
// left alone — TERM_PROGRAM in particular is part of a pair, and the embedded
// terminal sets it to 'stacki' deliberately.
const AGENT_ENV_VARS = [
  'AGENT',
  'AI_AGENT',
  'AIDER_API_KEY',
  'AMP_CURRENT_THREAD_ID',
  'ANTIGRAVITY_AGENT',
  'ANTIGRAVITY_PROJECT_ID',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CODEIUM_EDITOR_APP_ROOT',
  'CODEX_THREAD_ID',
  'CRUSH',
  'CURSOR_TRACE_ID',
  'GEMINI_CLI',
  'OPENCODE',
  'OPENCODE_APP_INFO',
  'OPENCODE_BIN_PATH',
  'OPENCODE_MODES',
  'OPENCODE_SERVER',
  'QWEN_CODE',
  'REPL_ID',
  'REPLIT_MODE',
];

// The environment for a spawned `astro dev`. Never mutates what it is given —
// the app's own process.env has to keep the markers, or a terminal opened in
// the dock would no longer look like the session it was launched from.
function devServerEnv(env) {
  const out = { ...env };
  for (const key of AGENT_ENV_VARS) delete out[key];
  out.ASTRO_DEV_BACKGROUND = '1';
  return out;
}

module.exports = { AGENT_ENV_VARS, devServerEnv };
