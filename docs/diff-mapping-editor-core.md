# Diff-Mapping Editor Core — Implementation Plan

**Status: recommended, reconciled.** Supersedes the anchor-based variant in
`intent-projection-implementation.md` (not on file in this repo; retained by the
author as the fallback). This document is the **post-Phase-3 target**, not a
redirect of the TypeScript migration — intent work starts after the conversion
finishes, behind its corpus gate.

## 1. Decision

The editor core uses **diff-mapping with edit intents**. The file on disk is the
only state. The editor additionally holds `lastKnownBytes` per open file. A UI
edit references a node by its span in the last-known bytes. At apply time, the
processor maps that span through a diff from last-known to current bytes and
splices the edit at the mapped position. If the mapping is ambiguous or the node
is gone, the edit is rejected as stale.

One function carries the entire identity burden:

```
(lastKnownBytes, currentBytes, edit) → newText | rejected-stale
```

No anchors. No fingerprints. No version counters. No second identity system.

## 2. Why this decision

- It deletes the most machinery. Anchors, fingerprint schemas, normalization
  rules, and invalidation semantics are replaced by one pure function plus one
  stability-tuned diff algorithm.
- Its failure mode is huntable. A wrong-site mapping is a concrete, reproducible
  corpus finding. Normalization bugs in a fingerprint scheme hide.
- It fits the product's real environment. AI assistants edit files aggressively;
  diff-mapping tolerates unrelated external changes that would bounce off a
  fingerprint check. Fewer spurious rejections means fewer lost user gestures.
- The migration scaffolding is shared either way. Intents, Edit[] splices, the
  serial queue, the projection, and the morph diff were never identity-dependent.
  The identity swap is contained; the write-path change is not (see §9.1).

## 3. Architecture

```
external edit ──┐
                ▼
        ┌───────────────┐    push    ┌──────────────┐
        │ file on disk  │ ─────────► │ projection   │ ──► renderer
        │  (Layer 0)    │            │  (Layer 1)   │      (Layer 3)
        └───────▲───────┘            └──────────────┘
                │ write
        ┌───────┴───────┐
        │ intent        │
        │ processor (2) │
        └───────▲───────┘
                │ intents
            renderer
```

- **Layer 0 — Source.** The `.astro` file. Write pipeline unchanged: debounce,
  `serialQueue`, `selfWrites`.
- **Layer 1 — Projection.** Pure function `bytes → Projection`, repackaging the
  existing `astroParser`. Raw spans cover everything unmodeled.
- **Layer 2 — Intent processor.** Validates payload, maps the edit's span through
  the diff, splices, writes, triggers reprojection. Three typed outcomes.
- **Layer 3 — Renderer.** Owns no editable state. Compat adapter translates
  legacy gestures during migration, then dies.

## 4. Data model

Offsets are branded (`ByteOffset`, `Utf16Offset`), with conversion confined to
one function — this survives unchanged from the earlier plan. Intents are a
closed union; outcomes are three and total:

```
applied | rejected-stale | rejected-invalid
```

An edit reference is a span set in last-known coordinates plus a structural
path. Intents are **multi-span and multi-file from the start**: a loop rename
touches dozens of scattered spans atomically, `stripLostBindings` changes node
kinds, and CSS intents target other files (stylesheets, not the `.astro`). An
intent whose target set crosses files is one intent with per-file edit groups.
Identity is resolved at apply time, never stored. The ⇧⌘C trail, hover, and
selection resolve through the same mapping. One mechanism, three uses.

## 5. Module layout

```
shared/
  intent.ts              // Intent union, Outcome, decoders
  ref.ts                 // EditRef = span + path (no fingerprint)
  projection.ts          // ProjectedNode union, Projection, invariants
  limits.ts              // + projectionCacheMax, intentQueueMax, morphDiffMax, latencyBudgetMs
electron/
  diff.ts                // stability-tuned byte diff — the falsifiable core
  mapSpan.ts             // span mapping through diff; ambiguity → stale
  projectionCache.ts     // Map<path, {bytes, projection}>; invalidate on watcher push
  transforms/            // bytes × Intent → Edit[]; identical to earlier plan
  intentProcessor.ts     // validate → map → transform → serialQueue.write → reproject
src/
  intents.ts             // renderer-side intent emitters
  compat/adapter.ts      // legacy gestures → intents; dies at migration end
  morphDiff.ts           // projection diff → DOM ops
test/
  hostile/               // fixture corpus, rebuilt around mapping correctness
  parity/                // gesture corpus vs. legacy path
  transforms/property.test.js
```

Deleted versus the anchor plan: `anchor.ts` rules, `anchorHash.ts`, fingerprint
normalization. Added: `diff.ts` and `mapSpan.ts` — the real new work.

## 6. Key algorithms

- **Diff.** Stability-tuned, conservative on ambiguity. Judged by the corpus,
  not by a rule kept correct forever.
- **Mapping.** Ascending anchors; a span maps cleanly or the edit is stale.
  No best-effort guessing.
- **Splice.** Edits applied in descending offset order. Every transform pure:
  bytes in, bytes out.
- **Morph.** Anchor-less projection diff matched by structural path; capped by
  `morphDiffMax`; past the cap, honest full reload.

