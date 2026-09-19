export function isFragmentNode(node) {
  return (
    (node.kind === 'component' || node.kind === 'element') &&
    node.name === 'Fragment'
  );
}
