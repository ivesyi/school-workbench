# 学校变革陪跑工作台

## DATABASE_SCHEMA v1.2 — Ontology & Epistemic Alignment

**状态：语义冻结前基线**  
**数据库：SQLite / WAL / better-sqlite3 / Drizzle ORM**

## 0. Data principles

1. Workbench 是学校正式知识状态的 System of Record，不声称数据库等于学校客观现实。
2. Agent 只能登记 Evidence、提取 ObservationFact / Claim、提出 DiagnosisProposal。
3. HumanReview 才能形成 AcceptedJudgment。
4. StateSnapshot 不可变；它记录某一时点经顾问确认的知识状态，不是现实本身。
5. Methodology Pack / Criterion 按版本追溯，历史判断不得随方法更新漂移。
6. ObservationFact、Claim、Interpretation、Proposal、AcceptedJudgment 分开。
7. 所有跨实体写入必须校验 `school_id`，禁止跨学校引用。

## 1. School

`schools` 只保存学校自身身份，不缓存可派生的“当前指针”。

```text
schools
id          PK
name        NOT NULL
created_at  NOT NULL
archived_at NULL
```

禁止在 `schools` 保存：

```text
current_stage_id
baseline_snapshot_id
current_snapshot_id
```

当前 Stage 由 `stages.status = active` 推导；当前 Snapshot 由最新 sequence 推导；Baseline 由 `is_baseline` 推导。Read Model / Experience 负责组装 SchoolView。

## 2. Stage and targets

```text
stages
id, school_id, title, summary, sequence,
status(planned|active|completed|cancelled),
starts_at, ends_at, created_at, updated_at
```

每所学校最多一个 active Stage。

```text
dimensions
key PK: leadership | key_tasks | structure | culture | capability
```

Dimension 属于五维全等诊断框架，用于描述匹配/失配，不自带成熟等级。

```text
stage_targets
id, stage_id, dimension_key, title, description,
status(draft|confirmed|retired), sequence, created_at, updated_at
```

“明显低于 / 部分达到 / 基本达到 / 达到且稳定”等状态必须相对于 StageTarget 判断。

## 3. Methodology

```text
methodology_packs
id, key, version, title, source_type, source_ref,
content_hash, status, created_at
UNIQUE(key, version)
```

V1 Pack：Schooling by Design、Data Wise、Congruence、Role Standards。

```text
methodology_criteria
id, pack_id, stable_key, parent_id, construct_key,
dimension_key, practice_type, title, description,
evidence_guidance_json, counter_indicators_json,
guardrails_json, source_locator_json, sequence
UNIQUE(pack_id, stable_key)
```

```text
behavior_anchors
id, criterion_id, level_key, label, description,
source_locator_json, sequence
```

行为锚点不是自动分值。

## 4. Evidence and ObservationFact

```text
evidence
id, school_id,
source_type(feishu_doc|feishu_minutes|audio|local_file|observation|pasted_text|other),
uri NULL,
inline_text NULL,
title, locator_json, content_hash, captured_at,
registered_by(agent|human), agent_run_id, created_at
```

约束：`uri` 与 `inline_text` 至少一个非空。用户直接说的一段情况可以登记为 `pasted_text` 或 `observation`，不要求伪造 URI。

```text
observation_facts
id, school_id, evidence_id,
fact_type(learner|adult_practice|organization|context),
text, locator_json, directness(low|medium|high),
extracted_by(agent|human), agent_run_id, created_at
```

`ObservationFact.text` 只允许低推论、可定位描述。

## 5. Claim

```text
claims
id, school_id,
subject_ref_json,
predicate_key,
object_ref_json NULL,
statement,
valid_from NULL,
valid_to NULL,
scope_json NOT NULL,
created_by(agent|human),
agent_run_id NULL,
created_at
```

Claim 是关于学校现实的判断性陈述，可被支持、反驳、修改。它不是 Team/Person 的永久属性。

```text
claim_facts
claim_id, fact_id, stance(supporting|counter), sequence
PRIMARY KEY(claim_id, fact_id, stance)
```

## 6. DiagnosisProposal

