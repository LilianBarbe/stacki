// Goal: shared/prop-schema.ts validates the component prop Map that
// parsePropSchema infers from user source — the data every panel field is
// built from. A bad schema means wrong controls, silently.
//
// Methodology: a full known-good schema passes; each known-bad shape fails
// with a pinned message; the Map-ness and size bounds are exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePropSchema } from '../../shared/prop-schema.ts';
import { LIMITS } from '../../shared/limits.ts';

const goodSchema = new Map<string, unknown>([
  ['title', { name: 'title', type: 'string', optional: false, default: 'Home', doc: 'Page title.' }],
  [
    'level',
    { name: 'level', type: 'number', optional: true, numeric: true, min: 1, max: 6, step: 1 },
  ],
  ['tag', { name: 'tag', type: 'HeadingTag', optional: true, options: ['h1', 'h2', 'h3'] }],
  [
    'items',
    {
      name: 'items',
      type: 'ServiceTime[]',
      optional: false,
      shape: { day: { name: 'day', type: 'string', optional: false } },
      shapeIsList: true,
      unions: [{ variants: ['a', 'b'] }],
    },
  ],
]);

test('a real schema passes intact', () => {
  const parsed = parsePropSchema(structuredClone(goodSchema));
  assert.equal(parsed.size, 4);
  assert.equal(parsed.get('level')?.max, 6);
  assert.deepEqual(parsed.get('tag')?.options, ['h1', 'h2', 'h3']);
  assert.equal(parsed.get('items')?.shapeIsList, true);
});

test('negative space: wrong container, wrong key, wrong field', () => {
  assert.throws(() => parsePropSchema({ title: {} }), /expected Map/);
  assert.throws(() => parsePropSchema(new Map([[7, {}]])), /expected string keys/);
  assert.throws(
    () => parsePropSchema(new Map([['title', { name: 'other', type: 'string', optional: true }]])),
    /does not match its key/,
  );
  assert.throws(
    () => parsePropSchema(new Map([['title', { type: 'string', optional: true }]])),
    /name: expected non-empty string/,
  );
  assert.throws(
    () => parsePropSchema(new Map([['title', { name: 'title', optional: true }]])),
    /type: expected string/,
  );
  assert.throws(
    () => parsePropSchema(new Map([['title', { name: 'title', type: 'string', optional: 'maybe' }]])),
    /optional: expected boolean/,
  );
  assert.throws(
    () =>
      parsePropSchema(
        new Map([['tag', { name: 'tag', type: 'T', optional: true, options: ['a', 2] }]]),
      ),
    /options: expected string array/,
  );
  assert.throws(
    () => parsePropSchema(new Map([['n', { name: 'n', type: 'number', optional: true, min: '1' }]])),
    /min: expected number/,
  );
});

test('bounds: schema size and option count fail at LIMITS', () => {
  const big = new Map(
    Array.from({ length: LIMITS.propSchemaFieldsMax + 1 }, (_, i) => [
      `p${i}`,
      { name: `p${i}`, type: 'string', optional: true },
    ]),
  );
  assert.throws(() => parsePropSchema(big), /exceeds \d+ fields/);
  const manyOptions = new Map([
    ['tag', { name: 'tag', type: 'T', optional: true, options: Array.from({ length: LIMITS.propOptionsMax + 1 }, (_, i) => `o${i}`) }],
  ]);
  assert.throws(() => parsePropSchema(manyOptions), /options exceed \d+/);
});
