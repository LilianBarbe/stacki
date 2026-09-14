// The prop schema parsePropSchema infers from a component's frontmatter and
// sends to the renderer as a Map (structured clone preserves it). The panel
// builds typed fields from this; a malformed schema shows up as wrong
// controls, so the boundary validates every field.

import { LIMITS } from './limits';

export interface PropField {
  readonly name: string;
  /** Free-form type text from the component source ('string', 'number',
   * 'ServiceTime[]', …) — a description for the UI, not a checked type. */
  readonly type: string;
  readonly optional: boolean;
  readonly options?: readonly string[];
  readonly numeric?: boolean;
  readonly default?: unknown;
  readonly doc?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Object/list member detail; shape tightening is part of the PropsPanel
   * conversion (Phase 3), which is the consumer that reads it. */
  readonly shape?: unknown;
  readonly shapeIsList?: boolean;
  readonly unions?: readonly unknown[];
}

export type PropSchema = ReadonlyMap<string, PropField>;

function fail(where: string, what: string): never {
  throw new Error(`PropSchema.${where}: ${what}`);
}

function parseField(input: unknown, where: string): PropField {
  if (typeof input !== 'object' || input === null) {
    fail(where, 'expected object');
  }
  const record = input as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    fail(where, 'name: expected non-empty string');
  }
  if (typeof record['type'] !== 'string') {
    fail(where, 'type: expected string');
  }
  if (typeof record['optional'] !== 'boolean') {
    fail(where, 'optional: expected boolean');
  }
  const out: Record<string, unknown> = {
    name: record['name'],
    type: record['type'],
    optional: record['optional'],
  };
  if (record['options'] !== undefined) {
    if (!Array.isArray(record['options']) || !record['options'].every((o) => typeof o === 'string')) {
      fail(where, 'options: expected string array');
    }
    if (record['options'].length > LIMITS.propOptionsMax) {
      fail(where, `options exceed ${LIMITS.propOptionsMax}`);
    }
    out['options'] = record['options'] as readonly string[];
  }
  if (record['numeric'] !== undefined) {
    if (typeof record['numeric'] !== 'boolean') {
      fail(where, 'numeric: expected boolean');
    }
    out['numeric'] = record['numeric'];
  }
  for (const field of ['min', 'max', 'step'] as const) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== 'number') {
        fail(where, `${field}: expected number`);
      }
      out[field] = record[field];
    }
  }
  if (record['doc'] !== undefined) {
    if (typeof record['doc'] !== 'string') {
      fail(where, 'doc: expected string');
    }
    out['doc'] = record['doc'];
  }
  if (record['shape'] !== undefined) {
    out['shape'] = record['shape'];
  }
  if (record['shapeIsList'] !== undefined) {
    if (typeof record['shapeIsList'] !== 'boolean') {
      fail(where, 'shapeIsList: expected boolean');
    }
    out['shapeIsList'] = record['shapeIsList'];
  }
  if (record['unions'] !== undefined) {
    if (!Array.isArray(record['unions'])) {
      fail(where, 'unions: expected array');
    }
    out['unions'] = record['unions'];
  }
  if ('default' in record) {
    out['default'] = record['default'];
  }
  return out as unknown as PropField;
}

/** Parse the schema Map. Accepts only a real Map — the producer makes one and
 * IPC preserves it, so a plain object here means the boundary moved. */
export function parsePropSchema(input: unknown): PropSchema {
  if (!(input instanceof Map)) {
    fail('root', 'expected Map');
  }
  if (input.size > LIMITS.propSchemaFieldsMax) {
    fail('root', `exceeds ${LIMITS.propSchemaFieldsMax} fields`);
  }
  const out = new Map<string, PropField>();
  for (const [key, value] of input) {
    if (typeof key !== 'string') {
      fail('root', 'expected string keys');
    }
    const field = parseField(value, key);
    if (field.name !== key) {
      fail(key, `field name ${JSON.stringify(field.name)} does not match its key`);
    }
    out.set(key, field);
  }
  return out;
}
