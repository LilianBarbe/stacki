// Rename only parsed component attributes and Astro.props accesses. Text, CSS,
// unrelated components, and lexical aliases retain their original spelling.
import { parse } from '@astrojs/compiler/sync';
import ts from 'typescript';
import { readPropertyContracts } from './propertyContracts.mjs';
import { assert } from '../shared/assert.mjs';
import { PROPERTY_LIMITS } from '../shared/component-properties.mjs';
import { err, ok } from '../shared/result.mjs';
import {
  applySourceEdits,
  isAstroProps,
  propertyKey,
  readPropertySyntax,
  syntaxNodes,
} from './propertySyntax.mjs';
export function renameComponentReferences(source, names, rename, owner) {
  const typeNames =
    owner === 'definition'
      ? readPropertyContracts(readPropertySyntax(source)).names
      : new Set();
  return editComponentReferences(
    source,
    names,
    { kind: 'rename', ...rename, typeNames: new Set(['Props', ...typeNames]) },
    owner,
  );
}
export function bindComponentDefault(source, name, binding) {
  const document = readPropertySyntax(source);
  const declaration = syntaxNodes(document.syntax).find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) =>
          ts.isObjectBindingPattern(item.name) &&
          item.name.elements.some(
            (element) =>
              ts.isIdentifier(element.name) && element.name.text === binding,
          ),
      ),
  );
  assert(declaration !== undefined, 'A default has an Astro.props binding');
  const alias = defaultBindingName(source);
  return editComponentReferences(
    source,
    new Set(),
    {
      kind: 'default',
      from: name,
      binding: alias,
      local: binding,
      declarationEnd: document.start + declaration.end,
    },
    'definition',
  );
}
function editComponentReferences(source, names, rename, owner) {
  let root;
  try {
    const result = parse(source, { position: true });
    const diagnostic = result.diagnostics.find((entry) => entry.severity === 1);
    if (diagnostic) {
      return err({ code: 'syntax', message: diagnostic.text });
    }
    root = result.ast;
  } catch (error) {
    return err({ code: 'syntax', message: String(error) });
  }
  const edits = [];
  if (owner === 'definition') {
    const document = readPropertySyntax(source);
    const result = renameAstroAccess(
      document.frontmatter,
      document.start,
      rename,
    );
    if (!result.ok) {
      return result;
    }
    edits.push(...result.value);
  }
  const pending = [{ node: root, expression: false }];
  for (let index = 0; index < pending.length; index += 1) {
    assert(
      pending.length <= PROPERTY_LIMITS.nodesMax,
      'Astro rename node budget',
    );
    const entry = pending[index];
    assert(entry !== undefined, 'Queued Astro node exists');
    const result = renameNode(
      source,
      entry.node,
      names,
      rename,
      owner,
      entry.expression,
    );
    if (!result.ok) {
      return result;
    }
    edits.push(...result.value);
    if ('children' in entry.node) {
      if (
        entry.node.type === 'element' &&
        ['script', 'style'].includes(entry.node.name)
      ) {
        continue;
      }
      for (const child of entry.node.children) {
        pending.push({
          node: child,
          expression: entry.node.type === 'expression',
        });
      }
    }
  }
  if (rename.kind === 'default' && edits.length > 0) {
    if (edits.some((edit) => edit.start < rename.declarationEnd)) {
      return err({
        code: 'default-order',
        message:
          'A prop read precedes its default. ' +
          'Move the Astro.props binding before that read in source.',
      });
    }
    // A unique alias prevents a template loop variable from shadowing the defaulted prop.
    edits.push({
      start: rename.declarationEnd,
      end: rename.declarationEnd,
      text: `\nconst ${rename.binding} = ${rename.local};`,
    });
  }
  return ok(applySourceEdits(source, edits));
}
function renameNode(source, node, names, rename, owner, expression) {
  const edits = [];
  if ('attributes' in node) {
    const target =
      rename.kind === 'rename' &&
      node.type === 'component' &&
      names.has(node.name);
    if (
      target &&
      rename.kind === 'rename' &&
      node.attributes.some((attribute) => attribute.name === rename.to)
    ) {
      return err({
        code: 'collision',
        message: `An instance already passes ${rename.to}.`,
      });
    }
    for (const attribute of node.attributes) {
      if (target && rename.kind === 'rename') {
        const result = renameAttribute(source, attribute, rename);
        if (!result.ok) {
          return result;
        }
        edits.push(...result.value);
      }
      if (owner === 'definition') {
        if (
          attribute.kind === 'expression' ||
          attribute.kind === 'template-literal'
        ) {
          const position = source.indexOf(
            attribute.value,
            offset(source, attribute),
          );
          if (position < 0) {
            return positionError();
          }
          const result = renameAstroAccess(attribute.value, position, rename);
          if (!result.ok) {
            return result;
          }
          edits.push(...result.value);
        }
      }
    }
  }
  if (owner === 'definition' && expression && node.type === 'text') {
    const position = offset(source, node);
    if (source.slice(position, position + node.value.length) !== node.value) {
      return positionError();
    }
    return renameAstroAccess(node.value, position, rename);
  }
  return ok(edits);
}
function offset(source, node) {
  const position = node.position?.start.offset;
  assert(
    position !== undefined,
    'Astro parser supplies requested source positions',
  );
  // Astro uses UTF-8 byte offsets; TypeScript and String.slice use UTF-16 offsets.
  assert(
    position <= Buffer.byteLength(source),
    'Astro source position is in bounds',
  );
  return Buffer.from(source).subarray(0, position).toString('utf8').length;
}
function positionError() {
  return err({
    code: 'position',
    message: 'Could not locate a source range safely; no files changed.',
  });
}
function renameAttribute(source, attribute, rename) {
  const start = offset(source, attribute);
  if (attribute.kind === 'spread') {
    return renameSpread(source, attribute, rename, start);
  }
  if (attribute.name !== rename.from) {
    return ok([]);
  }
  if (source.slice(start, start + attribute.name.length) !== attribute.name) {
    return positionError();
  }
  if (attribute.kind === 'shorthand') {
    if (
      source[start - 1] !== '{' ||
      source[start + attribute.name.length] !== '}'
    ) {
      return positionError();
    }
    return ok([
      {
        start: start - 1,
        end: start + attribute.name.length + 1,
        text: `${rename.to}={${rename.from}}`,
      },
    ]);
  }
  return ok([{ start, end: start + attribute.name.length, text: rename.to }]);
}
function renameSpread(source, attribute, rename, position) {
  const prefix = 'const spread = (';
  const syntax = ts.createSourceFile(
    'spread.ts',
    prefix + attribute.name + ');',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const object = syntaxNodes(syntax).find(ts.isObjectLiteralExpression);
  const variable = syntaxNodes(syntax).find(ts.isVariableDeclaration);
  const expression = variable?.initializer;
  if (
    !object ||
    !expression ||
    !ts.isParenthesizedExpression(expression) ||
    expression.expression !== object ||
    object.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        (property.name !== undefined &&
          ts.isComputedPropertyName(property.name)),
    )
  ) {
    return err({
      code: 'spread',
      message:
        'An instance uses a dynamic prop spread. ' +
        'Make its props explicit before editing this property.',
    });
  }
  const start = source.indexOf(
    attribute.name,
    Math.max(0, position - attribute.name.length - 4),
  );
  if (start < 0 || start > position + attribute.name.length + 4) {
    return positionError();
  }
  if (
    object.properties.some(
      (property) => propertyKey(property.name) === rename.to,
    )
  ) {
    return err({
      code: 'collision',
      message: `A spread already contains ${rename.to}.`,
    });
  }
  const edits = [];
  for (const property of object.properties) {
    if (propertyKey(property.name) !== rename.from || !property.name) {
      continue;
    }
    const text = ts.isShorthandPropertyAssignment(property)
      ? `${rename.to}: ${rename.from}`
      : ts.isStringLiteral(property.name)
        ? JSON.stringify(rename.to)
        : rename.to;
    edits.push({
      start: start + property.name.getStart() - prefix.length,
      end: start + property.name.end - prefix.length,
      text,
    });
  }
  return ok(edits);
}
function renameAstroAccess(source, start, rename) {
  const syntax = ts.createSourceFile(
    'expression.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits = [];
  for (const node of syntaxNodes(syntax)) {
    if (rename.kind === 'rename') {
      const typeEdit = renameIndexedPropType(
        node,
        start,
        rename,
        rename.typeNames,
      );
      if (typeEdit) {
        edits.push(typeEdit);
      }
    }
    if (!isAstroProps(node)) {
      continue;
    }
    // Wrappers are visited separately; only the outermost expression owns its consumer.
    if (
      ts.isAsExpression(node.parent) ||
      ts.isParenthesizedExpression(node.parent)
    ) {
      continue;
    }
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent)) {
      if (parent.name.text === rename.from) {
        edits.push(astroReferenceEdit(parent, parent.name, start, rename));
      }
    } else if (ts.isElementAccessExpression(parent)) {
      if (!ts.isStringLiteral(parent.argumentExpression)) {
        return err({
          code: 'computed',
          message:
            'Astro.props has a computed key. ' +
            'Make that access explicit before editing this property.',
        });
      }
      if (parent.argumentExpression.text === rename.from) {
        edits.push(
          astroReferenceEdit(parent, parent.argumentExpression, start, rename),
        );
      }
    } else if (
      ts.isVariableDeclaration(parent) &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      // The declaration editor already renamed keys and retained local aliases.
      continue;
    } else {
      return err({
        code: 'alias',
        message:
          'Astro.props is forwarded or aliased. ' +
          'Update that code explicitly before editing this property.',
      });
    }
  }
  return ok(edits);
}
function astroReferenceEdit(access, key, start, change) {
  if (change.kind === 'default') {
    return {
      start: start + access.getStart(),
      end: start + access.end,
      text: change.binding,
    };
  }
  return {
    start: start + key.getStart(),
    end: start + key.end,
    text: ts.isStringLiteral(key) ? JSON.stringify(change.to) : change.to,
  };
}
function defaultBindingName(source) {
  for (let index = 0; index <= PROPERTY_LIMITS.fieldsMax; index += 1) {
    const name = `_stackiDefault${index}`;
    if (!source.includes(name)) {
      return name;
    }
  }
  assert(false, 'Default alias generation is bounded');
}
function renameIndexedPropType(node, start, rename, typeNames) {
  if (
    !ts.isLiteralTypeNode(node) ||
    !ts.isStringLiteral(node.literal) ||
    node.literal.text !== rename.from
  ) {
    return undefined;
  }
  let parent = node.parent;
  if (ts.isUnionTypeNode(parent)) {
    parent = parent.parent;
  }
  const indexed =
    ts.isIndexedAccessTypeNode(parent) &&
    ts.isTypeReferenceNode(parent.objectType) &&
    typeNames.has(parent.objectType.typeName.getText());
  const picked =
    ts.isTypeReferenceNode(parent) &&
    ['Pick', 'Omit'].includes(parent.typeName.getText()) &&
    typeNames.has(parent.typeArguments?.[0]?.getText() ?? '');
  if (!indexed && !picked) {
    return undefined;
  }
  return {
    start: start + node.literal.getStart(),
    end: start + node.literal.end,
    text: JSON.stringify(rename.to),
  };
}
