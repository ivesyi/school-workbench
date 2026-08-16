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
```

## Invariants

- A school can have at most one active Stage.
- Stage activation and confirmation of all five targets happen in one SQLite transaction.
- Stage/Target writes validate `schoolId`; targets cannot cross schools or stages.
- `schools` has no `current_stage_id` pointer.
- Natural-language adjustment updates the existing planned/draft recommendation; it does not create a Stage Proposal table.
- No StateSnapshot is created by this slice.

## Current implementation boundary

`BaselineStageRecommendationEngine` is deterministic and replaceable. It uses AcceptedJudgment text to choose an organization-, teacher-practice-, or student-learning-oriented default stage. It does not call Codex, DSH, MCP, RAG, Feishu, or any external runtime.

The Workbench shows the suggestion and the confirmed stage only as a quiet summary inside the school workspace. There is no Stage primary navigation or technical target editor.
