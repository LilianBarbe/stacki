// Renderer Git actions parse invoke results before deciding whether a merge can
// continue. Payload types share the main-process inventory; responses stay unknown
// until this boundary because preload does not validate response data.
import {
  boolean,
  count,
  BOUNDARY_LIMITS,
  pathText,
  list,
  nullable,
  object,
  optional,
  record,
  text,
} from '../shared/boundary';
import type { IpcPayloads } from '../shared/ipc-payloads';
import type { WireMergeOutcome, WireDeleteOutcome, WireConflictPart } from '../shared/ipc-results';

const mergeFile = object({ path: pathText, ours: nullable(text), theirs: nullable(text) });
const commonPart = object({ text });
const changedPart = object({ ours: text, theirs: text, merged: optional(nullable(text)) });

export function parseConflictPart(input: unknown): WireConflictPart {
  const value = record(input);
  if (value['kind'] === 'same') {
    return { kind: 'same', ...commonPart(value) };
  }
  if (value['kind'] !== 'clash') {
    throw new Error('Merge part: expected same or clash');
  }
  const changedBy = value['changedBy'];
  if (changedBy !== 'ours' && changedBy !== 'theirs' && changedBy !== 'both') {
    throw new Error('Merge part: unknown changed side');
  }
  return { kind: 'clash', changedBy, ...changedPart(value) };
}
function parseMergeFiles(input: unknown) {
  let remaining = BOUNDARY_LIMITS.itemsMax;
  const files = list((entry) => {
    if (--remaining < 0) {
      throw new Error('Merge files: item limit exceeded');
    }
    const value = record(entry);
    const parts = nullable(
      list((part) => {
        if (--remaining < 0) {
          throw new Error('Merge files: item limit exceeded');
        }
        return parseConflictPart(part);
      }),
    )(value['parts']);
    return { ...mergeFile(value), parts };
  })(input);
  if (files.length === 0) {
    throw new Error('Merge files: at least one conflict is required');
  }
  return files;
}
const mergeSuccess = object({ into: nullable(text), changed: boolean, resolved: optional(count) });
const mergeConflict = object({ from: nullable(text), branch: text, files: parseMergeFiles });
const mergeDirty = object({ from: nullable(text), branch: text, files: list(text) });
const parkResult = object({
  ok: boolean,
  parked: optional(boolean),
  branch: optional(nullable(text)),
  error: optional(text),
});
const unparkResult = object({ restored: boolean, error: optional(text) });

export function parseMergeResult(input: unknown): WireMergeOutcome {
  const value = record(input);
  if (value['ok'] === true) {
    return { ok: true, ...mergeSuccess(value) };
  }
  if (value['ok'] !== false) {
    throw new Error('Merge result must declare success or failure');
  }
  if (value['conflicted'] === true) {
    return { ok: false, conflicted: true, ...mergeConflict(value) };
  }
  if (value['dirty'] === true) {
    return { ok: false, dirty: true, ...mergeDirty(value) };
  }
  throw new Error('Merge failure must identify dirty files or conflicts');
}
export function parseDeleteResult(input: unknown): WireDeleteOutcome {
  const value = record(input);
  if (value['ok'] === true) {
    return { ok: true };
  }
  if (value['ok'] === false && value['unmerged'] === true) {
    return { ok: false, unmerged: true, message: text(value['message']) };
  }
  throw new Error('Delete result must declare success or unmerged commits');
}
export async function gitMerge(payload: IpcPayloads['git:merge']): Promise<WireMergeOutcome> {
  return parseMergeResult(await window.avb.gitMerge(payload));
}
export async function gitDeleteBranch(
  payload: IpcPayloads['git:deleteBranch'],
): Promise<WireDeleteOutcome> {
  return parseDeleteResult(await window.avb.gitDeleteBranch(payload));
}
export async function gitPark(payload: IpcPayloads['git:park']) {
  return parkResult(await window.avb.gitPark(payload));
}
export async function gitUnpark(payload: IpcPayloads['git:unpark']) {
  return unparkResult(await window.avb.gitUnpark(payload));
}
