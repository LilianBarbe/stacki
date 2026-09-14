// Telling the app's own write apart from somebody else's.
//
// The watcher exists to notice edits made outside the app — an editor, a
// script, a checkout — and the app writes the same files itself, constantly. So
// every event has to be asked: is this us hearing our own write come back?
//
// It used to be asked as a stopwatch: anything within a second of an app write
// was that write. A second is a long time at a keyboard. Save a page in the
// app, save the same file in an editor a moment later, and the editor's change
// arrived inside the window and was discarded — nothing reloaded the model,
// nothing told the canvas, and the file went on looking unchanged until
// something else happened to poke it. A page with a <style> block was worse:
// the app writes it a second time 150ms later, so the blind spell ran to about
// a second and a fifth after every save.
//
// The app knows exactly what it wrote, so it can ask a better question. If the
// bytes on disk are still the bytes it wrote, nobody else has been here. If
// they are not, somebody has — and how soon after our own write that happened
// does not matter at all.
//
// A move, a rename or a delete leaves no text to compare, so those keep the
// stopwatch: what they changed is that the file is gone or newly there, which
// no comparison of contents can answer.

const DEFAULT_WINDOW_MS = 1000;

interface SelfWritesOptions {
  /** The file's current text; throws if it is gone. Required: a noted write
   * with text can only be answered by reading the file back. */
  readonly read: (path: string) => string;
  readonly now?: () => number;
  /** How long a write with no text to compare still counts as ours. */
  readonly windowMs?: number;
}

interface SeenWrite {
  readonly text: string | null;
  readonly at: number;
}

interface SelfWrites {
  /** The app wrote `path`. Pass the text it wrote whenever there is one. */
  note(abs: string, text?: string | null): void;
  /** Is an event for `path` this app hearing itself? */
  isEcho(abs: string): boolean;
  clear(): void;
  /** For tests and for anyone who wants to know what we last put there. */
  lastWrite(abs: string): SeenWrite | null;
}

function createSelfWrites({ read, now = () => Date.now(), windowMs = DEFAULT_WINDOW_MS }: SelfWritesOptions): SelfWrites {
  const seen = new Map<string, SeenWrite>();
  return {
    note(abs: string, text: string | null = null): void {
      seen.set(abs, { text: typeof text === 'string' ? text : null, at: now() });
    },
    isEcho(abs: string): boolean {
      const mine = seen.get(abs);
      if (!mine) {
        return false;
      }
      if (typeof mine.text === 'string') {
        try {
          return read(abs) === mine.text;
        } catch {
          return false; // gone: whatever happened, it was not our write
        }
      }
      return now() - mine.at < windowMs;
    },
    clear(): void {
      seen.clear();
    },
    lastWrite(abs: string): SeenWrite | null {
      return seen.get(abs) || null;
    },
  };
}

export { createSelfWrites, DEFAULT_WINDOW_MS };
export type { SelfWrites, SelfWritesOptions, SeenWrite };
