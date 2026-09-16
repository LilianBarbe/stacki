// The git runner main.js provides (over a PATH it repairs for the packaged
// app), as the git modules here take it. One home: gitSnapshot, gitBranches,
// gitHistory, previewWorktree and contentConfig all shell out through it.

import { toRecord } from '../shared/record.js';

export interface GitResult {
  readonly stdout: string;
  readonly stderr?: string;
}

export type Git = (projectPath: string, args: readonly string[]) => Promise<GitResult>;

const stderrOf = (err: unknown): string | undefined => {
  const stderr = toRecord(err)?.['stderr'];
  return typeof stderr === 'string' ? stderr : undefined;
};

/** stderr first, then the message — git's own wording leads. */
export function gitErrorDetail(err: unknown): string {
  // `||`, not `??`: an empty stderr falls through to the message, as the
  // untyped code's `err.stderr || err.message` did.
  return stderrOf(err) || (err instanceof Error ? err.message : '');
}

/** Both streams, stdout first — used where git reports conflicts on stdout. */
export function gitErrorFull(err: unknown): string {
  const stdout = toRecord(err)?.['stdout'];
  return `${typeof stdout === 'string' ? stdout : ''}\n${gitErrorDetail(err)}`;
}
