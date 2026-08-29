// What a loop's item is made of.
//
//   node test/item-fields.js
//
//   times.map((service) => …)
//
// The picker offered `service` with nothing under it, or with only some of what
// a service has — so reaching `service.campus` meant typing it from memory,
// spelling included, into the field whose whole purpose is not having to. It
// then appeared as "not in this entry", which was the picker saying it had
// never heard of a field the file declares.
//
// Two reasons, and a loop hits whichever applies:
//
//   live data     the shape was taken from the FIRST entry alone. A field the
//                 first service happens not to have — a campus on one and not
//                 another — was not a field of the item.
//   a component   there is no data at all. A component has no entry on the
//                 canvas to read values from, and its own `interface Props` —
//                 `times?: ServiceTime[]` — was never read for shape, so the
//                 item had no fields whatsoever.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const out = path.join(buildDir, 'item-fields.cjs');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'dataSuggest.js')],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { dataTree } = require(out);
  const { parsePropSchema } = require('../electron/astroParser.js');

  const itemOf = (context, name = 'service') =>
    dataTree(context).find((n) => n.path === name) || null;
  const fieldsOf = (node) => (node?.children || []).map((c) => c.key).join(',');

  // --- a component, where the type is all there is -------------------------------
  const COMPONENT = `interface ServiceTime {
  day: string;
  campus: string | null;
  time: string | null;
}
interface Props {
  /** The times to list. */
  times?: ServiceTime[];
}
const { times = [] } = Astro.props;`;
  {
    const schema = parsePropSchema(`---\n${COMPONENT}\n---\n<div></div>`);
    const item = itemOf({
      frontmatter: COMPONENT,
      propsSchema: schema,
      ancestorHeads: ['times.map((service) => ('],
    });
    check('a loop over a typed prop has an item at all', !!item, 'no item node');
    check('with every field the type declares', fieldsOf(item) === 'day,campus,time', fieldsOf(item));
    check(
      'each named as a field of the item, not of the prop',
      (item?.children || []).every((c) => c.path.startsWith('service.')),
      (item?.children || []).map((c) => c.path).join()
    );
    // The prop itself still reads as the list it is, so the loop editor's own
    // Data field can find it.
    const times = dataTree({ frontmatter: COMPONENT, propsSchema: schema }).find((n) => n.path === 'times');
    check('and the prop is a list with an entry under it', times?.kind === 'list' && times.children?.[0]?.path === 'times[0]', JSON.stringify(times?.children?.[0]?.path));
  }
  {
    // The same interface written on one line — the shape is in the type either
    // way, and a `;` between members is not part of one.
    const oneLine = `interface ServiceTime { day: string; campus: string | null; time: string | null }
interface Props { times?: ServiceTime[] }
const { times = [] } = Astro.props;`;
    const item = itemOf({
      frontmatter: oneLine,
      propsSchema: parsePropSchema(`---\n${oneLine}\n---\n<div></div>`),
      ancestorHeads: ['times.map((service) => ('],
    });
    check('a one-line interface gives the same fields', fieldsOf(item) === 'day,campus,time', fieldsOf(item));
  }
  {
    // An inline type, and an object prop that is not a list.
    const inline = `interface Props {
  rows?: { label: string; href?: string }[];
  seo?: { title: string; description: string };
}
const { rows = [], seo } = Astro.props;`;
    const schema = parsePropSchema(`---\n${inline}\n---\n<div></div>`);
    const item = itemOf(
      { frontmatter: inline, propsSchema: schema, ancestorHeads: ['rows.map((row) => ('] },
      'row'
    );
    check('an inline item type works the same', fieldsOf(item) === 'label,href', fieldsOf(item));
    const seo = dataTree({ frontmatter: inline, propsSchema: schema }).find((n) => n.path === 'seo');
    check('an object prop lists its members directly', fieldsOf(seo) === 'title,description', fieldsOf(seo));
    check('and is not called a list', seo?.kind !== 'list', seo?.kind);
  }
  {
    // A union of two different shapes has no one shape, and guessing one would
    // offer fields that are not there half the time.
    const union = `interface Props {
  items?: { kind: "a"; a: string }[] | { kind: "b"; b: string }[];
}
const { items = [] } = Astro.props;`;
    const item = itemOf(
      {
        frontmatter: union,
        propsSchema: parsePropSchema(`---\n${union}\n---\n<div></div>`),
        ancestorHeads: ['items.map((one) => ('],
      },
      'one'
    );
    check('a union of shapes offers none of them', !item?.children, fieldsOf(item));
    check('but the item is still there to type into', !!item, 'no item node');
  }
  {
    // A type this file cannot see — imported, or a generic — says nothing.
    const opaque = `interface Props { posts?: CollectionEntry<"blog">[] }
const { posts = [] } = Astro.props;`;
    const item = itemOf(
      {
        frontmatter: opaque,
        propsSchema: parsePropSchema(`---\n${opaque}\n---\n<div></div>`),
        ancestorHeads: ['posts.map((post) => ('],
      },
      'post'
    );
    check('a type from somewhere else invents nothing', !item?.children, fieldsOf(item));
  }

  // --- live data, where the entries disagree ---------------------------------------
  {
    const sample = {
      times: [
        { day: 'Sunday', time: '9:30 AM' },
        { day: 'Sunday', campus: 'St. Amant', time: '11 AM' },
      ],
    };
    const item = itemOf({
      frontmatter: 'const { times } = Astro.props;',
      propsSample: sample,
      ancestorHeads: ['times.map((service) => ('],
    });
    check(
      'a field only the second entry has is still a field of the item',
      fieldsOf(item) === 'day,time,campus',
      fieldsOf(item)
    );
    const campus = (item?.children || []).find((c) => c.key === 'campus');
    check('shown with the value of the entry that has it', campus?.preview === '"St. Amant"', campus?.preview);
    check('and named as a field of the item', campus?.path === 'service.campus', campus?.path);
    // Nothing from another entry keeps that entry's index — `service.campus`
    // is the item's campus, not the second service's.
    // The eleventh entry, so the index it is written with is two characters
    // wide: a path pointing at `rows[10]` that is merely trimmed to the width
    // of `rows[0]` comes out mangled, and one that is trimmed to the same width
    // by luck hides the bug entirely.
    const rows = Array.from({ length: 10 }, () => ({ a: 1 }));
    rows.push({ b: { deep: 2 } });
    const deep = itemOf({
      frontmatter: 'const { rows } = Astro.props;',
      propsSample: { rows },
      ancestorHeads: ['rows.map((row) => ('],
    }, 'row');
    const nested = (deep?.children || []).find((c) => c.key === 'b');
    check(
      'and neither does anything under it',
      nested?.children?.[0]?.path === 'row.b.deep',
      nested?.children?.[0]?.path
    );
  }
  {
    // A list of plain values has no fields to union, and must not grow any.
    const item = itemOf({
      frontmatter: 'const { tags } = Astro.props;',
      propsSample: { tags: ['a', 'b'] },
      ancestorHeads: ['tags.map((tag) => ('],
    }, 'tag');
    check('a list of words gives an item with no fields', !item?.children, fieldsOf(item));
    check('which is still offered by name', item?.path === 'tag', JSON.stringify(item));
  }

  if (failures.length) {
    console.error(`\nitem-fields: ${failures.length} failed, ${checked - failures.length} passed\n`);
    console.error(failures.join('\n') + '\n');
    process.exit(1);
  }
  console.log(`item-fields: ${checked} passed  [what a loop's item is made of]`);
  process.exit(0);
})();
