// Read-only tree queries. Mutation code uses the live readers; rendering builds
// one index per immutable model so hovering and selecting never rescan it.
function* entries(nodes) {
  const stack = [{ list: nodes || [], index: 0, parent: null }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.list.length) { stack.pop(); continue; }
    const index = frame.index++;
    const node = frame.list[index];
    const entry = { node, list: frame.list, index, parent: frame.parent };
    yield entry;
    if (Array.isArray(node.children) && node.children.length) {
      stack.push({ list: node.children, index: 0, parent: entry });
    }
  }
}

function findEntry(nodes, id) {
  for (const entry of entries(nodes)) {if (entry.node.id === id) {return entry;}}
  return null;
}

function trailFor(entry, field) {
  if (!entry) {return null;}
  const trail = [];
  for (let current = entry; current; current = current.parent) {trail.push(current[field]);}
  return trail.reverse();
}

export const findNodeById = (nodes, id) => findEntry(nodes, id)?.node || null;
export const findParentNode = (nodes, id) => findEntry(nodes, id)?.parent?.node || null;
export const pathOfNode = (nodes, id) => trailFor(findEntry(nodes, id), 'index');
export const ancestorChain = (nodes, id) => trailFor(findEntry(nodes, id), 'node');

export function findParentList(model, id) {
  const found = findEntry(model.nodes, id);
  return found ? { list: found.list, index: found.index } : null;
}

export function isDescendantOf(candidateParent, id) {
  return candidateParent.id === id || !!findNodeById(candidateParent.children, id);
}

export function nodeAtPath(nodes, trail) {
  let list = nodes;
  let node = null;
  for (const i of trail) {
    node = list?.[i];
    if (!node) {return null;}
    list = node.children;
  }
  return node;
}

export function createTreeIndex(nodes) {
  const byId = new Map();
  const byPath = new Map();
  const sectionIds = [];
  for (const entry of entries(nodes)) {
    entry.path = entry.parent ? `${entry.parent.path}.${entry.index}` : String(entry.index);
    byId.set(entry.node.id, entry);
    byPath.set(entry.path, entry.node);
    const id = entry.node.props?.id;
    if (id?.type === 'string' && id.value) {sectionIds.push(id.value);}
  }
  return {
    byId,
    byPath,
    sectionIds,
    node: (id) => byId.get(id)?.node || null,
    parent: (id) => byId.get(id)?.parent?.node || null,
    path: (id) => byId.get(id)?.path ?? null,
    ancestors: (id) => trailFor(byId.get(id), 'node'),
  };
}
