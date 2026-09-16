# Migration Tracker — TypeScript conversion of Stacki

Living status document for the migration, now on `main` after PR #26.
Each task here replaces a bullet in `docs/ts-migration-plan.md` once its
definition of done is met. Run the gate (`npm test`) after every conversion,
then update the counts below.

## Handoff state (read this first)

The `v0.1.26` startup repair, Astro parser conversion, and **Electron main
conversion** are complete. `electron/main.ts` now emits the ignored `main.js`
package entry. The invoke inventory is complete: **111 main channels + 4 terminal
channels**, with parsed inputs and compile-checked handler results.
**Next: remaining renderer leaves, then `src/ui`, then `src/panels` (PropsPanel
first), and `src/App.jsx` last. The scheduled Electron conversion queue is done.**

Main verification: 26 old/new handler and output comparisons matched, including
byte-identical generated Astro config, preview page, and both API endpoints.
The contract suite passes 152 tests. The full gate passes all 125 test commands;
repository lint retains 177 existing warnings and no errors. New main helpers,
IPC contracts, and tests have no lint warnings and meet the 70-line function limit.
The live lifecycle integration also passes against Electron 33.4.11 and Astro
5.13.10: content schemas, concurrent starts, stop/restart, startup cancellation,
process cleanup, and the built renderer/preload boot.

Main conversion details:
- One shared payload inventory drives main and terminal registration. Preload
  channel/payload types erase at build time, keeping sandboxed preload free of
  additional runtime imports. Renderer result parsers remain at their boundary.
- Disk settings, recents, package/config fields, Astro locks, content manifests,
  and dev-server responses are parsed. Markdown save metadata is checked without
  dropping source-preservation fields or trailing blank lines.
- Directory depth/count, file reads, port searches, name collisions, pending style
  writes, previews, logs, clipboard bytes, and IPC collections have explicit bounds.
- CMS scanning, menu construction, Git identity, preview startup, and image header
  reading use responsibility-sized helpers. Generated preview output is unchanged.
- Native source-text test checks tolerate emitted import quotes and whitespace.
  No runtime dependencies were added. Root `allowImportingTsExtensions` lets native
  Node TypeScript tests share a checked VM harness under the existing no-emit build.

Run the gate as `env -u ELECTRON_RUN_AS_NODE npm test` if the surrounding shell
sets that variable: browser probes need Electron's app API, not Node mode.

