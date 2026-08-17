# Methodology Pack Review and Activation Status

## Scope

This slice builds the complete path from "a machine translation of a published methodology exists in the repository" to "a consultant can constrain, or refuse, its use in real judgment", and connects the methodology registry to the Electron runtime for the first time.

Implemented in this slice:

- Electron main loads the file registry (`knowledge/methodology` + `references/SOURCE_MANIFEST.md`) and calls `SqliteMethodologyRepository.syncRegistry` exactly once per launch.
- An in-app review workbench under settings shows the full reviewable content of each Pack and records a per-criterion conclusion.
- A new forward migration persists consultant sign-offs bound to exact Pack content.

**Both repository Packs ship as `status = active` and are in use with no consultant action.** See "Design decision".

## Design decision (revised 2026-08-17)

The first version of this slice made the consultant's sign-off a _gate_: both Packs shipped as `review`, ten per-criterion verdicts had to be given before a sign-off could be submitted, and a repository command (`pnpm methodology:activate --apply`) rewrote `pack.json` from `review` to `active`.

The consultant rejected that design on 2026-08-17 as a violation of the product's own principles — `PRD.md:1467` ("方法论、书籍检索和 RAG 不进入日常 UI"), PRD chapter 52 ("能自动记录的不维护。" / "能直接完成的不让用户选择。") and `SPEC.md` "Zero-Maintenance UX". The default is now inverted:

```text
pack.json ships status = active           (never rewritten at runtime)
  -> syncRegistry resolves the persisted status from the latest sign-off
  -> no sign-off, or an approving sign-off  -> active, in use, zero consultant action
  -> any criterion marked 需要修订           -> changes_requested sign-off
                                            -> persisted status drops to review
                                            -> standards_get and GroundedDiagnosisService fail closed
  -> every criterion marked 可以用于判断 again -> approved sign-off -> back to active
```

Two consequences of the inversion are load-bearing:

- **Runtime status lives in SQLite only.** `SPEC.md` 24.2 requires the file Registry _and_ persisted SQLite to both be `active`, so lowering the database side alone is enough to fail closed. `pack.json` therefore keeps its factory value and is never written at runtime — an Electron app must not write into its own read-only resource directory.
- **A veto is never silently overturned.** `syncRegistry` no longer copies the file status into the database. It resolves the target status through `resolvePackRuntimeStatus(fileStatus, latestSignOff)`, so a Pack the consultant withdrew stays withdrawn across every restart even though the file still says `active`. The veto also survives content drift (decision D5): a later edit invalidates the earlier _verdicts_ but does not restore the Pack to use; only an approving re-review does.

`canonicalContentHash` still excludes `status`, so neither Pack needed a version bump and neither content hash changed.

### Removed with the inversion

`packages/methodology/src/activation.ts` (the eight-code activation gate), `packages/db/src/activate-methodology-pack*.ts` and the `pnpm methodology:activate` / `build:methodology-cli` scripts were deleted. With Packs shipping `active`, the gate's very first check (`file_not_in_review`) could never pass again, and its only remaining action — rewriting `pack.json` — is exactly what the new design forbids. A command that always refuses is a maintenance trap, not a safety net.

## Review outcome (2026-08-17, historical — recorded before the inversion)

Under the original gate design, the consultant review of the ten translated criteria concluded that **this translation is not yet sufficient to constrain real judgment**, so no sign-off was recorded and no Pack was activated. That conclusion is kept here because the content facts behind it are still accurate; the _consequence_ — no Pack in use — was reversed later the same day by the design decision above.

Facts that drove the conclusion:

| Observation                                          | Extent                       |
| ---------------------------------------------------- | ---------------------------- |
| `description` is byte-identical to `title`           | 10 / 10 criteria             |
| `dimensionKey` is `null`                             | 10 / 10 criteria             |
| `behaviorAnchors` is empty                           | both Packs (0 anchors total) |
| `collectionPrinciples` is empty                      | 9 / 10 criteria              |
| `adjustmentConditions` is empty                      | 9 / 10 criteria              |
| `counterexampleChecks` is empty                      | 8 / 10 criteria              |
| `insufficientEvidence` is empty                      | 6 / 10 criteria              |
| `supportingIndicators` / `counterIndicators` present | 10 / 10 criteria             |

(Counts recomputed from the two `pack.json` files during this slice. The task brief expected `insufficientEvidence` to be populated everywhere; it is empty for six of the ten criteria.)

Consequences that follow from the above and are not defects of this slice:

