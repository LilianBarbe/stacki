// Types for the not-yet-converted contentEntries.js, as contentRefs consumes
// it. Deleted when contentEntries.ts lands; keep truthful to the real exports.

export interface ListedEntry {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly data: unknown;
  readonly keyed?: boolean;
  readonly locator: readonly (string | number)[];
}

export interface EntryEdit {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly rename?: string;
}

export function listEntries(
  projectPath: string,
  collection: unknown,
): { readonly entries: readonly ListedEntry[] };

export function writeEntry(
  projectPath: string,
  entry: { readonly file: string; readonly locator?: readonly (string | number)[] },
  edits: readonly EntryEdit[],
): unknown;