Field lessons a real project surfaced (a user's Windows machine, 2026-09-15):
the renderer contract had never run against a real scan payload (every suite
stubs `window.avb`), and the first live run exposed a wrong wire shape —
fixed in b94457c, see Phase 2. The repo runs end-to-end against a real Astro
site after that fix. The packaged `Stacki.exe` on that machine is a stale
snapshot (old contract baked into its `dist/`); test from the repo with
`npm run dev` / `npm start`, which rebuild `shared/dist` first.

Legend: ✅ done · ⏳ in progress · ⬜ pending — no item is "done" until its
parity check and `npm test` pass on the commit that lands it.

---

## Phase 0 — Tooling gate ✅

Strict tsconfig, `@ts-nocheck` ratchet (`BASELINE=44`), ESLint flat config,
~4,800 `curly` fixes. `QUARANTINED` is empty: varsrowheight was removed by
`v0.1.26`, after the earlier binding, chipedit, codeeditorlifecycle, codeprop,
and jsguard repairs.

Gate: builds + `tsc --noEmit` + ESLint + ratchet + 125/125 test commands, exit 0.

## Phase 1 — Contract layer (`shared/`) ✅

`brand`, `limits`, `assert`, `result`, `page-node`, `prop-schema`, `scan`,
`ipc`, `record` (+ `toArray`). 152 contract tests, including a roundtrip
property test and parser/import-slot boundary tests. Also fixed a lone-top-level-component layout bug found by the
contracts.

## Phase 2 — Boundary wiring ✅

`shared/dist` CJS + d.ts emit; `src/bridge.ts` (typed, validating renderer
bridge); rescan/save drain caps; `assertTreeInvariants`; packaging asarUnpack;
`electron/astroParser.d.ts` and `electron/contentEntries.d.ts` seed contracts;
`electron/git.ts` extraction (with gitBranches).

**Field fix (b94457c):** the first end-to-end open of a real project threw
`ScanResult…: expected Map` — `parseScanResult` routed each component's
schema into the prop-schema Map builder, but the wire (main.js `safeSchema`
→ App.jsx `schemaFor`) has always carried an **array of fields**; Maps are
collapsed to plain objects by IPC serialization, so the Map shape could never
survive `ipcRenderer.invoke`. Also corrected while there: `renderTag` is
`rootTag`'s `{tag, prop} | null` object, not `string | null`, and the
payload's `hasRest` (which `schemaFor` reads) is parsed instead of dropped.
Lesson: the bridge is stubbed in every suite, so renderer-contract ↔ real-
payload agreement is exercised only by live runs — keep one in the loop when
touching `shared/` wire shapes.

## Phase 3 — Mechanical conversion (leaf → hotspot) ⏳

### electron/ — 38 source modules converted ✅

| Module                                                                                                                      | State                |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `htmlText`, `serialQueue`, `selfWrites`, `windowBounds`                                                                     | ✅                   |
| `assetRefs` (+ `shared/record.ts`)                                                                                          | ✅                   |
| `frontmatter`                                                                                                               | ✅                   |
| `jsCollections`                                                                                                             | ✅                   |
| `devProbe`, `injectedRoutes`, `projectWatcher`                                                                              | ✅                   |
| `componentFile`, `gitSnapshot`, `starter`, `cmsRefs`                                                                        | ✅                   |
| `componentUsage`, `previewWorktree`, `scaffold` (byte-identical output)                                                     | ✅                   |
| `contentRefs` (fixed real bug: mentions() walks array schemas)                                                              | ✅                   |
| `formats/{transplant,ndjson,csv,yaml}`                                                                                      | ✅                   |
| `formats/frontmatter`                                                                                                       | ✅                   |
| `formats/json`, `formats/toml`                                                                                              | ✅ formats/ complete |
| `thumbs`                                                                                                                    | ✅                   |
| `gitBranches` (+ `git.ts`), `gitHistory`                                                                                    | ✅                   |
| `contentEntries` (retired its seed d.ts)                                                                                    | ✅                   |
| `conflicts` (CommonRun/DiffRun union; retired seed d.ts)                                                                    | ✅                   |
| `contentConfig` (Service interface, child-process typing)                                                                   | ✅                   |
| `terminal` (first ipcMain registrar; node-pty seed contract)                                                                | ✅                   |
| `morphClient` (browser ESM, own tsconfig + DOM lib; fixed console.warn reload bug)                                          | ✅                   |
| `markdownParser` (byte-exact round trips incl. CRLF; seed gains parseTemplate)                                              | ✅                   |
| `cssVars` (postcss 8 types; array-collect rule lookups)                                                                     | ✅                   |
| `preload` (own tsconfig, DOM lib; predicate-narrowed CSSOM; parsed message payloads; Canvas logic + full window.avb bridge) | ✅                   |

`astroParser` is also converted: checked tree/schema types, serializer validation,
shared import slots, and bounded parsing; its seed declaration is retired.

`main` is converted with `main.types`, `main.validation`, `main.bounds`, and the
shared typed IPC registrar. The count is 38 converted source modules (including
formats); seven supporting TypeScript modules bring the checked total to 45.
No scheduled Electron `.js` conversion remains. The authored content-worker
`.mjs` files stay outside this conversion queue.

Cleanup owed: `electron/scratch2-7.js` are stray tsc-emitted outputs from the
cssVars conversion experiments, still tracked in git (198 lines). Delete them
in a standalone commit; nothing requires them.

### src/ — 32 modules converted

`editorTree`, `pagePersistence` (WeakSet acks + drain caps),
`cleanError`, `branchName`, `loopBindings` (minimal-fidelity LiveNode),
`bindings` (parts protocol kept exact), `arrayValue`, `dataSuggest`
(1,117 lines; dataTree split; dead `resolvePath` deleted; fixed dropped
closing quote in samplePreview).

First renderer continuation batch: `assetPath`, `assetPick`, `attrOrder`,
`branches`, `canvasClick`, `componentName`, `dragState`, `jsCheck`, `pageOrder`,
`slotAttr`. All 132 old/new comparisons passed; the full gate passed 125/125
commands (94.8s), with no lint warnings in these modules. Request cancellation
and existing null results stay compatible; attribute renames preserve value identity.

Second renderer batch: `classNames`, `classAttr`, `astroAssets`,
`elementSchemas`, `outlineBoxes`, `spacingBands`, `terminalPaste`, `insertRank`.
All 164 old/new comparisons passed. The expanded gate passes 126/126 commands
(97.3s); the new renderer-leaves suite pins cancellation, listener replacement,
metadata identity, and boundary limits. Converted files have no lint warnings.

Third renderer batch: `treeSelection`, `liveClasses`, `extractProps`,
`instanceProps`, `insertTarget`, `fluid`, plus the shared `treeView` projection
and traversal budget. All 70 old/new comparisons passed. The gate passes
126/126 commands (94.6s), with no warnings in converted files. Regression tests
cover cyclic/deep/wide trees and arithmetic nesting limits; Node-only fluid tests
now bundle renderer TypeScript using the same compiler as the app.

Remaining src leaves (6 top-level `.js`): `contentSchema`, `cmsSchema`,
`frontmatterMove`, `gitActions`, `canvasQuery`, `previewRecovery`.
`sound` and `useListReorder` remain under `src/ui`, not the root directory.

### src/ui — 32 files, 6,457 lines ⬜

`Icons` 969, `RichContent` 606, `WelcomeBackground` 433, `ClassInput` 344,
`ExprInput` 336, `DataPicker` 308, `Dropdown` 303, `FileBrowser` 277,
`AssetField` 248, `CustomValueEditor` 243, `BindInput` 226, `StyleEditor`
200, + 20 smaller. None started.

### src/panels — 20 files, 13,990 lines ⬜

| File                                                                                                 | Lines                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `PropsPanel.jsx`                                                                                     | 3,819 — hotspot, convert-then-split, no split in same commit |
| `VariablesView.jsx`                                                                                  | 1,418 — holds 15 known conditional-hook bugs (fix them here) |
| `CmsView.jsx`                                                                                        | 1,246                                                        |
| `GitChip.jsx`                                                                                        | 1,044                                                        |
| `ContentView.jsx`                                                                                    | 1,001                                                        |
| `StructurePanel.jsx`                                                                                 | 793                                                          |
| `PreviewPane.jsx`                                                                                    | 727                                                          |
| `AssetsPanel` 473 · `PalettePanel` 455 · `PagesPanel` 442 · `HistoryPanel` 392 · `WelcomeScreen` 391 | small                                                        |

### src/App.jsx — 4,584 lines ⬜ hotspot, last

### style-panel — already TypeScript ✅

Converted in an earlier effort; not touched by Phase 3. Hotspots that need
splitting (convert-then-split discipline, one per commit):

| File                     | Lines                            |
| ------------------------ | -------------------------------- |
| `clip-path/ClipPath.tsx` | 8,806 — split only, already .tsx |
| `EmbedEditor.tsx`        | 4,745                            |
| `TypographySection.tsx`  | 1,538                            |
| `lib/webflow.ts`         | 1,058                            |

### Cross-cutting rules for every conversion

- Parity-check against `git show HEAD:<file>.js` before commit; watch symbol
  identity (DELETE symbols differ per module instance) and
  `JSON.parse`-as-unknown lint errors (use an annotated binding + `toRecord`).
- Preserve behavior through parity checks. Large files last. The current
  AGENTS.md hard function-size limit takes precedence when conversion requires
  private helper extraction; keep broader architecture changes separate.
- `electron/tsconfig.json` files list is grown manually per conversion.
- The `.js` sidecar generated by in-place emit is gitignored; require sites
  stay untouched; dist-layout move deferred.
- Parity harness preserves the relative layout under
  `node_modules/.stacki-test/orig/` for require closures.
- Known tolerated lint warnings (max-lines-per-function): jsCollections
  `parseValue` 79, projectWatcher `watchProject` 84, conflicts `threeWay` 84 /
  `parseConflict` 76, contentConfig 1 warning. Warnings are not errors; do not
  refactor to silence them unless the commit is a hotspot split.

## Phase 4 — AI contract docs ⬜

- `docs/contracts.md`: every contract a generator must satisfy, with the
  parse-test per contract.
- `AGENTS.md`: add the contracts section covering `shared/` usage.
- CI/pre-push hook: run the gate.

## Post-Phase-3 target — Diff-mapping editor core ⬜

`docs/diff-mapping-editor-core.md` is adopted: identity = span mapped through
one pure function `(lastKnownBytes, currentBytes, edit) → newText |
rejected-stale`; file is the only state. Corpus gate (multi-span, kind-changing,
multi-file CSS, frontmatter slots). During Phase 3, mutating modules convert
with **minimal fidelity** — the intent processor deletes that layer later.
Open questions: threshold timing, lastKnownBytes chaining, undo, morph
move-blindness.

## Pending tasks (not file conversions)

| Task                                                                 | State                        |
| -------------------------------------------------------------------- | ---------------------------- |
| Complete `IpcContract` invoke inventory (115 channels) | ✅ with `main.ts` |
| Fix 15 conditional-hook bugs in PropsPanel / VariablesView           | ⬜ with those conversions    |
| Delete stray `electron/scratch2-7.js` (tracked tsc-emit leftovers)   | ⬜ standalone cleanup commit |
| `release.sh` → TypeScript (`scripts/*.ts`, per AGENTS §17)           | ⬜                           |
| Tooling deps declared devDependencies (node_modules-incident repair) | ✅                           |
| Node_modules incident recorded under Risks in plan                   | ✅                           |

## Test-suite state

- Gate green at last run: 125/125, exit 0. No quarantined tests remain.
  The optional external-project corpus sweep still skips without `STACKI_CORPUS`.
- Contract suite: 152/152. Full-repository lint has 177 existing warnings and no
  errors; the converted parser, main, and their new supporting files have no warnings.
- Healed out of quarantine during Phase 3 (verified two consecutive direct
  runs each, then removed per the gate's own heal report): binding, chipedit,
  codeeditorlifecycle, codeprop, jsguard.
- FLAKY: `hovercost`, `popoverdropdown` (load-sensitive).
- Regressed tests fixed during Phase 3: section-dot (quiescence polling, proven
  by bisect), outside-edit, self-writes, preview-recovery (regex loosened for
  converted formatting), backend-lifecycle (both vm module wrappers now pass
  `exports` — the content harness got the same fix its sibling had, 9c06938).
- Preload-conversion test anchors made whitespace-tolerant (tsc emits 4-space
  and expands inline `{stmt}` blocks, so text-slicing regexes broke):
  bridge, canvas-click, comment-markers, gap-bands, opened-class.
- `test:bridge` enforces the preload method-name contract
  (`readSourceText`, `writeSourceText`, `readSymbolSource`,
  `resolveSourcePath`).

## How to work this tracker

1. Pick the smallest remaining row that is not blocked.
2. Convert with the electron in-place emit pattern (or src leaf pattern),
   parity-check, lint, commit.
3. Update the row to ✅ and re-run the counts in the section headings.
4. A commit whose `npm test` is not green gets the test fixed or the row
   returned to ⬜ with the failure named.
