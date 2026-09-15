// Types for the not-yet-converted conflicts.js. Deleted when conflicts.ts
// lands; keep truthful to the real exports.

/** The marked-up pieces of a conflicted file (text runs and conflict hunks). */
export type ConflictPart = unknown;

export function parseConflict(text: string): ConflictPart[];

/**
 * The file rebuilt from its parts with a choice per hunk. `choices` is the
 * per-hunk answer list resolveMerge accepts inside its per-file record.
 */
export function renderResolved(parts: readonly ConflictPart[], choices: unknown): string;