## 7. Implementation sequence

Gate green at every step. Zero new dependencies. Ratchet count only decreases.

1. **Contracts and hostile corpus.** `intent.ts`, `ref.ts`, `projection.ts`,
   fixtures. Corpus targets wrong-site mappings, not anchor survival. The corpus
   **must include the hard intent classes from day one**: multi-span (loop
   rename), kind-changing (strip bindings), multi-file (CSS write to a
   stylesheet), and frontmatter slot edits. A `set-attribute`-only spike proves
   the easy 10%.
2. **Diff and mapping skeleton.** `diff.ts`, `mapSpan.ts`, `set-attribute` only.
3. **Spike.** Intent → map → splice → reproject against the corpus. Record
   mapping correctness and reproject-plus-diff latency. **Also record the adapter
   surface**: the direct node-mutation sites in `src/` (~123 found plus ~15
   prop-index writes in review) are the real migration cost, not the diff
   algorithm. That count is measured during the spike and tracked downward.
4. **Threshold decision.** Zero wrong-site applications; latency within budget.
   Fail → report and fall back to the anchor plan, which stays intact.
5. **Processor and cache.** Parallel single-gesture run with parity checks.
6. **Gesture expansion.** attribute → prop → insert/remove → move → CSS →
   frontmatter slots. Adapter surface shrinks monotonically.
7. **Morph diff.** Lands after attribute gesture is stable.
8. **Deletion.** Adapter, legacy tree, WeakSet acks, version counters.

## 8. Contingent upgrades — do not build now

- **Fingerprint verifier.** One lazy hash of the mapped node's slice, compared
  to a fingerprint recorded at edit creation. Restores structural zero-misapply
  if the corpus ever shows a wrong-site mapping. Trigger: corpus evidence only.
- **Document service.** Version-counter protocol making conflicts explicit;
  AI as a peer client. Promote only if a one-day sketch shows the parser's
  query surface fits a service boundary naturally. Until then, ⇧⌘C covers the
  legibility goal at a fraction of the cost.
- **Rejected permanently.** Identity written into the file. It would make nodes
  self-naming and it violates the core constraint: preserve bytes the user did
  not touch.

## 9. Reconciled against the codebase

One structural review (at the time of writing) corrected three misjudgments;
all are folded in above.

9.1 **The current write path re-serializes the whole file from a mutated tree.**
External edits landing between parse and write are overwritten, not merged. The
plan fixes this — which means the write path and every mutation site change
shape. The identity swap is contained; the write-path change is the real work.

9.2 **"Renderer owns no editable state" is a renderer-wide refactor.** ~123
direct node-field mutation sites plus prop-index writes across `src/`; panels
mutate shared nested structures; node-keyed state (selection, expansion, focus)
keys on `n\d+` ids that do not survive reparse. This is simultaneously the
largest cost and an argument for the plan: the current identity scheme is worse
than the plan assumed.

9.3 **Contract-layer name collision.** This plan's `shared/projection.ts` and
the existing `shared/page-node.ts` are one owner. Rename in the contract layer
before both grow.

The review also downgraded its own earlier `LiveModel` + version-counter
recommendation, converging with this plan: convert mutating modules with minimal
fidelity — local mutable mirrors, no deep identity design — because the intent
processor deletes that layer. Do not build polish that the deletion step removes.

## 10. Honest risks

- The corpus is the arbiter. Its quality gates everything; treat low fixture
  diversity as a failed gate, not a passed one.
- The diff algorithm is a real new artifact. Its conservatism is the safety
  margin now, and it must be judged, not assumed.
- Steady-state cost per edit is one file-scale diff. The latency budget decides
  if that is acceptable; cache diff results if it is not.
- Staleness semantics loosen versus fingerprints: some edits apply that anchors
  would have rejected. Whether that trade holds is a product judgment the corpus
  informs.

### Open questions raised in review (resolve before intent work starts)

- **Threshold timing.** §7.4's go/no-go follows a `set-attribute`-only spike,
  so its "zero wrong-site applications" evidence covers the easy class. Re-affirm
  the threshold after at least one multi-span and one multi-file intent pass the
  corpus, or defer the decision until then.
- **`lastKnownBytes` chaining.** Between an intent's write and reprojection,
  the user keeps gesturing; subsequent intents reference stale coordinates. The
  processor should advance `lastKnownBytes` synchronously per *accepted* intent
  (applying its own edits locally), not per reprojection.
- **Undo semantics.** Under file-as-state, undo is an inverse intent or a byte
  restore; a byte restore collides with concurrent external edits in exactly the
  way diff-mapping was chosen to tolerate. Decide before gesture expansion.
- **Structural-path move-blindness in morph.** Index-based paths shift when a
  sibling is inserted above; the morph diff reads that as delete+insert rather
  than move. Correct but non-minimal DOM ops — acceptable if the latency budget
  holds.

## 11. Standing rules

Unchanged: AGENTS.md normative, gate green per step, behavior preservation by
parity, verify before claiming, commit only per workflow, improve only touched
code. The earlier plan's sections on feature coverage, verification discipline,
and TypeScript enforcement carry over verbatim.
