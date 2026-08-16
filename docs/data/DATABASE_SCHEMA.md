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
id, school_id, title, summary,
focus,                         # 当前纵切的人话“这个阶段最需要看到什么”
sequence,
status(planned|active|completed|cancelled),
starts_at, ends_at,
adjustment_feedback NULL,      # 最近一次自然语言调整；辅助重放当前建议
created_at, updated_at
```

每所学校最多一个 active Stage；同一学校的 `sequence` 唯一。`savePlanned` 只阻止已有 `planned` / `active`，已有 `completed` / `cancelled` 历史不阻止形成下一阶段。

```text
dimensions
key PK: leadership | key_tasks | structure | culture | capability
```

Dimension 属于五维全等诊断框架，用于描述匹配/失配，不自带成熟等级。应用层、Domain、Shared、DB 只使用这一套 canonical key。

```text
stage_targets
id, stage_id, school_id,
dimension_key, title, description,
status(draft|confirmed|retired), sequence,
created_at, updated_at
```

`school_id` 是当前本地纵切保留的冗余作用域字段，用于跨实体写入校验；它必须与所属 Stage 的 `school_id` 一致。

阶段依据通过关系表保存，不在 Stage 内保存 JSON id 列表：

```text
stage_judgments
stage_id FK -> stages.id
judgment_id FK -> accepted_judgments.id
sequence
PRIMARY KEY(stage_id, judgment_id)
```

写入 `stage_judgments` 前必须验证 Judgment 与 Stage 属于同一 School。

“明显低于 / 部分达到 / 基本达到 / 达到且稳定”等状态必须相对于 StageTarget 判断。

## 3. Methodology

```text
methodology_packs
id, key, version, title, source_type, source_ref,
source_fingerprint, content_hash, status, created_at
UNIQUE(key, version)
```

`source_fingerprint` 保存 `references/SOURCE_MANIFEST.md` 中对应本地原始来源的 SHA-256；`content_hash` 保存结构化 Pack 去除 hash 字段后的 canonical SHA-256。两者语义不同，均用于 fail-closed 追溯。

V1 规划包含 Schooling by Design、Data Wise、Congruence、Role Standards；当前 Methodology Registry Foundation 只实现已有人审文本基线的 Schooling by Design 与 Data Wise，另外两套不得因“齐全”而提前编造。

```text
methodology_criteria
id, pack_id, stable_key, parent_id, construct_key,
dimension_key, practice_type, title, description,
evidence_guidance_json, counter_indicators_json,
guardrails_json, source_locator_json, sequence
UNIQUE(pack_id, stable_key)
```

`parent_id` 是同表 FK，并由 Repository 额外校验必须与子 Criterion 属于同一个 Pack。`guardrails_json` 在当前冻结列集内保存 Criterion 适用边界与有效 inference guardrails；它保存 JSON value，不保存跨实体 ID 列表。

```text
behavior_anchors
id, criterion_id, level_key, label, description,
source_locator_json, sequence
```

行为锚点不是自动分值。当前两个机器 Pack 没有可靠的人审行为锚点，因此 `behavior_anchors` 可为空，不为填表制造等级内容。

机器可加载 Pack 当前使用 `status = review`，不是 `active`。现有 `PACK.md` 能证明 Human-review baseline，但不能证明对应 JSON 工程转译已经被顾问批准为 active runtime standard。激活前必须人工复核 stable ID、Criterion 文本、证据指导、适用边界/guardrail、来源定位、source fingerprint 与 canonical content hash。

Construct 定义继续由版本化文件 Registry 持有；v1.2 持久化 schema 只冻结 Pack、Criterion 与 BehaviorAnchor 三类表，不为了本轮 foundation 额外制造 Construct 表。

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

历史 Snapshot immutable。当前状态确认纵切要求每次新确认的正式状态都关联确认时该校 current active Stage 的 confirmed Targets；阶段迁移不在本轮扩展。

```text
dimension_assessments
id, snapshot_id, dimension_key,
status(unverified|far_below|partial|mostly|stable),
summary, created_at
UNIQUE(snapshot_id, dimension_key)
```

每个正式状态必须完整保存五个 canonical Dimension。证据不足时使用 `unverified`，不得为了填满五维而推断达成度；每个非 `unverified` Assessment 至少关联一条 AcceptedJudgment。

Assessment 与整个状态使用的正式判断都通过 FK 关系保存：

```text
assessment_judgments(assessment_id, judgment_id)
snapshot_judgments(snapshot_id, judgment_id)
```

当前 Snapshot 由同校最高 `sequence` 推导，不在 `schools` 缓存指针。首个确认状态固定 `sequence = 1`、`previous_snapshot_id = NULL`、`is_baseline = 1`；重复确认不得产生第二个 baseline。

后续确认固定 `previous_snapshot_id = current_latest.id`、`sequence = current_latest.sequence + 1`、`is_baseline = 0`。`saveNext` 必须在同一事务内验证调用方预期的 previous Snapshot 仍是该校当前 latest，避免 stale draft、并发确认或重复动作写出错误链。

下一份正式状态的 `snapshot_judgments` 保存 StateAssessmentEngine 实际使用的完整当前 AcceptedJudgment 集；“上次状态未包含的新判断”只用于触发更新草稿和解释变化，不能替代完整当前状态依据。没有新 AcceptedJudgment 时不形成更新草稿，也不创建新的正式状态。

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
- Stage 与 StageTarget 使用同一 canonical 五维 key；Stage 与其 Judgment 关系必须同校；
- 每校最多一个 active Stage；planned/active 阻止新的 planned，但 completed/cancelled 历史不阻止；
- ObservationFact 有 Evidence + locator，且不包含评价/因果推断；
- Claim 至少有 supporting Fact；counter search 必须显式完成；
- Proposal 至少有一个 Claim 和一个 Criterion；
- Proposal immutable；
- 只有 HumanReview 可产生 AcceptedJudgment；
- Snapshot 只能记录 AcceptedJudgment / Assessment；新确认状态必须来自该校 active Stage 的 confirmed Targets；
- 每个正式 Snapshot 恰好五个 canonical DimensionAssessment；非 `unverified` Assessment 至少一条同校 AcceptedJudgment；
- 后续 Snapshot 必须链接同校当前 latest，`sequence = previous.sequence + 1`，且 `is_baseline = 0`；
- 后续 Snapshot 的完整 Judgment provenance 必须包含上一份状态已经使用的 Judgment，并至少包含一条新的 AcceptedJudgment；
- stale draft 确认必须失败，不能静默接到已经变化的历史链上；
- Snapshot / Assessment / Judgment / Stage 的 FK 写入必须同校；Snapshot 与历史 Assessment immutable；
- Agent Token 只能访问当前 school_id / agent_run_id；
- Renderer、Agent、MCP Server 均不能直接写 SQLite；
- Pack 更新产生新版本，不覆盖历史 Criterion；同 `key + version` 只能接受完全相同的 canonical content hash；
- Criterion `parent_id` 与 BehaviorAnchor `criterion_id` 必须落在正确的 Pack / Criterion 作用域，Repository 读取异常数据时 fail closed；
- Methodology Pack 的 source fingerprint 必须与 `references/SOURCE_MANIFEST.md` 对应 SHA-256 一致。

## 13. Implementation baseline

当前仓库已经实现 School、Epistemic Judgment、“阶段提议与确认”、“首个学校状态确认 / baseline”以及“第二次状态确认与变化对比”纵切。Stage 纵切使用 forward migration 对齐本 v1.2：旧 `critical_tasks / structure_systems / capacity` 数据迁移为 `key_tasks / structure / capability`；旧 `source_judgment_ids_json` 迁移为 `stage_judgments` 关系表；旧 Stage/Target 字段迁移到 sequence、完整 status/time 字段和 title/description/sequence。

Baseline State 纵切使用 forward migration 新增 `state_snapshots`、`dimension_assessments`、`assessment_judgments`、`snapshot_judgments`。第二次状态确认直接复用这组表，不新增 current pointer、JSON ID 列或新的 diff 持久化表。未确认 State Draft / Update Draft 只存在于 Application 内存，不写 SQLite。

有新的 AcceptedJudgment 时，StateAssessmentEngine 使用 active Stage 的 confirmed Targets 与当前全部 AcceptedJudgment 形成更新草稿；确认时在一个事务内验证 expected previous 仍为 latest，并原子写入下一份 immutable Snapshot、五维 Assessment 与完整 FK provenance。重启后“和上一次相比”由 latest 与其 `previous_snapshot_id` 指向的上一份正式状态重新计算，不修改历史状态。

Methodology Registry Foundation 已用新的 forward migration 实现 `methodology_packs`、`methodology_criteria`、`behavior_anchors`，并增加文件 Registry 与 SQLite Repository seam。当前仅加载 Schooling by Design v1 与 Data Wise v3 的人审文本工程转译；两者均为 `review`，不参与 AssessmentEngine、Diagnosis 或任何自动评分。相同 `key + version + hash` 重复 sync 无副作用；相同版本内容变化拒绝覆盖；新版本可并存。原始 PDF 只通过 `references/SOURCE_MANIFEST.md` 的 SHA-256 追溯，不进入 runtime pack、测试夹具或安装产物。

尚未实现阶段迁移、任意历史版本浏览/比较、教师实践或真实 Agent Runtime、MCP、飞书、RAG；Methodology 尚未接入 AssessmentEngine / Diagnosis criterion mapping / `standards_get`，Congruence 与 Role Standards Pack 也仍等待各自充分的人审结构化基线。这些能力继续按真实纵切增加，不为未实现能力制造额外基础设施。
