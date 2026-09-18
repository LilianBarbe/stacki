// Goal: component contracts remain valid and renames update only their own usages.
// Method: edit real Astro source and temporary project files, then exercise malformed
// input, source conflicts, ambiguous spreads, unicode positions, and failed writes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readComponentProperties,
  editPropertyDefinition,
} = require('../dist/electron/propertyDefinitions');
const { renameComponentReferences } = require('../dist/electron/propertyRename');
const {
  loadComponentProperties,
  updateComponentProperties,
} = require('../dist/electron/componentProperties');
const { applySourceEdits } = require('../dist/electron/propertySyntax');
const {
  parseComponentProperties,
  parsePropertyChange,
  parsePropertiesResult,
  PROPERTY_LIMITS,
} = require('../dist/shared/component-properties');
const source = `---
import type { ImageMetadata } from 'astro';
interface Props {
  /** Title shown above the card. */
  title?: string;
  readonly variant: 'solid' | 'outline';
  image?: ImageMetadata;
}
const { title = 'Hello', variant = 'solid', ...rest } = Astro.props;
---
<h1>{title} {Astro.props.title}</h1>
<slot />
<style>h1 { color: red; }</style>`;
const property = {
  name: 'title',
  type: 'string',
  required: false,
  readonly: false,
  defaultValue: '"New title"',
  description: 'New description',
};
const save = (overrides = {}) => ({
  kind: 'save',
  originalName: 'title',
  property: { ...property, ...overrides },
});
function value(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function project(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-properties-'));
  const component = path.join(root, 'src/components/Card.astro');
  const page = path.join(root, 'src/pages/index.astro');
  fs.mkdirSync(path.dirname(component), { recursive: true });
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(component, source);
  fs.writeFileSync(
    page,
    `---\nimport Alias from '../components/Card.astro';\n` +
      `import Other from '../components/Other.astro';\nconst title = 'page';\n---\n` +
      `<Alias title={title}/><Other title="untouched"/><p>title</p>`
  );
  try {
    run({ root, component, page });
  } finally {
    fs.rmSync(root, { recursive: true });
  }
}

test('reads exact types, docs, defaults, readonly and required flags', () => {
  const data = readComponentProperties(source);
  assert.equal(data.advanced, false);
  assert.deepEqual(
    data.properties.map((field) => field.name),
    ['title', 'variant', 'image']
  );
  assert.equal(data.properties[0].description, 'Title shown above the card.');
  assert.equal(data.properties[0].defaultValue, "'Hello'");
  assert.equal(data.properties[1].readonly, true);
  assert.equal(data.properties[1].required, true);
  assert.equal(data.properties[2].type, 'ImageMetadata');
});

test('edits defaults and flags without losing imports, rest props, slots or styles', () => {
  const output = value(editPropertyDefinition(source, save({ required: true, readonly: true })));
  assert.match(output, /readonly title: string/);
  assert.match(output, /title = "New title"/);
  assert.match(output, /\.\.\.rest/);
  assert.match(output, /import type/);
  assert.equal(output.slice(output.indexOf('<slot')), source.slice(source.indexOf('<slot')));
  assert.match(output, /const _stackiDefault0 = title/);
  assert.match(output, /<h1>\{title\} \{_stackiDefault0\}/);
  assert.equal(readComponentProperties(output).properties[0].description, 'New description');
});

test('adds fields to components with and without a Props type or frontmatter', () => {
  for (const original of [
    '<slot />',
    '---\nconst { title = "Hello" } = Astro.props;\n---\n<h1>{title}</h1>',
    '---\ntype Props = { title: string };\n---\n<h1/>',
  ]) {
    const output = value(
      editPropertyDefinition(original, {
        kind: 'save',
        originalName: '',
        property: { ...property, name: 'count', type: 'number', defaultValue: '3' },
      })
    );
    const fields = readComponentProperties(output).properties;
    assert.equal(fields.find((field) => field.name === 'count').defaultValue, '3');
    assert.match(output, /count\?: number/);
    if (original.includes('title')) {
      assert(fields.some((field) => field.name === 'title'));
    }
  }
});

test('reorders fields and literal options while preserving their docs and defaults', () => {
  const output = value(
    editPropertyDefinition(source, { kind: 'order', names: ['image', 'variant', 'title'] })
  );
  assert.deepEqual(
    readComponentProperties(output).properties.map((field) => field.name),
    ['image', 'variant', 'title']
  );
  assert.match(output, /Title shown above the card/);
  const reordered = value(
    editPropertyDefinition(source, {
      kind: 'save',
      originalName: 'variant',
      property: {
        ...property,
        name: 'variant',
        type: "'outline' | 'solid'",
        defaultValue: "'solid'",
      },
    })
  );
  assert.match(reordered, /variant\?: 'outline' \| 'solid'/);
  assert.equal(
    editPropertyDefinition(source, { kind: 'order', names: ['title', 'title'] }).ok,
    false
  );
});

test('invalid syntax, duplicate fields and complex contracts refuse destructive edits', () => {
  for (const change of [
    save({ name: 'variant' }),
    save({ type: 'string; const x = 1' }),
    save({ type: '{broken' }),
    save({ defaultValue: '{broken' }),
  ]) {
    assert.equal(editPropertyDefinition(source, change).ok, false);
  }
  for (const type of [
    'type Props = { kind: "a" } | { kind: "b" };',
    'interface Props<Value> extends Base { title: Value }',
    'import type { Props } from "./types";',
  ]) {
    const complex = `---\n${type}\n---\n<slot/>`;
    assert.equal(readComponentProperties(complex).advanced, true);
    assert.equal(editPropertyDefinition(complex, save()).ok, false);
  }
  assert.equal(
    editPropertyDefinition(source, { kind: 'source', frontmatter: 'const = ' }).ok,
    false
  );
  const output = value(
    editPropertyDefinition(source, {
      kind: 'source',
      frontmatter: 'type Props = { value: string } | { value: number };',
    })
  );
  assert.match(output, /value: number/);
  assert.match(output, /<slot \/>/);
});

test('rename keeps lexical aliases, and updates direct and computed Astro.props references', () => {
  const output = value(editPropertyDefinition(source, save({ name: 'heading', defaultValue: '' })));
  const renamed = value(
    renameComponentReferences(output, new Set(), { from: 'title', to: 'heading' }, 'definition')
  );
  assert.match(renamed, /heading: title/);
  assert.match(renamed, /\{title\} \{Astro.props.heading\}/);
  const computed = value(
    renameComponentReferences(
      '<p>{Astro.props["title"]}</p>',
      new Set(),
      { from: 'title', to: 'heading' },
      'definition'
    )
  );
  assert.match(computed, /Astro.props\["heading"\]/);
});

test('rename handles expressions, shorthand, literal spreads, comments and UTF-8', () => {
  const original =
    `<!-- <Card title="keep"/> -->😀 é <Card {title} />` +
    `<Card {...{title: 'x', nested: { title: 3 }}} /><Other title="keep"/>`;
  const output = value(
    renameComponentReferences(
      original,
      new Set(['Card']),
      { from: 'title', to: 'heading' },
      'consumer'
    )
  );
  assert.match(output, /<!-- <Card title="keep"\/> -->/);
  assert.match(output, /😀 é <Card heading=\{title\}/);
  assert.match(output, /heading: 'x', nested: \{ title: 3 \}/);
  assert.match(output, /<Other title="keep"/);
  for (const invalid of ['<Card {...data}/>', '<Card title="a" heading="b"/>']) {
    assert.equal(
      renameComponentReferences(
        invalid,
        new Set(['Card']),
        { from: 'title', to: 'heading' },
        'consumer'
      ).ok,
      false
    );
  }
  assert.equal(
    renameComponentReferences(
      '<p>{Astro.props[key]}</p>',
      new Set(),
      { from: 'title', to: 'heading' },
      'definition'
    ).ok,
    false
  );
});

test('project-wide rename follows import aliases and does not touch unrelated components', () => {
  project(({ root, component, page }) => {
    const result = updateComponentProperties(
      { projectPath: root, file: component, source, change: save({ name: 'heading' }) },
      () => {}
    );
    assert.equal(value(result).properties[0].name, 'heading');
    const content = fs.readFileSync(page, 'utf8');
    assert.match(content, /<Alias heading=\{title\}/);
    assert.match(content, /<Other title="untouched"/);
    assert.match(content, /<p>title<\/p>/);
  });
});

test('source conflicts and unresolved spreads leave every project file untouched', () => {
  project(({ root, component, page }) => {
    const before = fs.readFileSync(page, 'utf8');
    const request = {
      projectPath: root,
      file: component,
      source,
      change: save({ name: 'heading' }),
    };
    assert.equal(
      updateComponentProperties({ ...request, source: source + '\n' }, () => {}).ok,
      false
    );
    fs.writeFileSync(page, before + '<Alias {...props}/>');
    assert.equal(updateComponentProperties(request, () => {}).ok, false);
    assert.equal(fs.readFileSync(component, 'utf8'), source);
    assert.equal(fs.readFileSync(page, 'utf8'), before + '<Alias {...props}/>');
  });
});

test('failed writes restore all files already written', () => {
  project(({ root, component, page }) => {
    const before = fs.readFileSync(page, 'utf8');
    const write = fs.writeFileSync;
    let writes = 0;
    fs.writeFileSync = (...args) => {
      writes += 1;
      if (writes === 2) {
        throw new Error('Simulated disk failure');
      }
      return write(...args);
    };
    try {
      const result = updateComponentProperties(
        { projectPath: root, file: component, source, change: save({ name: 'heading' }) },
        () => {}
      );
      assert.equal(result.ok, false);
      assert.match(result.error.message, /restored/);
      assert.equal(fs.readFileSync(component, 'utf8'), source);
      assert.equal(fs.readFileSync(page, 'utf8'), before);
    } finally {
      fs.writeFileSync = write;
    }
  });
});

test('contracts reject malformed payloads and enforce resource bounds', () => {
  assert.deepEqual(
    parseComponentProperties(readComponentProperties(source)),
    readComponentProperties(source)
  );
  assert.deepEqual(parsePropertyChange(save()), save());
  for (const input of [
    null,
    {},
    { kind: 'save', originalName: 'title', property: {} },
    { kind: 'order', names: [42] },
    { kind: 'remove', name: 'bad name' },
    { kind: 'source', frontmatter: 'x'.repeat(PROPERTY_LIMITS.sourceCharsMax + 1) },
    { kind: 'save', originalName: '', property: { ...property, required: 'yes' } },
    { kind: 'save', originalName: '', property: { ...property, type: 'x'.repeat(32769) } },
    { kind: 'order', names: Array(PROPERTY_LIMITS.fieldsMax + 1).fill('title') },
  ]) {
    assert.throws(() => parsePropertyChange(input));
  }
  assert.throws(() => parsePropertiesResult({ ok: 'yes' }, parseComponentProperties));
  assert.throws(() => applySourceEdits('abc', [{ start: 1, end: 4, text: '' }]), /never overlap/);
  project(({ root }) =>
    assert.equal(
      loadComponentProperties({ projectPath: root, file: path.join(root, 'missing.astro') }).ok,
      false
    )
  );
});

test('defaults apply to direct reads without being shadowed by template locals', () => {
  const input =
    '---\ninterface Props { title?: string }\n---\n' +
    '<p>{Astro.props.title}</p>{[1].map((title) => <b>{Astro.props.title} {title}</b>)}';
  const output = value(editPropertyDefinition(input, save()));
  assert.match(output, /const \{ title = "New title" \} = Astro.props/);
  assert.match(output, /const _stackiDefault0 = title/);
  assert.match(output, /<b>\{_stackiDefault0\} \{title\}/);
  const { frontmatter } = readComponentProperties(output);
  const ts = require('typescript');
  const script = ts.transpileModule(frontmatter, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const evaluate = new Function('Astro', script + '\nreturn _stackiDefault0;');
  assert.equal(evaluate({ props: {} }), 'New title');
  assert.equal(evaluate({ props: { title: 'Instance' } }), 'Instance');
  assert.equal(evaluate({ props: { title: null } }), null);
  const before =
    '---\ninterface Props { title?: string }\n' +
    'const value = Astro.props.title;\n---\n<p>{value}</p>';
  assert.equal(editPropertyDefinition(before, save()).ok, false);
});

test('adding a prop creates its binding, and unused bindings can be removed', () => {
  const output = value(
    editPropertyDefinition('<slot/>', {
      kind: 'save',
      originalName: '',
      property: { ...property, name: 'label', defaultValue: '' },
    })
  );
  assert.match(output, /const \{ label \} = Astro.props/);
  const removed = value(editPropertyDefinition(output, { kind: 'remove', name: 'label' }));
  assert.equal(readComponentProperties(removed).properties.length, 0);
  assert.equal(editPropertyDefinition(source, { kind: 'remove', name: 'title' }).ok, false);
});

test('comma expressions remain one default and cannot introduce extra bindings', () => {
  const output = value(
    editPropertyDefinition('<slot/>', {
      kind: 'save',
      originalName: '',
      property: { ...property, defaultValue: '1, 2' },
    })
  );
  assert.match(output, /title = \(1, 2\)/);
  assert.equal(readComponentProperties(output).properties.length, 1);
  assert.equal(
    editPropertyDefinition(
      source,
      save({
        defaultValue: '1); const other = 2; const third = (3',
      })
    ).ok,
    false
  );
});

test('untyped props can be ordered and quoted keys remain in source mode', () => {
  const input = '---\nconst { title = "Hello", count = 3 } = Astro.props;\n---\n<slot/>';
  const output = value(editPropertyDefinition(input, { kind: 'order', names: ['count', 'title'] }));
  assert.deepEqual(
    readComponentProperties(output).properties.map((field) => field.name),
    ['count', 'title']
  );
  const quoted = readComponentProperties(
    '---\ninterface Props { "aria-label"?: string }\n---\n<div/>'
  );
  assert.equal(quoted.advanced, true);
  assert.equal(parseComponentProperties(quoted).properties[0].name, 'aria-label');
});

test('renames indexed Props references without changing unrelated string literal types', () => {
  const input =
    '---\ninterface Props { title?: string }\n' +
    'type Value = Props["title"];\ntype Chosen = Pick<Props, "title">;\n' +
    'type Unrelated = "title";\n---\n<p>{Astro.props.title}</p>';
  const output = value(
    renameComponentReferences(input, new Set(), { from: 'title', to: 'heading' }, 'definition')
  );
  assert.match(output, /Props\["heading"\]/);
  assert.match(output, /Pick<Props, "heading">/);
  assert.match(output, /Unrelated = "title"/);
});

test('renames resolve tsconfig aliases and MDX instances', () => {
  project(({ root, component }) => {
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      })
    );
    const mdx = path.join(root, 'src/pages/article.mdx');
    fs.writeFileSync(
      mdx,
      'import Feature from "@/components/Card.astro";\n\n# Hello\n\n' + '<Feature title="Story" />'
    );
    const result = updateComponentProperties(
      { projectPath: root, file: component, source, change: save({ name: 'heading' }) },
      () => {}
    );
    value(result);
    assert.match(fs.readFileSync(mdx, 'utf8'), /<Feature heading="Story"/);
  });
});

