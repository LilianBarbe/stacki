// The IPC contract between Electron main and the renderer. preload.js exposes
// ~80 methods on window.avb; main.js registers the matching ipcMain.handle
// channels. Today nothing connects them — a caller and a handler can disagree
// silently and the failure arrives as a renderer crash far from the cause.
//
// This map is the connection: one entry per channel, payload type and result
// type. AvbBridge is derived from it, so typing the preload bridge types every
// caller, and a handler registered through a typed helper must return what the
// map says. Phase 1 covers the channels whose shapes the contract layer owns;
// Phase 2 inventories the rest before preload adopts the type — a channel
// absent from this map does not yet have a contract.

import type { AppError, Result } from './result.ts';
import type { ScanResult } from './scan.ts';
import type { ProjectPath, FilePath } from './brand.ts';

export interface IpcContract {
  readonly 'project:scan': {
    readonly payload: { readonly projectPath: ProjectPath };
    readonly result: ScanResult;
  };
  readonly 'src:readText': {
    readonly payload: { readonly path: FilePath };
    readonly result: Result<string, AppError>;
  };
  readonly 'src:writeText': {
    readonly payload: { readonly path: FilePath; readonly text: string };
    readonly result: Result<undefined, AppError>;
  };
  readonly 'src:readSymbol': {
    readonly payload: { readonly path: FilePath; readonly name: string };
    readonly result: Result<string, AppError>;
  };
  readonly 'src:resolvePath': {
    readonly payload: { readonly from: FilePath; readonly specifier: string };
    readonly result: Result<FilePath, AppError>;
  };
}

/** window.avb as the renderer sees it: one method per contracted channel. */
export type AvbBridge = {
  readonly [K in keyof IpcContract]: (
    payload: IpcContract[K]['payload'],
  ) => Promise<IpcContract[K]['result']>;
};
