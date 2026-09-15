# Migration Tracker — TypeScript conversion of Stacki

Living status document for the `ts-contracts/phase-0-gate` branch, which is 44
commits ahead of `main`. Each task here replaces a bullet in
`docs/ts-migration-plan.md` once its definition of done is met. Run the gate
(`npm test`) after every conversion, then update the counts below.

Legend: ✅ done · ⏳ in progress · ⬜ pending — no item is "done" until its
parity check and `npm test` pass on the commit that lands it.

---

## Phase 0 — Tooling gate ✅

Strict tsconfig, `@ts-nocheck` ratchet (`BASELINE=44`), ESLint flat config,
~4,800 `curly` fixes, quarantine (`QUARANTINED`: binding, chipedit,
codeeditorlifecycle, codeprop, jsguard, varsrowheight).

Gate: `tsc --noEmit` + ESLint + ratchet + 118/124 e2e tests, exit 0.

## Phase 1 — Contract layer (`shared/`) ✅

`brand`, `limits`, `assert`, `result`, `page-node`, `prop-schema`, `scan`,
`ipc`, `record` (+ `toArray`). 12 contract tests, including a roundtrip
property test. Also fixed a lone-top-level-component layout bug found by the
contracts.

## Phase 2 — Boundary wiring ✅

`shared/dist` CJS + d.ts emit; `src/bridge.ts` (typed, validating renderer
bridge); rescan/save drain caps; `assertTreeInvariants`; packaging asarUnpack;
`electron/astroParser.d.ts` and `electron/contentEntries.d.ts` seed contracts;
`electron/git.ts` extraction (with gitBranches).

## Phase 3 — Mechanical conversion (leaf → hotspot) ⏳

### electron/ — 30 modules converted

| Module | State |
|---|---|
| `htmlText`, `serialQueue`, `selfWrites`, `windowBounds` | ✅ |
| `assetRefs` (+ `shared/record.ts`) | ✅ |
| `frontmatter` | ✅ |
| `jsCollections` | ✅ |
| `devProbe`, `injectedRoutes`, `projectWatcher` | ✅ |
| `componentFile`, `gitSnapshot`, `starter`, `cmsRefs` | ✅ |
| `componentUsage`, `previewWorktree`, `scaffold` (byte-identical output) | ✅ |
| `contentRefs` (fixed real bug: mentions() walks array schemas) | ✅ |
| `formats/{transplant,ndjson,csv,yaml}` | ✅ |
| `formats/frontmatter` | ✅ |
| `formats/json`, `formats/toml` | ✅ formats/ complete |
| `thumbs` | ✅ |
| `gitBranches` (+ `git.ts`), `gitHistory` | ✅ |
| `contentEntries` (retired its seed d.ts) | ✅ |
| `conflicts` (CommonRun/DiffRun union; retired seed d.ts) | ✅ |
| `contentConfig` (Service interface, child-process typing) | ✅ |

Remaining electron leaves (by lines):

| File | Lines | Notes |
|---|---|---|
| `terminal.js` | 455 | Medium leaf |
| `morphClient.js` | 528 | Medium leaf |
| `markdownParser.js` | 552 | Medium leaf |
| `cssVars.js` | 1,167 | Large leaf |
| `preload.js` | 2,026 | ~80 `window.avb` methods; sandboxed preload must stay CJS; Phase 2 typed `AvbBridge` applies |
| `astroParser.js` | 3,158 | **Flagship.** Own focused session; delete `astroParser.d.ts` on landing; then tighten `PageModel.frontmatterLayout.slots` from `unknown` to `ImportSlot[]` |
| `main.js` | 4,741 | ~111 IPC channels; largest single file; last electron item |

### src/ — 8 modules converted

`editorTree`, `pagePersistence` (WeakSet acks + drain caps),
`cleanError`, `branchName`, `loopBindings` (minimal-fidelity LiveNode),
`bindings` (parts protocol kept exact), `arrayValue`, `dataSuggest`
(1,117 lines; dataTree split; dead `resolvePath` deleted; fixed dropped
closing quote in samplePreview).

Remaining src leaves (36 top-level `.js`, 3,867 lines): `contentSchema` 321,
`cmsSchema` 303, `frontmatterMove` 252, `sound` 227, `elementSchemas` 196,
`gitActions` 188, `fluid` 174, `treeSelection` 137, `useListReorder` 134,
`canvasQuery` 118, `insertRank` 112, `instanceProps` 112, plus 24 smaller
(assetPath, assetPick, astroAssets, attrOrder, branches, canvasClick,
classAttr, classNames, componentName, dragState, extractProps, insertTarget,
jsCheck, liveClasses, outlineBoxes, pageOrder, previewRecovery, slotAttr,
spacingBands, terminalPaste, main.jsx, …).

### src/ui — 32 files, 6,457 lines ⬜

`Icons` 969, `RichContent` 606, `WelcomeBackground` 433, `ClassInput` 344,
`ExprInput` 336, `DataPicker` 308, `Dropdown` 303, `FileBrowser` 277,
`AssetField` 248, `CustomValueEditor` 243, `BindInput` 226, `StyleEditor`
200, + 20 smaller. None started.

### src/panels — 20 files, 13,990 lines ⬜

| File | Lines |
|---|---|
| `PropsPanel.jsx` | 3,819 — hotspot, convert-then-split, no split in same commit |
| `VariablesView.jsx` | 1,418 — holds 15 known conditional-hook bugs (fix them here) |
| `CmsView.jsx` | 1,246 |
| `GitChip.jsx` | 1,044 |
| `ContentView.jsx` | 1,001 |
| `StructurePanel.jsx` | 793 |
| `PreviewPane.jsx` | 727 |
| `AssetsPanel` 473 · `PalettePanel` 455 · `PagesPanel` 442 · `HistoryPanel` 392 · `WelcomeScreen` 391 | small |

### src/App.jsx — 4,584 lines ⬜ hotspot, last

### style-panel — already TypeScript ✅

Converted in an earlier effort; not touched by Phase 3. Hotspots that need
splitting (convert-then-split discipline, one per commit):

| File | Lines |
|---|---|
| `clip-path/ClipPath.tsx` | 8,806 — split only, already .tsx |
| `EmbedEditor.tsx` | 4,745 |
| `TypographySection.tsx` | 1,538 |
| `lib/webflow.ts` | 1,058 |

### Cross-cutting rules for every conversion

- Parity-check against `git show HEAD:<file>.js` before commit; watch symbol
  identity (DELETE symbols differ per module instance) and
  `JSON.parse`-as-unknown lint errors (use an annotated binding + `toRecord`).
- Convert-then-split, never in one commit. Large files last.
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

| Task | State |
|---|---|
| Complete `IpcContract` channel inventory (only 6 of ~111 typed) | ⬜ before or with `main.js` |
| Fix 15 conditional-hook bugs in PropsPanel / VariablesView | ⬜ with those conversions |
| `release.sh` → TypeScript (`scripts/*.ts`, per AGENTS §17) | ⬜ |
| Tooling deps declared devDependencies (node_modules-incident repair) | ✅ |
| Node_modules incident recorded under Risks in plan | ✅ |

## Test-suite state

- Gate green at last run: 118/124, exit 0. Failed exactly: varsrowheight,
  codeprop, chipedit, jsguard, binding, codeeditorlifecycle — all quarantined.
- FLAKY: `hovercost`, `popoverdropdown` (load-sensitive).
- Regressed tests fixed during Phase 3: section-dot (quiescence polling, proven
  by bisect), outside-edit, self-writes, preview-recovery (regex loosened for
  converted formatting), backend-lifecycle (exports through vm wrapper).
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