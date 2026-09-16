// The IPC contract between Electron main and the renderer. preload.js exposes
// ~80 methods on window.avb; main.js registers the matching ipcMain.handle
// channels. Today nothing connects them — a caller and a handler can disagree
// silently and the failure arrives as a renderer crash far from the cause.
//
// This map is the connection: one entry per channel, payload type and result
// type, mirroring the handlers in electron/main.js exactly. AvbBridge is
// derived from it, so typing the preload bridge types every caller. A channel
// absent from this map does not yet have a contract — the inventory grows as
// Phase 2 wiring and Phase 3 conversions demand each channel.

import type { ScanResult } from './scan';
import type { ParsePageResult } from './page-node';
import type { ProjectPath, FilePath } from './brand';

/** What src:readSymbol / src:resolvePath return — a hand-rolled Result pair. */
export type SymbolReadResult =
  | { readonly ok: true; readonly rel: string; readonly text: string; readonly line: number }
  | { readonly ok: false; readonly reason?: 'not-found' | 'too-large' };

export type ResolvePathResult =
  | { readonly ok: true; readonly rel: string }
  | { readonly ok: false };

export interface IpcContract {
  /** Payload is the project path itself, not an object (the handler's second
   * parameter IS the path). */
  readonly 'project:scan': { readonly payload: ProjectPath; readonly result: ScanResult };
  /** Result carries the source beside the parse envelope. */
  readonly 'page:read': {
    readonly payload: FilePath;
    readonly result: ParsePageResult & { readonly source: string };
  };
  readonly 'src:readText': {
    readonly payload: { readonly projectPath: ProjectPath; readonly rel: string };
    readonly result: { readonly text: string };
  };
  readonly 'src:writeText': {
    readonly payload: { readonly projectPath: ProjectPath; readonly rel: string; readonly text: string };
    readonly result: { readonly ok: true };
  };
  readonly 'src:readSymbol': {
    readonly payload: {
      readonly projectPath: ProjectPath;
      readonly fromFile: FilePath;
      readonly spec: string;
      readonly name: string;
    };
    readonly result: SymbolReadResult;
  };
  readonly 'src:resolvePath': {
    readonly payload: { readonly projectPath: ProjectPath; readonly fromFile: FilePath; readonly spec: string };
    readonly result: ResolvePathResult;
  };
}

/** window.avb as the renderer sees it: one method per contracted channel. */
export type AvbBridge = {
  readonly [K in keyof IpcContract]: (
    payload: IpcContract[K]['payload'],
  ) => Promise<IpcContract[K]['result']>;
};

// --- Parsers for the small result unions -----------------------------------

export function parseSymbolReadResult(input: unknown): SymbolReadResult {
  if (typeof input !== 'object' || input === null) {
    throw new Error('SymbolReadResult: expected object');
  }
  const record = input as Record<string, unknown>;
  if (record['ok'] === false) {
    const reason = record['reason'];
    if (reason !== undefined && reason !== 'not-found' && reason !== 'too-large') {
      throw new Error(`SymbolReadResult: unknown reason ${JSON.stringify(reason)}`);
    }
    return reason === undefined ? { ok: false } : { ok: false, reason };
  }
  if (record['ok'] !== true) {
    throw new Error('SymbolReadResult.ok: expected boolean');
  }
  if (typeof record['rel'] !== 'string' || typeof record['text'] !== 'string') {
    throw new Error('SymbolReadResult: expected rel and text strings');
  }
  if (typeof record['line'] !== 'number') {
    throw new Error('SymbolReadResult.line: expected number');
  }
  return { ok: true, rel: record['rel'], text: record['text'], line: record['line'] };
}

export function parseResolvePathResult(input: unknown): ResolvePathResult {
  if (typeof input !== 'object' || input === null) {
    throw new Error('ResolvePathResult: expected object');
  }
  const record = input as Record<string, unknown>;
  if (record['ok'] === false) {
    return { ok: false };
  }
  if (record['ok'] !== true) {
    throw new Error('ResolvePathResult.ok: expected boolean');
  }
  if (typeof record['rel'] !== 'string') {
    throw new Error('ResolvePathResult.rel: expected string');
  }
  return { ok: true, rel: record['rel'] };
}

export function parseTextResult(input: unknown): { readonly text: string } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('TextResult: expected object');
  }
  const record = input as Record<string, unknown>;
  if (typeof record['text'] !== 'string') {
    throw new Error('TextResult.text: expected string');
  }
  return { text: record['text'] };
}

export function parseOkResult(input: unknown): { readonly ok: true } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('OkResult: expected object');
  }
  const record = input as Record<string, unknown>;
  if (record['ok'] !== true) {
    throw new Error('OkResult.ok: expected true');
  }
  return { ok: true };
}