```text
diagnosis_proposals
id, school_id, agent_run_id,
type(state|characteristic|mismatch|practice),
title,
scope_json,
interpretations_json,
provisional_judgment NULL,
mechanism NULL,
alternative_hypotheses_json,
unresolved_questions_json,
recommended_actions_json,
next_observations_json,
impact_evidence_plan_json,
evidence_quality_json,
confidence(low|medium|high),
status(proposed|insufficient_evidence),
created_at
```

Proposal 创建后不可原地修改。

```text
diagnosis_claims(proposal_id, claim_id)
diagnosis_criteria(proposal_id, criterion_id)
diagnosis_stage_targets(proposal_id, stage_target_id)
```

`methodology_criteria.pack_id` 已固定 Pack/version 来源，不再重复保存 frameworkVersionIds。

## 7. HumanReview and AcceptedJudgment

```text
human_reviews
id, proposal_id,
decision(accepted|modified|rejected|needs_more_evidence),
feedback NULL,
final_text NULL,
reason NULL,
reviewed_at
```

HumanReview 是审核记录，不修改原 Proposal。

```text
accepted_judgments
id, school_id, review_id,
statement,
scope_json,
valid_from NULL,
valid_to NULL,
created_at
```

只有 `accepted` / `modified` Review 可以产生 AcceptedJudgment。

```text
judgment_claims(judgment_id, claim_id)
```

## 8. Formal school state

```text
state_snapshots
id, school_id, stage_id NULL,
previous_snapshot_id NULL,
sequence,
summary,
is_baseline DEFAULT 0,
confirmed_at,
created_at
UNIQUE(school_id, sequence)
```

历史 Snapshot immutable。

```text
dimension_assessments
id, snapshot_id, dimension_key,
status(unverified|far_below|partial|mostly|stable),
summary, created_at
UNIQUE(snapshot_id, dimension_key)
```

Assessment 必须由 AcceptedJudgment 支撑：

```text
assessment_judgments(assessment_id, judgment_id)
snapshot_judgments(snapshot_id, judgment_id)
```

“当前团队特点”不再维护自由文本事实表；UI View 由当前 Snapshot 的 AcceptedJudgment 投影生成。

## 9. Person / Role / Team

Ontology 已定义 `Person / Role / RoleAssignment / Team`，但 V0.1 **不因此强制建表**。只有真实纵切需要跨材料稳定识别人、角色或团队时才实现对应关系表。

教师实践当前可继续使用不透明 `teacher_ref`，避免为了本体完整性提前建设人员管理系统。

## 10. Teacher practice

```text
teacher_practice_records
id, school_id, teacher_ref NULL, title,
occurred_at NULL, summary NULL, created_at, updated_at

teacher_practice_evidence
record_id, evidence_id,
role(lesson_plan|classroom|reflection|team_discussion|learner_work|other)

teacher_practice_diagnoses
record_id, proposal_id
```

## 11. Agent Runtime

`runtime_profiles / agent_sessions / agent_runs` 保持原设计。

```text
agent_runs.status = queued|running|needs_input|completed|failed|cancelled
```

飞书授权等待继续复用 `needs_input`，具体原因属于 Experience transient state。

## 12. Domain invariants

提交前必须验证：

- Evidence、Fact、Claim、Proposal、Review、Judgment、StageTarget、Snapshot 属于同一 School；
- ObservationFact 有 Evidence + locator，且不包含评价/因果推断；
- Claim 至少有 supporting Fact；counter search 必须显式完成；
- Proposal 至少有一个 Claim 和一个 Criterion；
- Proposal immutable；
- 只有 HumanReview 可产生 AcceptedJudgment；
- Snapshot 只能记录 AcceptedJudgment / Assessment；
- Agent Token 只能访问当前 school_id / agent_run_id；
- Renderer、Agent、MCP Server 均不能直接写 SQLite；
- Pack 更新产生新版本，不覆盖历史 Criterion。

## 13. Implementation baseline

当前仓库尚无生产用户数据库。Foundation migration 只保留最小 `schools` 表；后续按纵切增加 Stage、Evidence/Fact/Claim、Proposal/Review/Judgment、Snapshot/Assessment、Runtime。

在下一纵切开始前，先完成本 v1.2 与 Ontology draft 的测试校准；不为尚未实现的表制造兼容迁移包袱。
