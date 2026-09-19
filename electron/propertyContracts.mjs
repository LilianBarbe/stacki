import ts from 'typescript';
import { assert } from '../shared/assert.mjs';
import { PROPERTY_LIMITS } from '../shared/component-properties.mjs';
import { isAstroProps, propertyKey, syntaxNodes } from './propertySyntax.mjs';
// A common member must be the same declaration in both the public contract and
// the runtime assertion. Editing it then preserves every variant and runtime type.
export function readPropertyContracts(document) {
  const declarations = new Map();
  for (const statement of document.syntax.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    ) {
      if (declarations.has(statement.name.text)) {
        return unavailableContracts(
          'Duplicate type declarations require editing in source.',
        );
      }
      declarations.set(statement.name.text, statement);
    }
  }
  const assertions = syntaxNodes(document.syntax)
    .filter(ts.isAsExpression)
    .filter((node) => isAstroProps(node.expression));
  const attributes = htmlAttributeImports(document.syntax);
  const publicContract = readContract(
    declarations.get('Props'),
    declarations,
    attributes,
  );
  const runtimeContracts = assertions.map((node) =>
    readContract(node.type, declarations, attributes),
  );
  const editable = new Map();
  const reasons = new Map();
  for (const [name, usages] of publicContract.members) {
    const member = usages[0]?.member;
    assert(member !== undefined, 'Contract field has a declaration');
    const reason = commonMemberRestriction(
      name,
      publicContract,
      runtimeContracts,
    );
    if (reason) {
      reasons.set(name, reason);
    } else {
      editable.set(name, member);
    }
  }
  assert(
    editable.size <= PROPERTY_LIMITS.fieldsMax,
    'Editable contract fields are bounded',
  );
  return {
    names: new Set(
      [publicContract, ...runtimeContracts].flatMap((contract) => [
        ...contract.names,
      ]),
    ),
    editable,
    editing: (name) =>
      editable.has(name)
        ? { kind: 'editable' }
        : {
            kind: 'restricted',
            reason:
              reasons.get(name) ??
              'This prop is inherited or imported. Edit its declaration in source.',
          },
    conditions: (name) => contractConditions(publicContract, name),
  };
}
function unavailableContracts(reason) {
  return {
    names: new Set(),
    editable: new Map(),
    editing: () => ({ kind: 'restricted', reason }),
    conditions: () => [],
  };
}
function commonMemberRestriction(name, contract, runtimeContracts) {
  const usages = contract.members.get(name) ?? [];
  if (usages.some((usage) => usage.conditional)) {
    return 'This prop has variant rules. Edit its declaration in source to preserve those rules.';
  }
  if (new Set(usages.map((usage) => usage.member)).size !== 1) {
    return 'This prop combines multiple declarations. Edit those declarations in source.';
  }
  if (!contract.complete) {
    return 'This prop depends on a shared or computed type that must be edited in source.';
  }
  const member = usages[0]?.member;
  for (const runtime of runtimeContracts) {
    const matches = runtime.members.get(name) ?? [];
    if (
      !runtime.complete ||
      matches.length === 0 ||
      matches.some((match) => match.member !== member || match.conditional)
    ) {
      return 'This prop has a separate runtime type. Edit both declarations together in source.';
    }
  }
  return undefined;
}
function readContract(root, declarations, attributes) {
  const work = root ? [{ node: root, conditional: false, path: [] }] : [];
  const members = new Map();
  const names = new Set();
  const branches = [];
  let complete = root !== undefined;
  for (
    let count = 0;
    count < PROPERTY_LIMITS.nodesMax && work.length > 0;
    count++
  ) {
    const item = work.pop();
    assert(item !== undefined, 'Contract traversal has a work item');
    if (ts.isPropertySignature(item.node)) {
      const name = propertyKey(item.node.name);
      if (name) {
        const usages = members.get(name) ?? [];
        assert(
          usages.length < PROPERTY_LIMITS.fieldsMax,
          'Contract field usages are bounded',
        );
        members.set(name, [
          ...usages,
          { member: item.node, conditional: item.conditional },
        ]);
      }
    } else {
      if (
        ts.isTypeAliasDeclaration(item.node) ||
        ts.isInterfaceDeclaration(item.node)
      ) {
        names.add(item.node.name.text);
      }
      if (ts.isUnionTypeNode(item.node)) {
        branches.push(unionBranches(item.node));
      }
      const children = contractChildren(item, declarations, attributes);
      if (children === undefined) {
        complete = false;
      } else {
        work.push(...children);
      }
    }
    assert(
      work.length <= PROPERTY_LIMITS.nodesMax,
      'Contract traversal queue is bounded',
    );
  }
  assert(work.length === 0, 'Contract traversal completes within its budget');
  assert(
    members.size <= PROPERTY_LIMITS.fieldsMax,
    'Contract field count is bounded',
  );
  return { members, names, branches, complete };
}
function contractChildren(item, declarations, attributes) {
  const { node } = item;
  if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    if (
      node.typeParameters ||
      item.path.includes(node.name.text) ||
      item.path.length >= 64
    ) {
      return undefined;
    }
    if (
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      return undefined;
    }
    const next = { ...item, path: [...item.path, node.name.text] };
    if (ts.isTypeAliasDeclaration(node)) {
      return [{ ...next, node: node.type }];
    }
    return [
      ...node.members.map((member) => ({ ...next, node: member })),
      ...(node.heritageClauses ?? [])
        .flatMap((clause) => clause.types)
        .map((type) => ({ ...next, node: type })),
    ];
  }
  if (ts.isTypeLiteralNode(node)) {
    return node.members.map((member) => ({ ...item, node: member }));
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return node.types.map((type) => ({
      ...item,
      node: type,
      conditional: item.conditional || ts.isUnionTypeNode(node),
    }));
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return [{ ...item, node: node.type }];
  }
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
    const name = ts.isTypeReferenceNode(node)
      ? node.typeName.getText()
      : node.expression.getText();
    // DOM attributes are inherited, but locally authored members remain editable.
    if (attributes.has(name) && !declarations.has(name)) {
      return [];
    }
    const declaration = declarations.get(name);
    return declaration && !node.typeArguments
      ? [{ ...item, node: declaration }]
      : undefined;
  }
  return undefined;
}
function htmlAttributeImports(syntax) {
  const names = new Set();
  for (const statement of syntax.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (
        statement.moduleSpecifier.text === 'astro/types' &&
        bindings &&
        ts.isNamedImports(bindings)
      ) {
        for (const specifier of bindings.elements) {
          if (
            (specifier.propertyName ?? specifier.name).text === 'HTMLAttributes'
          ) {
            names.add(specifier.name.text);
          }
        }
      }
    }
  }
  return names;
}
function unionBranches(node) {
  const fields = node.types.map(branchFields);
  const discriminator = [...(fields[0]?.keys() ?? [])].find((name) =>
    fields.every(
      (branch) => literalBranchValue(branch.get(name)?.type) !== undefined,
    ),
  );
  return fields.map((branch, index) => ({
    fields: branch,
    condition: discriminator
      ? `${discriminator} = ${literalBranchValue(branch.get(discriminator)?.type)}`
      : `Variant branch ${index + 1}`,
  }));
}
function branchFields(root) {
  const work = [root];
  const fields = new Map();
  for (
    let count = 0;
    count < PROPERTY_LIMITS.nodesMax && work.length;
    count++
  ) {
    const node = work.pop();
    assert(node !== undefined, 'Variant branch work item exists');
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
          const name = propertyKey(member.name);
          if (name) {
            fields.set(name, member);
          }
        }
      }
    } else if (ts.isIntersectionTypeNode(node)) {
      work.push(...node.types);
    } else if (ts.isParenthesizedTypeNode(node)) {
      work.push(node.type);
    }
  }
  assert(work.length === 0, 'Variant branch traversal is bounded');
  return fields;
}
function literalBranchValue(type) {
  if (!type) {
    return undefined;
  }
  const types = ts.isUnionTypeNode(type) ? type.types : [type];
  return types.every((value) => ts.isLiteralTypeNode(value))
    ? type.getText()
    : undefined;
}
function contractConditions(contract, name) {
  const common = contract.members
    .get(name)
    ?.find((usage) => !usage.conditional)?.member;
  const conditions = contract.branches
    .filter((branches) => branches.some((branch) => branch.fields.has(name)))
    .flatMap((branches) =>
      branches.map((branch) => {
        const member = branch.fields.get(name) ?? common;
        const state = member
          ? member.type?.kind === ts.SyntaxKind.NeverKeyword
            ? 'not allowed'
            : member.questionToken
              ? 'optional'
              : 'required'
          : 'not declared';
        return `${branch.condition}: ${state}`;
      }),
    );
  assert(
    conditions.length <= PROPERTY_LIMITS.fieldsMax,
    'Property variant conditions are bounded',
  );
  return conditions;
}