- (Superseded by the 2026-08-17 inversion.) `standards_get` returned typed `no_active_pack` in the product while the Packs shipped as `review`. They now ship `active`, so it returns a projection unless the consultant has withdrawn the Pack.
- (Superseded.) `GroundedDiagnosisService` could not resolve criterion references against a persisted active Pack. It now can; connecting it to the live flow is still a separate, unstarted slice.
- The `dimensionKeys` filter of `standards_get` was inert for these Packs; see the addendum below.

### Addendum (2026-08-17, commit `fcd4981`)

The table above records the content as it stood at commit `ab08537`. Two rows have since changed and the "all still true" claim no longer holds for them:

- The consultant assigned every criterion to a congruence dimension, so `dimensionKey` is now populated for 10 / 10 criteria and the `dimensionKeys` filter of `standards_get` is no longer inert. The mapping is the consultant's own professional judgment; it is not derived from `WORKBENCH-METHODOLOGY-CROSSWALK.md`, which deliberately does not map criteria onto the congruence dimensions. **The rationale for each assignment is not yet recorded anywhere and should be.**
- The Packs kept `version` 1 and 3 while their content changed, so `canonicalContentHash` was recomputed in place. Any SQLite projection persisted from the earlier content will now be rejected by `syncRegistry` with `already exists with different content`; such a database must be discarded or the Packs must be re-versioned before the projection can be refreshed.

Every other row is unchanged. Under the revised design these gaps no longer block use: the Packs are in use by default and it is the consultant's own call, per criterion, whether a gap is severe enough to withdraw the Pack.

Outstanding work list for a later slice ("补翻译"), explicitly **not** done here:

1. Write a real `description` for each of the ten criteria from the printed source, distinct from the title.
2. Decide, per criterion, whether it maps to one of the five canonical dimensions or is deliberately dimension-free, and record the decision.
3. Decide whether behavior anchors exist in the sources; if they do not, record that as an explicit boundary instead of an empty array.
4. Fill `counterexampleChecks`, `collectionPrinciples` and `adjustmentConditions`, or state why the source does not supply them.
5. Re-run the in-app review. The new content produces a new `canonicalContentHash`, so any earlier sign-off is automatically invalid rather than silently inherited — except that an earlier _refusal_ keeps the Pack out of use until the consultant looks again (D5).

The review workbench surfaces every one of these gaps per criterion, so the conclusion is reproducible from the UI rather than from this document.

## Runtime wiring

`apps/desktop/src/main/methodology-runtime.ts` resolves the methodology inputs in this order:

1. `SWB_METHODOLOGY_ROOT` / `SWB_SOURCE_MANIFEST` (used by tests and by the degraded-startup E2E);
2. the copy next to the main bundle — `electron-vite` copies each `pack.json` and `references/SOURCE_MANIFEST.md` into `out/main/`, mirroring the existing `drizzle` copy;
3. the repository checkout, four levels above `out/main`, for a development run before the copy exists.

Only `pack.json` files and the manifest are copied. Raw reference PDFs never enter build output, and `packages/methodology/src/packaging-boundary.test.ts` still guards that line.

Loading is deliberately off the startup critical path: the runtime promise is created, IPC handlers are registered against it, and the window is created without awaiting it. Any failure — missing directory, unreadable manifest, fingerprint mismatch, hash mismatch, content drift against the persisted projection — resolves to a quiet `unavailable` state. There is no dialog, no crash, and the rest of the workbench is unaffected.

## Review workbench

The entry point sits behind `高级设置` on the settings page and is not part of the primary navigation. For each Pack the workbench shows the conclusion first, then constructs and their assessment questions, then every criterion in full: description, applicability boundaries, supporting/counter indicators, insufficient-evidence notes, collection principles, adjustment conditions, inference guardrails and source locators. Each criterion carries the concrete gaps computed from its own content, a verdict (`可以用于判断` / `需要修订`) and an optional open question.

**Every criterion is pre-selected as `可以用于判断`.** A consultant who agrees with the default never has to open the page, and there is no completeness threshold on the save button — the previous "all ten decided before you may submit" gate is gone. Saving records one sign-off covering every criterion, so a single `需要修订` withdraws the Pack immediately. Identifiers, fingerprints and content fingerprints live inside a collapsed `更技术的信息` disclosure; per ADR-003 no internal state name (`active`, `review`, `sync`, `hash`) appears anywhere on the page, only the consultant-language label of what is currently happening.

## Invariants

