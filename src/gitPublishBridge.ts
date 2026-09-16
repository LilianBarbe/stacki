import type { IpcResults, WireGitInfo } from '../shared/ipc-results';
import type { Result } from '../shared/result';
import type { Parser } from '../shared/boundary';
import {
  boolean,
  count,
  list,
  nullable,
  object,
  optional,
  pathText,
  record,
  text,
} from '../shared/boundary';
import { parseIpcPayload } from '../shared/ipc-payloads';
import { cleanError } from './cleanError';

const repository = object({
  branch: text,
  branches: list(text),
  remote: nullable(text),
  dirty: boolean,
  ahead: count,
  parked: list(text),
  head: optional(nullable(text)),
  userEmail: optional(nullable(text)),
  trunk: optional(nullable(text)),
  dirtyFiles: optional(list(pathText)),
  hasUpstream: optional(boolean),
});
export function parseGitInfo(input: unknown): IpcResults['git:info'] {
  const value = record(input);
  return boolean(value['isRepo'])
    ? ({ isRepo: true, ...repository(value) } satisfies WireGitInfo)
    : { isRepo: false };
}
export function parseGitCommit(input: unknown): IpcResults['git:commit'] {
  const value = record(input);
  parseGitSuccess(value);
  return { ok: true, files: nullable(count)(value['files']) };
}
export function parseGitPublish(input: unknown): IpcResults['git:publish'] {
  const value = record(input);
  parseGitSuccess(value);
  return { ok: true, url: nullable(text)(value['url']), output: text(value['output']) };
}
export function parseGitSuccess(input: unknown): void {
  if (!boolean(record(input)['ok'])) {
    throw new Error('Git response: expected success');
  }
}
async function gitRequest<Value>(
  invoke: () => Promise<unknown>,
  parse: Parser<Value>,
): Promise<Result<Value, string>> {
  let response: unknown;
  try {
    response = await invoke();
  } catch (error: unknown) {
    return { ok: false, error: cleanError(error) };
  }
  // Contract bugs remain loud; only transport failures use the operating channel.
  return { ok: true, value: parse(response) };
}
export function readGitInfo(projectPath: string) {
  const payload = parseIpcPayload('git:info', projectPath);
  return gitRequest(() => window.avb.gitInfo(payload), parseGitInfo);
}
export function commitGitChanges(projectPath: string, message: string) {
  const payload = parseIpcPayload('git:commit', { projectPath, message });
  return gitRequest(() => window.avb.gitCommit(payload), parseGitCommit);
}
export function createGitHubRepository(projectPath: string, repoName: string, isPrivate: boolean) {
  const payload = parseIpcPayload('git:publish', { projectPath, repoName, isPrivate });
  return gitRequest(() => window.avb.gitPublish(payload), parseGitPublish);
}
