// The project scan: what 'project:scan' returns. pages/layouts/components are
// separate arrays in the payload; the contract keeps them separate so the
// renderer can never confuse a page route with a component folder.

import { LIMITS } from './limits.ts';
import type { PropSchema } from './prop-schema.ts';
import { parsePropSchema } from './prop-schema.ts';

export interface ScanPage {
  readonly path: string;
  /** POSIX path relative to src/pages — the route's file identity. */
  readonly name: string;
  readonly route: string;
}

export interface ScanComponent {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly isLayout?: boolean;
  readonly instances?: number;
  // safeSchema output — absent when the component's source could not be read.
  readonly schema?: PropSchema;
  readonly extendsTag?: string | null;
  readonly slots?: readonly string[];
  readonly slotText?: boolean;
  readonly renderTag?: string | null;
}

export interface ScanResult {
  readonly pages: readonly ScanPage[];
  readonly pageFolders: readonly string[];
  readonly layouts: readonly ScanComponent[];
  readonly components: readonly ScanComponent[];
  readonly trailingSlash?: string;
}

function fail(where: string, what: string): never {
  throw new Error(`ScanResult.${where}: ${what}`);
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    fail(where, 'expected string');
  }
  if (value.length > LIMITS.ipcFieldCharsMax) {
    fail(where, `exceeds ${LIMITS.ipcFieldCharsMax} chars`);
  }
  return value;
}

function asArray(input: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(input)) {
    fail(where, 'expected array');
  }
  if (input.length > max) {
    fail(where, `exceeds ${max} entries`);
  }
  return input;
}

function asRecord(input: unknown, where: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(where, 'expected object');
  }
  return input as Record<string, unknown>;
}

function parsePage(input: unknown, where: string): ScanPage {
  const record = asRecord(input, where);
  return {
    path: asString(record['path'], `${where}.path`),
    name: asString(record['name'], `${where}.name`),
    route: asString(record['route'], `${where}.route`),
  };
}

function parseComponent(input: unknown, where: string): ScanComponent {
  const record = asRecord(input, where);
  const out: Record<string, unknown> = {
    path: asString(record['path'], `${where}.path`),
    name: asString(record['name'], `${where}.name`),
    folder: asString(record['folder'], `${where}.folder`),
  };
  if (record['isLayout'] !== undefined) {
    if (record['isLayout'] !== true) {
      fail(where, 'isLayout: only true is ever written');
    }
    out['isLayout'] = true;
  }
  if (record['instances'] !== undefined) {
    if (!Number.isSafeInteger(record['instances'])) {
      fail(where, 'instances: expected integer');
    }
    out['instances'] = record['instances'];
  }
  if (record['schema'] !== undefined) {
    out['schema'] = parsePropSchema(record['schema']);
  }
  for (const field of ['extendsTag', 'renderTag'] as const) {
    if (record[field] !== undefined) {
      const value = record[field];
      if (value !== null && typeof value !== 'string') {
        fail(where, `${field}: expected string or null`);
      }
      out[field] = value;
    }
  }
  if (record['slots'] !== undefined) {
    const slots = asArray(record['slots'], `${where}.slots`, LIMITS.propOptionsMax);
    if (!slots.every((slot) => typeof slot === 'string')) {
      fail(where, 'slots: expected strings');
    }
    out['slots'] = slots as readonly string[];
  }
  if (record['slotText'] !== undefined) {
    if (typeof record['slotText'] !== 'boolean') {
      fail(where, 'slotText: expected boolean');
    }
    out['slotText'] = record['slotText'];
  }
  return out as unknown as ScanComponent;
}

export function parseScanResult(input: unknown): ScanResult {
  const record = asRecord(input, 'root');
  const result: Record<string, unknown> = {
    pages: asArray(record['pages'], 'pages', LIMITS.scanEntriesMax).map((entry, index) =>
      parsePage(entry, `pages[${index}]`),
    ),
    pageFolders: asArray(record['pageFolders'], 'pageFolders', LIMITS.scanFoldersMax).map((folder, index) =>
      asString(folder, `pageFolders[${index}]`),
    ),
    layouts: asArray(record['layouts'], 'layouts', LIMITS.scanEntriesMax).map((entry, index) =>
      parseComponent(entry, `layouts[${index}]`),
    ),
    components: asArray(record['components'], 'components', LIMITS.scanEntriesMax).map((entry, index) =>
      parseComponent(entry, `components[${index}]`),
    ),
  };
  if (record['trailingSlash'] !== undefined) {
    result['trailingSlash'] = asString(record['trailingSlash'], 'trailingSlash');
  }
  return result as unknown as ScanResult;
}