test('re-exports, runtime aliases, and dynamic imports cannot cause partial renames', () => {
  for (const contents of [
    'export { default as Card } from "./components/Card.astro";',
    'const Card = await import("./components/Card.astro");',
    'import Card from "./components/Card.astro";\nconst Other = Card;',
  ]) {
    project(({ root, component, page }) => {
      fs.writeFileSync(path.join(root, 'src/index.ts'), contents);
      const before = fs.readFileSync(page, 'utf8');
      const result = updateComponentProperties(
        { projectPath: root, file: component, source, change: save({ name: 'heading' }) },
        () => {}
      );
      assert.equal(result.ok, false);
      assert.equal(fs.readFileSync(component, 'utf8'), source);
      assert.equal(fs.readFileSync(page, 'utf8'), before);
    });
  }
});

test('deleting a property refuses live instance values', () => {
  project(({ root, component, page }) => {
    const input = '---\ninterface Props { title?: string }\n---\n<slot/>';
    fs.writeFileSync(component, input);
    const result = updateComponentProperties(
      {
        projectPath: root,
        file: component,
        source: input,
        change: { kind: 'remove', name: 'title' },
      },
      () => {}
    );
    assert.equal(result.ok, false);
    assert.match(result.error.message, /still passes title/);
    assert.equal(fs.readFileSync(component, 'utf8'), input);
    assert.match(fs.readFileSync(page, 'utf8'), /title=\{title\}/);
  });
});

