# Validated Diagnosis Persistence Seam — implementation status

Status: implemented persistence seam; not connected to product live flow.

This slice connects the existing Assessment protocol quality gate to the canonical epistemic persistence model. `GroundedDiagnosisService` receives raw `AssessmentInput` and raw `AssessmentCandidate`, calls `validateAssessmentCandidate` itself, and only then asks the repository to persist an immutable `DiagnosisProposal`. Callers cannot supply a prevalidated flag or bypass protocol validation through the service API.

For `status = proposed`, the persisted Proposal carries the candidate's concise interpretations, provisional judgment, mechanism, alternative hypotheses, unresolved questions, recommended actions, next observations, impact evidence plan, evidence quality and confidence. For `status = insufficient_evidence`, `provisional_judgment` remains `NULL`; Claim, Criterion and StageTarget relationships may be empty. This is an abstention record, not an AcceptedJudgment.

Canonical provenance is relational: `candidate.claimRefs` maps to `diagnosis_claims`; exact `pack key + version + criterion stable id` is resolved through persisted `methodology_packs` / `methodology_criteria` and maps to `diagnosis_criteria`; `candidate.stageTargetRefs` maps to `diagnosis_stage_targets`. Evidence, ObservationFacts, Claims and ClaimFacts are not copied by this seam.

The SQLite save rechecks current persisted state inside the same transaction before inserting the Proposal: the school must still exist; the referenced Stage must still be active and same-school; StageTargets must still be confirmed members of that Stage; Evidence, Facts and Claims must match the validated input and school scope; ClaimFact stance tuples must not have drifted; persisted methodology must be the same active pack/version/content/source fingerprint and the exact Criterion projection held by the active file Registry. Any mismatch rolls back the whole save. Duplicate Proposal ids are rejected rather than updating historical proposals.

Human review remains a separate epistemic gate. A normal `proposed` Proposal keeps the four existing review decisions. An `insufficient_evidence` Proposal may only be `rejected` or `needs_more_evidence`; `accepted` and `modified` are rejected in Domain and SQLite repository boundaries and cannot create an `AcceptedJudgment`.

Repository Pack files remain `review`. Persistence tests use deep-copied in-memory Pack fixtures whose only lifecycle change is `status = active`, and sync the same active fixture projection into an isolated SQLite database. This test setup does not activate the repository Pack files or imply consultant approval.

Validation in this slice establishes protocol correctness, persisted-reference integrity, stale-write protection and provenance consistency. It does not establish that a substantive diagnosis is correct or consultant-approved.

Out of scope: IPC/UI wiring, existing `BaselineAssessmentEngine` changes, Pack activation UI, Diagnosis live-flow integration, real Agent/ACP/MCP, `standards_get`, RAG/FTS/vector retrieval, Feishu, Congruence Pack and Role Standards Pack.
