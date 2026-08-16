# Baseline School State Vertical Slice Status

## Scope

This slice implements only the first consultant-confirmed school state after an active Stage and AcceptedJudgments exist.

Flow:

```text
active Stage + confirmed StageTargets + AcceptedJudgments
→ deterministic StateAssessmentEngine
→ transient State Draft with five dimensions
→ consultant: 确认现在的状态 / 我想调整
→ immutable StateSnapshot #1 (is_baseline = true)
→ five persisted DimensionAssessments + FK provenance
```

## Invariants

- A draft is transient application state. Reading or adjusting it does not create a `state_snapshots` row.
- The engine reads only the active Stage, its five confirmed targets, and current AcceptedJudgments.
- Every draft covers exactly the canonical dimensions `leadership | key_tasks | structure | culture | capability`.
- Evidence-insufficient dimensions remain `unverified`; a non-`unverified` assessment must reference at least one AcceptedJudgment.
- The judgment set used by the engine is the same set persisted through `snapshot_judgments`; assessment-level provenance is persisted through `assessment_judgments`.
- Confirmation atomically writes baseline Snapshot #1, all five assessments, and their provenance.
- Snapshot #1 has `sequence = 1`, `previous_snapshot_id = NULL`, and `is_baseline = true`.
- The repository exposes no update operation for a StateSnapshot. Repeated confirmation returns the existing baseline and does not create another baseline.
- Stage, StageTarget, AcceptedJudgment, Snapshot and Assessment relations are validated to the same school before the transaction writes anything.
- `schools` has no snapshot pointer. The current formal state is derived from the latest `state_snapshots.sequence`.

## User experience

Inside a school, `工作台 / 学校状态` is a lightweight navigation pair. The state page shows the current stage, five human-readable dimension judgments, their stage-relative expectations, supporting accepted judgments and limitations.

The user never sees Snapshot, Commit, Assessment IDs or technical persistence language. The first confirmation is acknowledged as:

> 已经记录这所学校当前的起点状态。

There is no score, radar chart, ranking, or aggregate maturity number.

## Current implementation boundary

`BaselineStateAssessmentEngine` is deterministic and replaceable. It uses simple local rules only so the vertical slice can be exercised without Codex, DSH, MCP, RAG or Feishu. Natural-language adjustment re-runs the transient draft and does not mutate formal state.

Unconfirmed drafts are intentionally not persisted and can be lost on refresh or restart. This slice does not implement Snapshot #2, state diff/history UX, teacher practice, a real Agent Runtime, MCP, Feishu, RAG, or Methodology Pack runtime.
