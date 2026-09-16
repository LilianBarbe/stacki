import { assert } from '../shared/assert';
import { LIMITS } from '../shared/limits';

// The order a tag's attributes are written in.
//
// It belongs to the file. The model keeps it as a list of names on the node —
// `attrOrder`, written down when the page is read — because an object only
// remembers the order its keys were added, and that stops being the file's
// order the moment a prop is taken out and put back. The writer follows the
// list: what the file had, where it had it, then anything added since.
//
// Which leaves the one edit that changes a name rather than a value. Renaming
// an attribute keeps the value and the slot; the list is by name, so the name
// has to change there too, or the prop leaves for the end of the tag on its
// way to being called something else.

// Renames a prop in place. A name the tag already had gives up its slot to the
// rename — that is what overwriting it means. Returns whether anything moved.
// This mutator owns an in-session edit, matching the existing editor API.
// Values are opaque: renaming must retain all serializer metadata by identity.
export interface AttributeOwner<T> {
  props?: Record<string, T>;
  attrOrder?: readonly string[];
}

export function renameAttr<T>(
  node: AttributeOwner<T> | null | undefined,
  oldName: string,
  newName: string,
): boolean {
  if (!node?.props || !(oldName in node.props)) {
    return false;
  }
  if (!newName || newName === oldName) {
    return false;
  }
  assert(Object.keys(node.props).length <= LIMITS.attrsPerNodeMax, 'Attribute count exceeds limit');
  assert(newName.length <= LIMITS.attrCharsMax, 'Attribute name exceeds limit');
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(node.props)) {
    if (k === oldName) {
      next[newName] = v;
    } else if (k !== newName) {
      next[k] = v;
    }
  }
  node.props = next;
  if (node.attrOrder !== undefined) {
    node.attrOrder = node.attrOrder
      .filter((k) => k !== newName)
      .map((k) => (k === oldName ? newName : k));
  }
  return true;
}
