// One contract for all invoke channels. Payload parsers run in main before
// side effects; result types are checked at registration. Rejected operating
// errors keep Electron's existing Promise-rejection channel during migration.
import type { IpcChannel, IpcPayloads } from './ipc-payloads';
import type { IpcResults } from './ipc-results';
export { parseIpcPayload, IPC_PAYLOADS } from './ipc-payloads';
export type { IpcChannel, IpcPayloads } from './ipc-payloads';
export type { IpcResults } from './ipc-results';

/** What src:readSymbol / src:resolvePath return — a hand-rolled Result pair. */
export type SymbolReadResult =
  | { readonly ok: true; readonly rel: string; readonly text: string; readonly line: number }
  | { readonly ok: false; readonly reason?: 'not-found' | 'too-large' };

export type ResolvePathResult =
  { readonly ok: true; readonly rel: string } | { readonly ok: false };

export type IpcContract = {
  readonly [K in IpcChannel]: {
    readonly payload: IpcPayloads[K];
    readonly result: IpcResults[K];
  };
};

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