test('inherited Props remain editable and local option aliases preserve shared types', () => {
  const input = `---
import type { HTMLAttributes } from 'astro/types';
type GapBase = 'small' | 'medium';
type ContainerGap = GapBase | 'large';
interface Props extends HTMLAttributes<'section'> {
  /** Space between items. */
  gap?: ContainerGap;
  otherGap?: ContainerGap;
  render?: boolean;
}
const { gap = 'small', otherGap = 'large', render = true, ...rest } = Astro.props;
---
<section {...rest}>{gap} {otherGap}</section>`;
  const snapshot = readComponentProperties(input);
  assert.equal(snapshot.advanced, false);
  const gap = snapshot.properties.find((field) => field.name === 'gap');
  assert.equal(gap.type, "'small' | 'medium' | 'large'");
  assert.equal(gap.description, 'Space between items.');
  const required = value(
    editPropertyDefinition(input, {
      kind: 'save',
      originalName: 'gap',
      property: { ...gap, required: true, description: 'Choose the spacing.' },
    })
  );
  assert.match(required, /gap: ContainerGap/);
  assert.match(required, /interface Props extends HTMLAttributes<'section'>/);
  assert.equal(readComponentProperties(required).properties[0].description, 'Choose the spacing.');
  const options = value(
    editPropertyDefinition(required, {
      kind: 'save',
      originalName: 'gap',
      property: {
        ...gap,
        name: 'spacing',
        required: true,
        type: "'large' | 'compact' | 'medium'",
        defaultValue: "'compact'",
      },
    })
  );
  assert.match(options, /spacing: 'large' \| 'compact' \| 'medium'/);
  assert.match(options, /spacing: gap = 'compact'/);
  assert.match(options, /type ContainerGap = GapBase \| 'large'/);
  assert.match(options, /otherGap\?: ContainerGap/);
  const reordered = value(
    editPropertyDefinition(options, {
      kind: 'order',
      names: ['render', 'otherGap', 'spacing'],
    })
  );
  assert.deepEqual(
    readComponentProperties(reordered).properties.map((field) => field.name),
    ['render', 'otherGap', 'spacing']
  );
  assert.match(reordered, /interface Props extends HTMLAttributes<'section'>/);
});

