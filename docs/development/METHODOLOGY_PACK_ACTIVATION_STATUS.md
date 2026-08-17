# Methodology Pack Review and Activation Status

## Scope

This slice builds the complete path from "a machine translation of a published methodology exists in the repository" to "a consultant has formally accepted it as a constraint on real judgment", and connects the methodology registry to the Electron runtime for the first time.

Implemented in this slice:

- Electron main loads the file registry (`knowledge/methodology` + `references/SOURCE_MANIFEST.md`) and calls `SqliteMethodologyRepository.syncRegistry` exactly once per launch.
- An in-app review workbench under settings shows the full reviewable content of each Pack and records a per-criterion conclusion.
- A new forward migration persists consultant sign-offs bound to exact Pack content.
- A repository command promotes a reviewed Pack from `review` to `active` in `pack.json` only when file, database and sign-off all agree.

**Both repository Packs are still `status = review` at the end of this slice. Nothing was activated.** See "Review outcome".

## Design decision

The activation state is owned by the versioned file, not by the database (option A of `METHODOLOGY_PACK_ACTIVATION_BRIEF.md`, decided by the user on 2026-08-17):

```text
in-app review workbench
  -> sign-off row bound to pack key + version + canonicalContentHash + per-criterion verdicts
  -> repository command verifies sign-off, content and one-step lifecycle
  -> pack.json status review -> active, committed by a human
  -> next launch, syncRegistry advances the SQLite projection to active
```

The alternative (letting the database own the lifecycle and relaxing the read plane) was rejected: it would have broken the invariant frozen in the previous slice and would leave a file that says `review` behaving as `active` at runtime.

The cost is that activation requires one repository commit. For a single-user, local-first tool whose consultant and developer are the same person, that cost is acceptable and it keeps a Pack a versioned derivative of a published source.

## Review outcome (2026-08-17)

The consultant review of the ten translated criteria concluded that **this translation is not yet sufficient to constrain real judgment**, so no sign-off was recorded and no Pack was activated. The mechanism is complete and tested; the content is not ready.

Facts that drove the conclusion, all still true in the repository:

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

- `standards_get` still returns typed `no_active_pack` in the product, because activation requires both the file registry and the SQLite projection to be `active`.
- `GroundedDiagnosisService` still cannot resolve criterion references against a persisted active Pack, so it stays off the live flow.
- The `dimensionKeys` filter of `standards_get` remains inert for these Packs; only `practiceType` and `criterionRefs` select anything.

### Addendum (2026-08-17, commit `fcd4981`)

The table above records the content as it stood at commit `ab08537`. Two rows have since changed and the "all still true" claim no longer holds for them:

- The consultant assigned every criterion to a congruence dimension, so `dimensionKey` is now populated for 10 / 10 criteria and the `dimensionKeys` filter of `standards_get` is no longer inert. The mapping is the consultant's own professional judgment; it is not derived from `WORKBENCH-METHODOLOGY-CROSSWALK.md`, which deliberately does not map criteria onto the congruence dimensions. **The rationale for each assignment is not yet recorded anywhere and should be.**
- The Packs kept `version` 1 and 3 while their content changed, so `canonicalContentHash` was recomputed in place. Any SQLite projection persisted from the earlier content will now be rejected by `syncRegistry` with `already exists with different content`; such a database must be discarded or the Packs must be re-versioned before the projection can be refreshed.

Every other row is unchanged, and no Pack has been activated.

Outstanding work list for a later slice ("补翻译"), explicitly **not** done here:

1. Write a real `description` for each of the ten criteria from the printed source, distinct from the title.
2. Decide, per criterion, whether it maps to one of the five canonical dimensions or is deliberately dimension-free, and record the decision.
3. Decide whether behavior anchors exist in the sources; if they do not, record that as an explicit boundary instead of an empty array.
4. Fill `counterexampleChecks`, `collectionPrinciples` and `adjustmentConditions`, or state why the source does not supply them.
5. Re-run the in-app review. The new content produces a new `canonicalContentHash`, so any earlier sign-off is automatically invalid rather than silently inherited.

The review workbench surfaces every one of these gaps per criterion, so the conclusion is reproducible from the UI rather than from this document.

## Runtime wiring

`apps/desktop/src/main/methodology-runtime.ts` resolves the methodology inputs in this order:

1. `SWB_METHODOLOGY_ROOT` / `SWB_SOURCE_MANIFEST` (used by tests and by the degraded-startup E2E);
2. the copy next to the main bundle — `electron-vite` copies each `pack.json` and `references/SOURCE_MANIFEST.md` into `out/main/`, mirroring the existing `drizzle` copy;
3. the repository checkout, four levels above `out/main`, for a development run before the copy exists.

Only `pack.json` files and the manifest are copied. Raw reference PDFs never enter build output, and `packages/methodology/src/packaging-boundary.test.ts` still guards that line.

Loading is deliberately off the startup critical path: the runtime promise is created, IPC handlers are registered against it, and the window is created without awaiting it. Any failure — missing directory, unreadable manifest, fingerprint mismatch, hash mismatch, content drift against the persisted projection — resolves to a quiet `unavailable` state. There is no dialog, no crash, and the rest of the workbench is unaffected.

## Review workbench

