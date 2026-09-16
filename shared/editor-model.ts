// The renderer owns one mutable clone of a parsed page. Keeping the conversion
// here confines the single assertion to a validated-constructor layer.
import type { Attr, PageModel, PageNode } from './page-node';
import type { NodeId } from './brand';
import { toNodeId } from './brand';

type Atomic =
  | undefined
  | null
  | boolean
  | number
  | string
  | bigint
  | symbol
  | ((...args: never[]) => unknown);
type Mutable<Value> = Value extends Atomic
  ? Value
  : Value extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
      : Value;

type MutablePageNode = Mutable<PageNode>;
type EditorNodeCommon = {
  name?: string;
  children?: EditorNode[] | null;
  props?: Record<string, Mutable<Attr>>;
  attrOrder?: string[];
  value?: string;
  chunkFile?: string;
  dynamicTag?: boolean;
  astroAsset?: boolean;
  head?: string;
  test?: string;
  inner?: string;
  source?: string;
};

export type EditorNode = MutablePageNode & EditorNodeCommon;
export type EditorModel = Omit<Mutable<PageModel>, 'nodes'> & { nodes: EditorNode[] };

export function cloneEditorModel(model: PageModel): EditorModel {
  // The page parser established the complete shape before this private clone.
  return structuredClone(model) as EditorModel;
}

export function nodeId(value: string): NodeId {
  return toNodeId(value);
}
