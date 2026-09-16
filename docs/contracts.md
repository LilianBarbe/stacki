# Stacki contract surface

The modules in `shared/` define the data that Electron and the renderer may
exchange. Code inside either process may rely on these types only after a value
has passed through the matching parser. Raw IPC replies, file contents,
`JSON.parse` results, browser messages, and drag payloads remain `unknown` until
that boundary check succeeds.

## Page trees

`shared/page-node.ts` is the canonical page model for Astro, Markdown, and MDX.
`parsePageNode`, `parsePageTree`, `parsePageModel`, and `parsePageReadResult`
enforce these invariants:

- Node ids are unique within a tree. Parser ids use `n<N>` for Astro and
  `m<N>` for Markdown; editor-created ids use `c<N>`. `layout` and `chunk<N>`
  are the only named ids.
- `text`, `expr`, `raw-line`, `comment`, and `raw` nodes are leaves.
  Components and elements may use `children: null` only when self-closing.
  Branches, loops, conditions, and chunk groups always carry child arrays.
- Attribute variants are `string`, `expr`, `bare`, or `spread`. The value field
  exists only on variants that need it.
- Import slots, attribute order, original tag text, blank lines, Markdown
  fences, list markers, indentation, and trailing blanks are source-preserving
  data. A parse/write round trip must retain them even when the editor does not
  display them.
- Every tree, depth, attribute collection, import list, string, and Markdown
  metadata collection is bounded by `shared/limits.ts`.

The renderer edits a `structuredClone` through `shared/editor-model.ts`. That
module is the sole constructor for the mutable mirror; IPC and disk contracts
remain readonly.

## IPC

`shared/ipc-payloads.ts` is the channel-to-payload inventory and
`shared/ipc-results.ts` is the channel-to-result inventory. `shared/preload-api.ts`
maps the public preload method names to those channels. A new or changed channel
must update all three files and add known-good and malformed cases under
`test/contracts/` or the renderer boundary's focused test.

Electron handlers call `parseIpcPayload` before using input. Renderer modules do
the same before invoking preload and parse every reply before returning it to a
component. Shared parsers cover common records; feature boundary modules such as
`src/appBridge.ts`, `src/historyBridge.ts`, and `src/terminalBridge.ts` preserve
only the fields their consumers use while still validating nested values and
bounds.

Expected operating failures use `Result` or an explicit result union. A shape
that violates the declared wire contract is a programmer error and throws at
the boundary. Do not catch that assertion and turn it into an operating result.

## Other shared contracts

- `brand.ts` constructs `NodeId`, `FilePath`, and `ProjectPath` after validating
  the primitive value.
- `scan.ts` validates project pages, layouts, components, schemas, and scan
  collection limits.
- `prop-schema.ts` validates component field schemas and their nested options.
- `frontmatter.ts` validates import members and source slots.
- `boundary.ts` supplies bounded primitive, list, dictionary, and data parsers.
- `result.ts` defines the expected-failure channel.

## Required gate

Run `env -u ELECTRON_RUN_AS_NODE npm test` before merging. The gate cleans and
rebuilds `dist/`, compiles Electron, preload, and shared contracts, builds the
renderer, runs strict `tsc --noEmit`, ESLint, the migration ratchet, and every
`test:*` command. Generated JavaScript belongs only in `dist/`; source folders
must contain TypeScript and source assets.
