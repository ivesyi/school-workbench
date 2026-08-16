# 学校变革陪跑工作台

## DATABASE_SCHEMA v1.1 — Methodology & Assessment Provenance

**状态：数据库冻结基线**  
**数据库：SQLite / WAL / better-sqlite3 / Drizzle ORM**

---

# 0. 数据原则

1. Workbench 是学校正式状态的唯一 System of Record。
2. Agent 只能登记 Evidence、提取 Claim、提出 Diagnosis。
3. Human Review 才能把候选判断变成正式判断。
4. State Snapshot 不可变；变化通过新 Snapshot 表达。
5. Methodology Pack 和 Criterion 按版本不可变，历史判断不得随方法更新漂移。
6. Observation Fact、Interpretation、Judgment 分开保存。
7. 所有跨实体写入必须校验 `school_id`，禁止跨学校引用。

---

# 1. 通用约定

```text
Primary Key       TEXT（ULID）
Timestamp         TEXT（UTC ISO 8601）
Boolean           INTEGER 0 / 1
Structured value  TEXT JSON，由 Zod 在 Domain 边界校验
Delete            默认软删除或禁止删除正式记录
```

启动数据库时必须执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

---

# 2. School 与阶段

## `schools`

```text
id                    PK
name                  NOT NULL
current_stage_id      FK stages.id NULL
baseline_snapshot_id  FK state_snapshots.id NULL
current_snapshot_id   FK state_snapshots.id NULL
created_at            NOT NULL
archived_at           NULL
```

创建学校时唯一必填业务字段为 `name`。

## `stages`

```text
id          PK
school_id   FK schools.id NOT NULL
title       NOT NULL
summary     NULL
sequence    INTEGER NOT NULL
status      planned | active | completed | cancelled
starts_at   NULL
ends_at     NULL
created_at  NOT NULL
updated_at  NOT NULL
```

每所学校最多一个 `active` Stage，由 Domain Service 保证。

## `dimensions`

系统种子数据：

```text
leadership
key_tasks
structure
culture
capability
```

字段：`key PK`、`title`、`description`、`sequence`。

## `stage_targets`

```text
id             PK
stage_id       FK stages.id NOT NULL
dimension_key  FK dimensions.key NOT NULL
title          NOT NULL
description    NOT NULL
status         draft | confirmed | retired
sequence       INTEGER NOT NULL
created_at     NOT NULL
updated_at     NOT NULL
```

---

# 3. Methodology

## `methodology_packs`

```text
id            PK
key           NOT NULL
version       NOT NULL
title         NOT NULL
source_type   book | framework | standard
source_ref    NOT NULL
content_hash  NOT NULL
status        draft | active | retired
created_at    NOT NULL
```

约束：`UNIQUE(key, version)`。已经被 Diagnosis 引用的 Pack 不原地修改。

V1 Pack：

```text
schooling-by-design-v1
data-wise-v3
congruence-framework-v1
role-standards-v1
```

## `methodology_criteria`

```text
id                       PK
pack_id                  FK methodology_packs.id NOT NULL
stable_key               NOT NULL
parent_id                FK methodology_criteria.id NULL
construct_key            NOT NULL
dimension_key            FK dimensions.key NULL
practice_type            school | leadership | middle_leader | teacher | team
title                     NOT NULL
description               NOT NULL
evidence_guidance_json    NOT NULL
counter_indicators_json   NOT NULL
guardrails_json           NOT NULL
source_locator_json       NOT NULL
sequence                  INTEGER NOT NULL
```

约束：`UNIQUE(pack_id, stable_key)`。

## `behavior_anchors`

```text
id                   PK
criterion_id         FK methodology_criteria.id NOT NULL
level_key            NOT NULL
label                NOT NULL
description          NOT NULL
source_locator_json  NOT NULL
sequence             INTEGER NOT NULL
```

行为锚点不是自动分值，只帮助 Agent 和顾问判断当前实践表现。

---

# 4. Evidence 与可观察事实

## `evidence`

```text
id             PK
school_id      FK schools.id NOT NULL
source_type    feishu_doc | feishu_minutes | audio | local_file | observation | other
uri            NOT NULL
title          NOT NULL
locator_json   NULL
content_hash   NULL
captured_at    NULL
registered_by  agent | human
agent_run_id   FK agent_runs.id NULL
created_at     NOT NULL
```

推荐唯一索引：`(school_id, content_hash)`，`content_hash IS NOT NULL` 时生效。

## `evidence_claims`

只保存可定位、具体、描述性的事实陈述。

```text
id                  PK
school_id           FK schools.id NOT NULL
evidence_id         FK evidence.id NOT NULL
claim_type          learner | adult_practice | organization | context
text                NOT NULL
locator_json        NOT NULL
directness          low | medium | high
extracted_by        agent | human
agent_run_id        FK agent_runs.id NULL
created_at          NOT NULL
```

解释和诊断不得写入 `evidence_claims.text`。

---

# 5. Diagnosis 与审核

## `diagnosis_cards`

```text
id                              PK
school_id                       FK schools.id NOT NULL
agent_run_id                    FK agent_runs.id NULL
type                            state | characteristic | mismatch | practice
title                           NOT NULL
observed_facts                  NOT NULL
judgment                        NOT NULL
mechanism                       NULL
alternative_hypotheses_json     NOT NULL
unresolved_questions_json       NOT NULL
proposed_actions_json           NOT NULL
recommended_observations_json   NOT NULL
impact_measures_json            NOT NULL
evidence_quality_json           NOT NULL
confidence                      low | medium | high
status                          proposed | accepted | modified | rejected
created_at                      NOT NULL
updated_at                      NOT NULL
```

