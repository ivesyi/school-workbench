# School State Change Vertical Slice Status

## Scope

This slice extends the already-confirmed baseline with exactly one subsequent consultant-confirmed school state and a five-dimension comparison against the immediately previous formal state.

Flow:

```text
immutable baseline #1
+ newly accepted judgment(s)
+ active Stage with five confirmed targets
→ deterministic StateAssessmentEngine over ALL current AcceptedJudgments
→ transient update draft
→ compare each dimension with the previous formal state
→ consultant: 确认现在的状态 / 我想调整
→ immutable next formal state
→ restart restores latest state and “和上一次相比”
```

## Invariants

- A new update draft exists only when at least one current AcceptedJudgment is absent from the latest formal state's provenance.
- “New judgments” are only the trigger and explanation set. The engine always receives the complete current AcceptedJudgment set, and the confirmed next state persists that complete set through `snapshot_judgments`.
- Natural-language adjustment only regenerates the transient draft. It never mutates the previous formal state or writes a new state before confirmation.
- If another AcceptedJudgment is confirmed after a draft was formed, confirmation rejects the stale draft and requires the consultant to review a freshly generated draft.
- The next immutable state uses `sequence = previous.sequence + 1`, `previous_snapshot_id = previous.id`, and `is_baseline = false`.
- `saveNext` verifies inside the same SQLite transaction that the expected previous state is still the latest state for the school before writing anything.
- The previous state, its five assessments, and all provenance remain immutable. The repository exposes no update path for historical state or assessment rows.
- Stage, previous state, AcceptedJudgment, snapshot-level provenance, and assessment-level provenance are all school-scoped and validated before persistence.
- Repeated confirmation without additional AcceptedJudgments is idempotent and does not create another state.
- `schools` still stores no state pointer; current formal state is derived from the highest `state_snapshots.sequence` for the school.

## Change semantics

Change is a read model derived by comparing each current dimension with the immediately previous dimension assessment. It is not persisted as a score or a separate truth table.

The current read model distinguishes:

- `improved` — a known stage-relative status moved upward;
- `unchanged` — stage-relative status is unchanged; summary text may still contain newly confirmed detail;
- `declined` — a known stage-relative status moved downward;
- `newly_verified` — previous status was `unverified`, current status is now judgeable;
- `became_unverified` — a previously judgeable dimension now needs more observation.

`unverified` is not placed on the same numeric ladder as `far_below | partial | mostly | stable`. The UI uses human labels and lightweight symbols only; there is no composite score, radar chart, ranking, or school-wide maturity number.

Each dimension comparison can reveal the previous explanation, current explanation, and the formal judgments used by the current assessment.

## User experience

When the baseline exists and there are no new formal judgments, the state page shows the current starting state, offers a route back to the workbench to add more information, and shows no confirmation action.

When new formal judgments exist, the page says:

> 这轮你已经确认了 N 个新的变化，我重新整理了一下学校现在的状态。

It then shows the current five dimensions plus `和上一次相比`, followed by `确认现在的状态 / 我想调整`.

After the second confirmation the acknowledgement is:

> 已经记录这所学校现在的状态。

After restart, the latest state and the same comparison against the previous formal state are reconstructed from immutable state, assessment, and FK provenance rows.

## Current implementation boundary

The assessment engine remains deterministic and replaceable. No Agent runtime is connected in this slice. The existing `state_snapshots`, `dimension_assessments`, `assessment_judgments`, and `snapshot_judgments` schema is reused without adding current pointers or JSON ID lists.

Unconfirmed update drafts are intentionally transient and may be lost on refresh or restart. This slice does not implement stage migration, a general state-history browser, comparison across arbitrary historical versions, teacher practice, real Agent Runtime, MCP, Feishu, RAG, or Methodology Pack runtime.