- The renderer never touches SQLite. Both new channels go through typed IPC and every payload is parsed with Zod on the preload, main and service boundaries.
- The sign-off decision is **derived** from the per-criterion verdicts. A caller cannot declare a Pack approved while any criterion is marked `needs_revision`.
- A sign-off must cover every criterion of the Pack exactly once. Missing, duplicate, unknown or cross-Pack criterion keys are rejected.
- A sign-off is bound to `pack key + version + canonicalContentHash`. When content changes the hash changes, the stored sign-off is reported as outdated and previous per-criterion verdicts stop being shown as current. A stale _approval_ therefore never counts as an approval again; a stale _refusal_ still keeps the Pack out of use until the consultant looks at the new content (D5).
- Sign-offs are append-only. Re-reviewing writes a new row; the latest row wins and the earlier act stays auditable. Re-using an existing sign-off id is rejected.
- The lifecycle graph is `draft → review`, `review → active`, `active → review | retired`, and `retired` is terminal. `active → review` exists precisely so a consultant can withdraw a Pack; rollback to `draft`, reviving a retired Pack and skipping states are all still refused.
- **A consultant refusal is never silently overturned.** `syncRegistry` resolves the persisted status from the latest sign-off, so a Pack withdrawn in the app stays withdrawn across restarts, and a refusal recorded against content that has since drifted still keeps the Pack out of use.
- `canonicalContentHash` still excludes itself and `status`, so flipping the lifecycle status changes no content hash and requires no version bump.
- `pack.json` is never written at runtime. The only writers of methodology rows are `SqliteMethodologyRepository.syncRegistry` and `setPackStatus`, and the latter is reachable only from a recorded consultant sign-off.
- `workbench-read-plane` was not modified. `standards_get` still requires file registry and SQLite projection to both be `active`.
- No score, weight, maturity total or ranking was introduced. Verdicts are two named states with no ordering arithmetic, and the counts shown in the UI are counts, not a grade.
- Historical migrations were not rewritten. `0007_methodology_pack_sign_off.sql` is additive and the journal and snapshot were regenerated forward.

## Withdrawal path

There is no repository command and no terminal step. The consultant opens `设置 → 高级设置 → 方法论内容审核`, changes any criterion to `需要修订`, and saves. From that moment `standards_get` returns `no_active_pack` and `GroundedDiagnosisService` refuses with `ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH`. Changing every criterion back to `可以用于判断` and saving puts the Pack straight back into use.

## Verification boundary

Tests cover: sign-off decision derivation and coverage rules; hash-drift invalidation at domain, repository and service level; `resolvePackRuntimeStatus` for the default-in-use, withdrawn, restored, drifted-veto and drifted-approval cases; the `0007` migration on a fresh database and forward over an existing one without rewriting earlier methodology rows; append-only sign-off storage and latest-wins reads; `syncRegistry` refusing to restore a withdrawn Pack across repeated syncs, honouring a veto recorded against drifted content, restoring the Pack only after an approving sign-off, and projecting a vetoed Pack straight into `review` on a database that never saw it; `setPackStatus` transition rules and unknown-pack rejection; retired revival rejection; `standards_get` failing closed the moment the Pack is withdrawn and staying closed after a re-sync; a runtime-level relaunch that keeps a withdrawn Pack out of use; startup path resolution and quiet degradation when methodology content cannot be read; IPC validation and the unavailable envelope; and the review workbench UI for content display, gap display, the pre-selected usable default, saving with no interaction, per-criterion withdrawal and the degraded state. Two E2E specs launch the real desktop app: one asserts the Packs load at startup and are in use, the other asserts the product flow still works when the methodology root does not exist.

Full suite as re-run at the end of this slice: `pnpm test` — 45 test files, 175 tests, all passing (before the inversion: 47 files, 174 tests; the two deleted files are the activation gate's own tests). `pnpm test:e2e` — 8 passing. `pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm build` are clean.

This establishes protocol, reference and process correctness only. It does not establish that the translated methodology is professionally correct — which is precisely why the review concluded as it did.

## Not done in this slice

Agent Host, ACP / DSH / Codex, the MCP write plane (`evidence_register`, `diagnosis_propose`), starting the loopback server from Electron, connecting `GroundedDiagnosisService` to the live flow, replacing `BaselineAssessmentEngine`, RAG / FTS / vector retrieval, Feishu, local file and audio evidence, the teacher practice slice, the Congruence Pack, the Role Standards Pack, and **supplying the missing Pack translation content**.

## Known limitations

- Both Packs are in use, but the translation gaps listed above are real. The mechanism no longer holds them back; the consultant does, per criterion, if he decides to.
- The review workbench holds an unsaved draft in component state only. A refresh or restart before saving loses the in-progress changes, exactly like the existing transient state drafts.
- The per-criterion gap list is computed from the Pack content itself. It reports what is structurally absent; it does not evaluate whether present text is professionally adequate.
- `SqliteMethodologyReviewRepository` stores sign-offs keyed by pack key and version rather than by a foreign key into `methodology_packs`, so a review can outlive a Pack row. This is intentional — the sign-off is a record of a human act, not a projection of a Pack — but it means sign-off rows are not cascade-deleted with a Pack.
