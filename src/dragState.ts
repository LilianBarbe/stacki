// What's currently being dragged, shared across panels.
//
// dragover can't read dataTransfer payloads (only their type names), so the
// drop targets have no way to ask "is this a <p>?" while the pointer is
// moving — which is exactly when an invalid drop needs to be refused. Drags
// never leave this window, so a module-level record is enough.
//
// { kind: 'node' | 'component', tag?: string, nodeKind?: string, id?: string }
export type Drag =
  | { readonly kind: 'component'; readonly name: string }
  | {
      readonly kind: 'node';
      readonly id: string;
      readonly nodeKind: string;
      readonly tag?: string;
    };

// One window owns this single slot; null preserves the existing clear protocol.
let current: Drag | null = null;

export function setDrag(info: Drag | null | undefined): void {
  current = info || null;
}

export function clearDrag(): void {
  current = null;
}

export function getDrag(): Drag | null {
  return current;
}
