# Workbench MCP Read Plane Status

## Scope

This slice establishes the read-only capability plane between School Workbench state and a future Agent Host.

Implemented boundaries:

- Workbench remains the state owner. SQLite is opened only by Workbench-side repositories.
- `packages/workbench-read-plane` owns immutable read DTO contracts, bounded capability queries, short-lived capability tokens, and the loopback server lifecycle.
- `packages/workbench-mcp` is the stdio MCP subprocess. It does not import or open the Workbench database; it reaches state only through the scoped Internal Local API.
- The Internal Local API binds only to `127.0.0.1` on an OS-assigned random port and is not a public REST product surface.
- This slice provides a bootstrap factory only. Electron does not start the loopback server today. The future Agent Host is responsible for start/stop, token issue/revoke, and spawning the MCP subprocess with the four scoped environment values.

## Read tools and scopes

The MCP server exposes exactly:

```text
school_context   -> school.read
stage_current    -> stage.read
state_current    -> state.read
state_history    -> state.read
evidence_list    -> evidence.read
diagnosis_list   -> diagnosis.read
standards_get    -> standards.read
```

No write, review, approval, activation, commit, health, or debug Tool is registered.

`@modelcontextprotocol/server` and `@modelcontextprotocol/client` are pinned to `2.0.0`. The server uses the official stdio transport. Protocol output is stdout-only; bootstrap failures and process diagnostics are stderr-only.

## Capability token model

Capability tokens are cryptographically strong opaque values held only in memory. The token store binds each token to:

```text
agentRunId
schoolId
exact read scopes
issuedAt
expiresAt
revokedAt
```

The store keeps a SHA-256 token digest as its lookup key rather than the raw token. Default TTL is five minutes, maximum TTL is fifteen minutes, revoke is supported, and process restart naturally invalidates every issued token.

Bearer authorization fails closed for missing, unknown, expired, revoked, insufficient-scope, run-mismatch, and school-mismatch cases. Error envelopes and safe logs contain only stable error codes/messages and never include the token. Optional `schoolId` in a Tool input is only a convenience assertion and must equal the injected run scope.

## Read contracts

`school_context` returns the scoped School, optional active Stage summary/focus, optional latest formal Snapshot summary, and at most ten AcceptedJudgments ordered by `createdAt DESC, id DESC`.

`stage_current` returns the active Stage and exactly five confirmed canonical StageTargets. No active Stage produces typed `no_active_stage` absence.

`state_current` returns the latest immutable Snapshot, exactly five canonical DimensionAssessments, snapshot judgment provenance, and assessment-level judgment provenance. No Snapshot produces typed `no_snapshot` absence.

`state_history` is bounded to at most twenty rows per call and ordered by Snapshot sequence descending using `beforeSequence` pagination.

`evidence_list` is bounded to at most fifty rows and uses a stable `createdAt DESC, id DESC` cursor. It returns source/locator/hash/capture/registration provenance and at most a 240-character normalized inline preview; it never returns the full `inline_text` field.

`diagnosis_list` is bounded to at most twenty-five rows and uses the same stable cursor order. It returns immutable DiagnosisProposal metadata plus Claim, Criterion/Pack, and StageTarget references. HumanReview decisions are intentionally absent.

`standards_get` requires `packKey`, `version`, and at least one bounded filter (`dimensionKeys`, `practiceType`, or `criterionRefs`). A result is available only when the file Registry and persisted SQLite projection are both `active` and exactly match key/version/content hash/source fingerprint/criterion projection. The response contains only the selected Criteria, their required Constructs/ancestors, selected BehaviorAnchors, evidence guidance, counter indicators, relevant inference guardrails, source locators, and pack/version/hash provenance. At the end of this slice the repository's real Schooling by Design and Data Wise packs were `review`, so product queries returned typed `no_active_pack`. **Superseded on 2026-08-17**: both packs now ship `active` and product queries return a projection unless the consultant has withdrawn the pack in the app. See `METHODOLOGY_PACK_ACTIVATION_STATUS.md`.

## Persistence and schema

No database schema was added or changed. The read plane uses existing School, Stage, Snapshot, Evidence, Diagnosis, Methodology, and provenance tables. There is no new migration and no current pointer or runtime table.

## Verification boundary

Tests cover two-school isolation, typed Stage/Snapshot absence, five-dimensional current-state provenance, bounded stable State/Evidence/Diagnosis pagination, token authorization/revocation/expiry/scope/run/school failures, token non-leakage, methodology active/review/retired and drift cases, and a process-level official MCP SDK client against the real stdio server.

The process integration initializes the server, checks the exact seven-Tool list, calls every read Tool, verifies stable scoped errors, and checks EOF/SIGTERM shutdown without stdout pollution.

## Explicitly not implemented

This slice does not implement `evidence_register`, `diagnosis_propose`, Agent Host, ACP/DSH/Codex integration, visible Electron UI, Pack activation UI or Pack status changes, Agent Run tables, Feishu/lark-cli/OAuth, RAG/FTS/vector retrieval, local file/audio ingestion, Congruence, or Role Standards.
