import type { WireAssetEntry } from '../shared/ipc-results';

// "Choose an asset" requests, from a field to the Assets panel.
//
// The fields that ask (src, poster, an attribute value) sit several levels
// down inside the props panel, and the panel that answers lives in a
// different branch of the tree entirely — so the request travels through a
// module rather than being threaded as props through every field in between.
// Only one request can be open at a time, which is what makes that safe.

export interface AssetRequest {
  readonly mediaKind: 'image' | 'video' | 'audio' | 'asset';
  readonly current: string;
  readonly onPick: (rel: string, entry?: WireAssetEntry) => void;
}

type AssetListener = (request: AssetRequest | null) => void;
// A single request and listener bound state for the whole window. Null is the
// existing cancellation message, so it remains part of this migration's API.
let listener: AssetListener | null = null;
let pending: AssetRequest | null = null;

// Called by App to receive requests. Returns an unsubscribe.
export function onAssetRequest(fn: AssetListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) {
      listener = null;
    }
  };
}

// { mediaKind: 'image'|'video'|'audio'|'asset', current: string,
//   onPick(rel, entry) } — entry carries the root ('public'|'src') and abs path,
//   which decide whether the value is a URL string or an ESM import.
export function requestAsset(req: AssetRequest): void {
  pending = req;
  listener?.(req);
}

export function getPendingAsset(): AssetRequest | null {
  return pending;
}

export function clearAssetRequest(): void {
  pending = null;
  listener?.(null);
}
