// Replies come from a project's iframe, so validate before resolving a pending
// query. Invalid messages remain unanswered and use the normal timeout fallback.
import {
  boolean,
  count,
  dictionary,
  list,
  nullable,
  object,
  optional,
  text,
} from '../shared/boundary';
import { err, ok, type Result } from '../shared/result';

const identity = object({
  tag: text,
  id: nullable(text),
  classes: list(text),
  attributes: dictionary(text),
});
const reply = object({
  id: count,
  found: boolean,
  ready: optional(boolean),
  identity: optional(nullable(identity)),
  matched: optional(dictionary(nullable(boolean))),
  computed: optional(dictionary(nullable(text))),
  computedProps: optional(dictionary(nullable(text))),
});
export type CanvasReply = ReturnType<typeof reply>;
export type CanvasAnswer = {
  readonly identity: CanvasReply['identity'];
  readonly matched: Readonly<Record<string, boolean | null>>;
  readonly computed: Readonly<Record<string, string | null>>;
  readonly computedProps: Readonly<Record<string, string | null>>;
};

export function parseCanvasReply(input: unknown): Result<CanvasReply> {
  try {
    return ok(reply(input));
  } catch (error: unknown) {
    return err({ code: 'invalid_canvas_reply', message: String(error) });
  }
}