`status` 只能由 Human Review Domain Service 改变。

## `diagnosis_evidence`

```text
diagnosis_id  FK diagnosis_cards.id
evidence_id   FK evidence.id
claim_id      FK evidence_claims.id NULL
stance        supporting | counter
sequence      INTEGER NOT NULL
PRIMARY KEY (diagnosis_id, evidence_id, claim_id, stance)
```

## `diagnosis_criteria`

```text
diagnosis_id  FK diagnosis_cards.id
criterion_id  FK methodology_criteria.id
PRIMARY KEY (diagnosis_id, criterion_id)
```

Criterion 所属 Pack 版本即为该判断的方法论版本来源。

## `diagnosis_stage_targets`

```text
diagnosis_id   FK diagnosis_cards.id
stage_target_id FK stage_targets.id
PRIMARY KEY (diagnosis_id, stage_target_id)
```

## `human_reviews`

```text
id             PK
diagnosis_id   FK diagnosis_cards.id NOT NULL
decision       accepted | modified | rejected
feedback       NULL
final_text     NULL
reason         NULL
reviewed_at    NOT NULL
```

每次调整都新增 Review，不覆盖 Agent 原判断。

---

# 6. 正式学校状态

## `state_snapshots`

```text
id                    PK
school_id             FK schools.id NOT NULL
stage_id              FK stages.id NULL
previous_snapshot_id  FK state_snapshots.id NULL
sequence              INTEGER NOT NULL
summary               NOT NULL
is_baseline           INTEGER NOT NULL DEFAULT 0
confirmed_at          NOT NULL
created_at            NOT NULL
```

约束：`UNIQUE(school_id, sequence)`；每所学校最多一个 `is_baseline = 1`。

## `dimension_assessments`

```text
id             PK
snapshot_id    FK state_snapshots.id NOT NULL
dimension_key  FK dimensions.key NOT NULL
status         unverified | far_below | partial | mostly | stable
summary        NOT NULL
created_at     NOT NULL
UNIQUE(snapshot_id, dimension_key)
```

## `snapshot_diagnoses`

```text
snapshot_id   FK state_snapshots.id
diagnosis_id  FK diagnosis_cards.id
PRIMARY KEY (snapshot_id, diagnosis_id)
```

只能引用 `accepted` 或 `modified` Diagnosis。

## `team_characteristics`

```text
id            PK
school_id     FK schools.id NOT NULL
snapshot_id   FK state_snapshots.id NOT NULL
scope         school | leadership | middle_leaders | teachers | subject_group
text          NOT NULL
created_at    NOT NULL
```

---

# 7. 教师实践

## `teacher_practice_records`

```text
id                 PK
school_id          FK schools.id NOT NULL
teacher_ref        NULL
title              NOT NULL
occurred_at        NULL
summary            NULL
created_at         NOT NULL
updated_at         NOT NULL
```

`teacher_ref` 是本地不透明引用，不要求建立教师用户体系。

## `teacher_practice_evidence`

```text
record_id    FK teacher_practice_records.id
evidence_id  FK evidence.id
role         lesson_plan | classroom | reflection | team_discussion | learner_work | other
PRIMARY KEY (record_id, evidence_id)
```

## `teacher_practice_diagnoses`

```text
record_id     FK teacher_practice_records.id
diagnosis_id  FK diagnosis_cards.id
PRIMARY KEY (record_id, diagnosis_id)
```

---

# 8. Agent Runtime

## `runtime_profiles`

保存 provider、ACP command、args、env reference、启用状态和兼容级别。敏感值不直接写入普通日志。

## `agent_sessions`

保存 `school_id`、`runtime_profile_id`、opaque `external_session_id`、`resumable` 和时间。Session 不是业务状态。

## `agent_runs`

```text
id                  PK
school_id           FK schools.id NOT NULL
runtime_profile_id  FK runtime_profiles.id NOT NULL
session_id          FK agent_sessions.id NULL
user_instruction    NOT NULL
status              queued | running | needs_input | completed | failed | cancelled
started_at          NULL
ended_at            NULL
created_at          NOT NULL
```

授权等待继续使用 `needs_input`；具体原因由 Experience Event 表达，不扩展数据库 Enum。

---

# 9. 关键索引

```text
stages(school_id, status)
stage_targets(stage_id, dimension_key)
methodology_criteria(pack_id, construct_key, dimension_key)
evidence(school_id, captured_at)
evidence_claims(school_id, evidence_id)
diagnosis_cards(school_id, status, created_at)
human_reviews(diagnosis_id, reviewed_at)
state_snapshots(school_id, sequence)
agent_runs(school_id, created_at)
```

为 Methodology 与必要短摘录建立 FTS5 虚拟表；原始 PDF 不写入业务表。

---

# 10. Domain Invariants

事务提交前必须验证：

- Evidence、Claim、Diagnosis、StageTarget 属于同一 School；
- Diagnosis 至少有一条 supporting Evidence；
- 每个 Diagnosis 至少引用一个 Methodology Criterion；
- counter Evidence 可以为空，但必须显式完成反证搜索；
- 正式 Snapshot 只能引用顾问已确认判断；
- Agent Token 只能访问当前 `school_id` 与 `agent_run_id`；
- Renderer、Agent 和 MCP Server 均不能直接写 SQLite；
- Pack 更新产生新版本，不原地覆盖历史 Criterion。

---

# 11. Migration Baseline

当前工作区没有已运行的应用数据库，因此 v1.1 作为首个实现基线：

```text
0001_initial_domain
0002_methodology_and_provenance
0003_runtime_and_teacher_practice
```

即使首装一次执行全部 Migration，也保留分段文件，便于测试边界和未来升级。