The entry point sits behind `高级设置` on the settings page and is not part of the primary navigation. For each Pack the workbench shows the conclusion first, then constructs and their assessment questions, then every criterion in full: description, applicability boundaries, supporting/counter indicators, insufficient-evidence notes, collection principles, adjustment conditions, inference guardrails and source locators. Each criterion carries the concrete gaps computed from its own content, one required verdict (`可以用于判断` / `需要修订`) and an optional open question. Identifiers, fingerprints, hashes, file/database status and the activation command live inside a collapsed `更技术的信息` disclosure.

## Invariants

- The renderer never touches SQLite. Both new channels go through typed IPC and every payload is parsed with Zod on the preload, main and service boundaries.
- The sign-off decision is **derived** from the per-criterion verdicts. A caller cannot declare a Pack approved while any criterion is marked `needs_revision`.
- A sign-off must cover every criterion of the Pack exactly once. Missing, duplicate, unknown or cross-Pack criterion keys are rejected.
- A sign-off is bound to `pack key + version + canonicalContentHash`. When content changes the hash changes, the stored sign-off is reported as outdated, previous per-criterion verdicts stop being shown as current, and activation is refused with `sign_off_outdated`.
- Sign-offs are append-only. Re-reviewing writes a new row; the latest row wins and the earlier act stays auditable. Re-using an existing sign-off id is rejected.
- Activation advances exactly one lifecycle state. `draft → active`, `active → active`, `retired → active` and any rollback are refused, in the file gate and in `syncRegistry` alike.
- `canonicalContentHash` still excludes itself and `status`, so activation rewrites only the status line of `pack.json` — verified byte-for-byte — and produces no false content revision.
- The single write path into methodology tables is still `SqliteMethodologyRepository.syncRegistry`. The activation command never writes methodology rows; it only reads the persisted status and rewrites the file.
- `workbench-read-plane` was not modified. `standards_get` still requires file registry and SQLite projection to both be `active`.
- No score, weight, maturity total or ranking was introduced. Verdicts are two named states with no ordering arithmetic, and the counts shown in the UI are counts, not a grade.
- Historical migrations were not rewritten. `0007_methodology_pack_sign_off.sql` is additive and the journal and snapshot were regenerated forward.

## Activation command

```bash
pnpm methodology:activate --pack <key> --version <version> [--database <path>] [--apply]
```

Without `--apply` it only reports the decision. The gate refuses with a stable code and a plain explanation:

| Code                      | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `content_hash_mismatch`   | the declared canonical content hash no longer describes the file |
| `file_not_in_review`      | `pack.json` is not `review`, so this would not be a single step  |
| `not_persisted`           | the Pack has never been loaded into this local database          |
| `persisted_not_in_review` | the database already moved past `review`                         |
| `no_sign_off`             | no consultant review exists for this Pack version                |
| `sign_off_outdated`       | the content changed after it was reviewed                        |
| `sign_off_not_approved`   | the review asked for revisions                                   |
| `sign_off_incomplete`     | the review does not cover every criterion                        |

The database defaults to the desktop app data path for the current unpackaged build (`Electron/school-workbench.sqlite`), overridable with `--database` or `SWB_DATABASE_PATH`.

## Verification boundary

Tests added in this slice cover: sign-off decision derivation and coverage rules; hash-drift invalidation at domain, repository and service level; the `0007` migration on a fresh database and forward over an existing one without rewriting earlier methodology rows; append-only sign-off storage and latest-wins reads; the activation gate for accept and every refusal path, using an isolated temporary copy of a Pack and a temporary database; the persisted projection following the file exactly one step later; retired revival rejection in `syncRegistry`; startup path resolution and quiet degradation when methodology content cannot be read; IPC validation and the unavailable envelope; and the review workbench UI for content display, gap display, per-criterion submission, recorded outcome and the degraded state. Two E2E specs launch the real desktop app: one asserts the Packs load at startup and remain awaiting review, the other asserts the product flow still works when the methodology root does not exist.

Full suite as re-run at the end of this slice: `pnpm test` — 47 test files, 174 tests, all passing (previous slice: 38 files, 131 tests); `pnpm test:e2e` — 8 passing (previous slice: 6). `pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm build` are clean.

This establishes protocol, reference and process correctness only. It does not establish that the translated methodology is professionally correct — which is precisely why the review concluded as it did.

## Not done in this slice

Agent Host, ACP / DSH / Codex, the MCP write plane (`evidence_register`, `diagnosis_propose`), starting the loopback server from Electron, connecting `GroundedDiagnosisService` to the live flow, replacing `BaselineAssessmentEngine`, RAG / FTS / vector retrieval, Feishu, local file and audio evidence, the teacher practice slice, the Congruence Pack, the Role Standards Pack, and **supplying the missing Pack translation content**.

## Known limitations

- Nothing is activated. Every capability that waits on an active Pack still waits.
- The default database path mirrors the current unpackaged Electron app name. Packaging is not implemented, so this default will need revisiting when a product name and app id are chosen; `--database` covers every other case today.
- Activation requires a repository commit by a human. That is the deliberate cost of option A, not an oversight.
- The review workbench holds an unsubmitted draft in component state only. A refresh or restart before submission loses the in-progress verdicts, exactly like the existing transient state drafts.
- The per-criterion gap list is computed from the Pack content itself. It reports what is structurally absent; it does not evaluate whether present text is professionally adequate.
- `SqliteMethodologyReviewRepository` stores sign-offs keyed by pack key and version rather than by a foreign key into `methodology_packs`, so a review can outlive a Pack row. This is intentional — the sign-off is a record of a human act, not a projection of a Pack — but it means sign-off rows are not cascade-deleted with a Pack.