test('type aliases resolve within bounds without expanding imported or recursive contracts', () => {
  for (const [aliases, type, expected] of [
    ["type Options = ('one' | 'two');", 'Options', "'one' | 'two'"],
    ['type Toggle = boolean;', 'Toggle', 'boolean'],
    ["type Loop = 'one' | Loop;", 'Loop', 'Loop'],
    ['type First = Second; type Second = First;', 'First', 'First'],
    ["type Options<T> = T | 'one';", 'Options<string>', 'Options<string>'],
    ["import type { Options } from './types';", 'Options', 'Options'],
    ['type Options = { value: string };', 'Options', 'Options'],
    ["type Options = 'one'; type Options = 'two';", 'Options', 'Options'],
    [
      Array.from(
        { length: 70 },
        (_, index) => `type A${index} = ${index === 69 ? "'last'" : `A${index + 1}`};`
      ).join('\n'),
      'A0',
      'A0',
    ],
  ]) {
    const input = `---\n${aliases}\ninterface Props { value?: ${type} }\n---\n<div/>`;
    assert.equal(readComponentProperties(input).properties[0].type, expected);
  }
});

test('renaming a local prop on inherited Props updates website instances', () => {
  project(({ root, component, page }) => {
    const input = source.replace(
      'interface Props {',
      "interface Props extends HTMLAttributes<'section'> {"
    );
    fs.writeFileSync(component, input);
    value(
      updateComponentProperties(
        { projectPath: root, file: component, source: input, change: save({ name: 'heading' }) },
        () => {}
      )
    );
    assert.match(fs.readFileSync(component, 'utf8'), /Props extends HTMLAttributes/);
    assert.match(fs.readFileSync(page, 'utf8'), /<Alias heading=\{title\}/);
    assert.match(fs.readFileSync(page, 'utf8'), /<Other title="untouched"/);
  });
});
