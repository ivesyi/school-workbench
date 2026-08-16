# Methodology Registry Foundation Status

## Scope

This foundation turns the two existing human-review Markdown baselines into versioned, validated runtime knowledge without connecting methodology to assessment reasoning.

Runtime inputs in this slice:

- `knowledge/methodology/schooling-by-design-v1/pack.json`
- `knowledge/methodology/data-wise-v3/pack.json`
- `references/SOURCE_MANIFEST.md`

The Markdown `PACK.md` files remain the human-review baseline. The JSON files are engineering translations of content already present there: constructs, C1–C5 criteria, supporting/counter evidence, insufficient-evidence notes, boundaries/counterexamples, Agent guardrails, and source locators. No score, weight, maturity level, or BehaviorAnchor was invented; both current packs therefore have an empty `behaviorAnchors` array.

## Review status

Both machine-readable packs use `status = review`, not `active`.

The current Markdown proves a human-review baseline but does not prove that this specific machine translation has been explicitly approved as an active runtime standard. Activation requires a consultant review of the translated stable IDs, criterion wording, evidence guidance, boundaries/guardrails, source locators, source fingerprints, and canonical content hashes. This slice does not auto-activate packs.

Lifecycle status is deliberately separate from immutable methodology content. `canonicalContentHash` excludes both itself and `status`, so a reviewed, unchanged pack can move through the explicit one-step lifecycle `draft → review → active → retired` without creating a false content revision. Repository sync rejects rollback, skipped states, retired revival, and any same key+version content change. A valid status transition updates only `methodology_packs.status`; criteria, behavior anchors, `created_at`, and the canonical content hash remain unchanged.

## Runtime contract

`@school-workbench/methodology` provides strict contracts for MethodologyPack, Construct, Criterion, BehaviorAnchor, EvidenceGuidance, InferenceGuardrail, source locators, applicability, and canonical dimensions. Loader validation is fail-closed for unsupported schema versions, unknown fields, duplicate IDs, dangling parent/construct references, invalid canonical dimensions, missing locators, incomplete guidance, source fingerprint mismatch, and canonical content hash mismatch.

Registry values are recursively frozen. Queries support pack key+version, stable criterion ID, construct, canonical dimension, practice type, pack key, and version. If the same stable criterion exists in multiple loaded versions, an unqualified lookup is rejected as ambiguous rather than silently choosing a version.

The source manifest fingerprints consultant-local PDFs with SHA-256. Those source PDFs may exist under ignored local `references/books` or `references/frameworks` paths for consultant verification; they must not be Git-tracked, copied into `knowledge/methodology`, or included in Electron/application build output.

## SQLite seam

A forward migration adds `methodology_packs`, `methodology_criteria`, and `behavior_anchors`. Pack source fingerprint and canonical content hash are persisted. Criterion evidence guidance, counter indicators, applicability+effective guardrails, and source locator are persisted as JSON values; relationships that have database entities use FKs rather than JSON ID lists.

`SqliteMethodologyRepository.syncRegistry` is append/version oriented:

- same key+version+hash, same status, and equal persisted content projection: no-op;
- same key+version+hash and equal persisted content projection may advance exactly one lifecycle state;
- same key+version with changed content: reject;
- lifecycle rollback, skipped state, or retired revival: reject;
- a new version: coexist with history;
- criterion parent and anchor references are validated within pack scope;
- DB reads fail closed on malformed JSON, invalid dimensions/status/source types, or cross-pack parent corruption.

Construct definitions remain owned by the file registry in this foundation because DATABASE_SCHEMA v1.2 intentionally defines persistence tables for packs, criteria, and behavior anchors only. DB round-trip tests compare the persistence projection of the file registry, not a fabricated construct table.

## Explicitly deferred

Not implemented here: AssessmentEngine changes, Diagnosis criterion mapping, Golden Cases, RAG/FTS/vector retrieval, real Agent runtime, ACP/MCP/`standards_get`, Feishu, UI/IPC, Congruence Pack, Role Standards Pack, or methodology-driven scoring. Congruence and Role Standards wait for their own sufficiently reviewed structured baselines.
