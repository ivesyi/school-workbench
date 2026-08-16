# Stage Recommendation Vertical Slice Status

## Scope

This slice implements only stage recommendation and consultant confirmation after at least one AcceptedJudgment exists.

Flow:

```text
AcceptedJudgment
→ deterministic StageRecommendationEngine
→ Stage(planned) + 5 StageTargets(draft)
→ consultant: 基本对 / 调整一下
→ Stage(active) + StageTargets(confirmed)
→ School read model derives current stage from stages.status = active
```

## Invariants

- A school can have at most one active Stage.
- Stage activation and confirmation of all five targets happen in one SQLite transaction.
- Stage/Target writes validate `schoolId`; targets cannot cross schools or stages.
- Stage/Judgment uses `stage_judgments` with foreign keys and same-school validation; no JSON id list is persisted on Stage.
- Canonical five-dimension keys are exactly `leadership | key_tasks | structure | culture | capability` across Domain, Shared and DB.
- Stage supports `planned | active | completed | cancelled`; StageTarget supports `draft | confirmed | retired`.
- Stage and StageTarget have stable `sequence`; completed/cancelled history does not block creation of a later planned stage.
- `schools` has no `current_stage_id` pointer. SchoolView derives `currentStageId/currentStageTitle` from the active Stage.
- Natural-language adjustment updates the existing planned/draft recommendation; it does not create a Stage Proposal table.
- Explicit adjustment feedback is classified before old AcceptedJudgment context, so a clear turn toward organization foundation, teacher practice, or student learning changes the recommendation.
- No StateSnapshot is created by this slice.

## Schema reconciliation

The original stage migration already shipped and is not rewritten. A forward migration reconciles existing local databases by:

- mapping `critical_tasks → key_tasks`, `structure_systems → structure`, `capacity → capability`;
- adding Stage sequence, full lifecycle status/time fields and updated_at;
- adding StageTarget title/description/sequence/updated_at;
- moving Stage-to-Judgment references from `source_judgment_ids_json` into `stage_judgments`.

Drizzle runtime schema, migration journal and snapshot are kept aligned with the reconciled schema.

## Current implementation boundary

`BaselineStageRecommendationEngine` is deterministic and replaceable. It uses AcceptedJudgment text for the initial recommendation and gives explicit consultant feedback precedence during adjustment. It does not call Codex, DSH, MCP, RAG, Feishu, or any external runtime.

The Workbench shows the suggestion and the confirmed stage only as a quiet summary inside the school workspace. The school list shows only an actually active Stage title. There is no Stage primary navigation or technical target editor.
