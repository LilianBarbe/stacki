// Asset cards only consume the entry list. Parse every entry before a path or
// dimension reaches a DOM attribute; unrelated result metadata stays opaque.
import { boolean, count, list, object, optional, pathText, record, text } from '../shared/boundary';
import type { WireAssetEntry } from '../shared/ipc-results';
import type { Result } from '../shared/result';

const entryBase = object({ rel: pathText, name: text, parent: pathText, root: text });
const entryFile = object({ abs: pathText, size: count });
const entryDirectory = object({ isRoot: optional(boolean) });

export function parseAssetEntry(input: unknown): WireAssetEntry {
  const value = record(input);
  const base = entryBase(value);
  if (boolean(value['isDir'])) {
    const { isRoot } = entryDirectory(value);
    return isRoot ? { ...base, isDir: true, isRoot: true } : { ...base, isDir: true };
  }
  return { ...base, isDir: false, ...entryFile(value) };
}

export const parseAssetEntries = object({ entries: list(parseAssetEntry) });

export async function listAssetEntries(
  projectPath: string,
): Promise<Result<readonly WireAssetEntry[], string>> {
  let response: unknown;
  try {
    response = await window.avb.listAssets(projectPath);
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // A malformed bridge response is a programmer error; never catch it as a disk failure.
  return { ok: true, value: parseAssetEntries(response).entries };
}

export function onAssetEntriesChanged(callback: () => void): () => void {
  return window.avb.onAssetsChanged(callback);
}
