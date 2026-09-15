// Types for the not-yet-converted astroParser.js, declared next to it so
// converted callers typecheck without assertions. DELETE this file when
// astroParser.ts lands (a sibling .ts shadows the .d.ts); grow it as more
// of the surface is needed, and keep it truthful to the real exports.

/** The model `serializePage` reads, as its callers here need it. */
export interface SerializePageModel {
  readonly imports?: readonly unknown[];
  readonly extraFrontmatter?: string;
  readonly nodes?: readonly unknown[];
  readonly hadFrontmatter?: boolean;
}

export function serializeNodes(nodes: readonly unknown[]): string;
export function serializePage(model: SerializePageModel): string;
