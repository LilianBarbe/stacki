// Writing a JS/TS collection back out.
//
//   node test/js-collections.js
//
// literal() decides whether a record stays on one line by measuring it against
// Prettier's printWidth, and the constant holding that width went undeclared:
// every save of a collection whose rows are objects threw `ReferenceError:
// WIDTH is not defined` instead of writing the file. Arrays of plain strings
// never reach that branch, which is why the whole CMS looked fine until a
// record had a field in it.
//
// So the width is what these checks are really about: that it exists at all,
// that it is the 80 the surrounding comment promises, and that both sides of
// it behave — a record short enough stays on its line, one too long opens up,
// and a value that cannot fit beside its key drops beneath it the way Prettier
// breaks a long string.

const { serializeCollection, findCollections, replaceCollection } = require('../electron/jsCollections.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

const attempt = (what, fn) => {
  try {
    return fn();
  } catch (e) {
    checked++;
    failures.push(`  ${what}\n    threw ${e.constructor.name}: ${e.message}`);
    return null;
  }
};

// --- the regression itself ---------------------------------------------------
const record = attempt('a record survives being written at all', () =>
  serializeCollection([{ id: 'a', titel: 'B' }])
);
check('and comes back as text', typeof record === 'string', String(record));

// --- short records stay where the hand that wrote them put them --------------
if (record) {
  check(
    'a short record keeps to one line',
    record === '[\n  { id: "a", titel: "B" },\n]',
    JSON.stringify(record)
  );
}

// --- the width is the one the comment promises -------------------------------
// A record's line is `  { … },`: two spaces of indent, the braces and spaces,
// and the trailing comma. Sizing the value so the line lands exactly on 80
// pins the constant — at 79 or 81 one of these two would fall the wrong way.
const lineFor = (len) => serializeCollection([{ k: 'x'.repeat(len) }]).split('\n')[1];
// The opened form's first line is a lone `  {`, so "still on one line" is the
// closing `},` being on it too — not the brace, which both forms start with.
const onOneLine = (len) => /^ {2}\{ .* \},$/.test(lineFor(len));
let fits = null;
for (let len = 1; len < 200; len++) {
  if (!onOneLine(len)) {
    fits = len - 1;
    break;
  }
}
check('a record is measured against a real width', fits !== null, 'never stopped fitting');
if (fits !== null) {
  check(
    'the widest one-line record is exactly 80 columns',
    lineFor(fits).length === 80,
    `${lineFor(fits).length} columns at length ${fits}`
  );
  check('one character more and the record opens up', !onOneLine(fits + 1), JSON.stringify(lineFor(fits + 1)));
}

// --- a value that cannot fit beside its key drops beneath it -----------------
const long = attempt('a long record is written', () =>
  serializeCollection([
    {
      id: 'software',
      text:
        'Warenwirtschaft, Rechnungswesen, komplexe Automatisierungen sowie Berichte, Gutachten, Kataloge und barrierefreie PDFs.',
    },
  ])
);
if (long) {
  const lines = long.split('\n');
  check('the record opens onto its own lines', lines[1] === '  {', JSON.stringify(lines[1]));
  check(
    'a key whose value still fits keeps it alongside',
    lines.some((l) => l === '    id: "software",'),
    JSON.stringify(lines.find((l) => l.includes('id:')))
  );
  check(
    'and a key whose value cannot fit is left bare',
    lines.some((l) => l === '    text:'),
    JSON.stringify(lines.find((l) => l.includes('text')))
  );
  check(
    'with the value indented on the line below',
    lines.some((l) => l.startsWith('      "Warenwirtschaft')),
    JSON.stringify(lines.find((l) => l.includes('Warenwirtschaft')))
  );
}

// --- the path that never broke still works -----------------------------------
check(
  'a list of plain strings is unaffected',
  serializeCollection(['a', 'b']) === '[\n  "a",\n  "b",\n]',
  JSON.stringify(serializeCollection(['a', 'b']))
);
check('an empty collection stays empty', serializeCollection([]) === '[]');

// --- and the round trip a save actually performs -----------------------------
const source = 'export const themen = [\n  { id: "a", titel: "B" },\n];\n';
const rewritten = attempt('a collection can be replaced in its file', () =>
  replaceCollection(source, 'themen', [{ id: 'a', titel: 'Changed' }])
);
if (rewritten) {
  check('the new value is in the file', rewritten.includes('"Changed"'), rewritten);
  check(
    'the export around it is untouched',
    rewritten.startsWith('export const themen = [') && rewritten.endsWith('];\n'),
    JSON.stringify(rewritten)
  );
  const reread = findCollections(rewritten);
  check(
    'and reading it back gives what was written',
    JSON.stringify(reread[0] && reread[0].data) === JSON.stringify([{ id: 'a', titel: 'Changed' }]),
    JSON.stringify(reread[0] && reread[0].data)
  );
}

if (failures.length) {
  console.error(`\njs-collections: ${failures.length} failed, ${checked - failures.length} passed\n`);
  console.error(failures.join('\n') + '\n');
  process.exit(1);
}
console.log(`js-collections: ${checked} passed`);
