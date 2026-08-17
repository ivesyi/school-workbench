# Workbench Methodology Crosswalk v1.1

## 1. Four layers, not one scorecard

Workbench 不把 Schooling by Design、Data Wise、五维全等框架和角色标准混成一张总分表。四者职责分层：

| 框架                  | 回答的问题                                                         | Workbench 职责               |
| --------------------- | ------------------------------------------------------------------ | ---------------------------- |
| Schooling by Design   | 我们想去哪？使命、预期结果、证据、结构与行动是否真正对齐？         | 目标—对齐—设计框架           |
| 五维全等框架          | 当前领导力、关键任务、结构制度、文化、能力之间哪里匹配、哪里失配？ | 组织匹配 / 失配诊断框架      |
| 角色专业标准          | 承担关键任务的人是否具备相应能力与行为表现？                       | 角色能力与行为进阶框架       |
| Data Wise             | 实际成人实践与学习证据是什么？如何以证据形成问题、行动并评估影响？ | 实践—证据—改进框架与推论纪律 |
| Workbench StageTarget | 当前陪跑阶段到底准备改变什么、现在应该看到什么？                   | 阶段成功条件                 |
| 顾问判断              | 当前证据是否足以采纳、修改或驳回 Agent 建议？                      | 最终裁定                     |

书籍和框架产生检查问题、证据要求、关系解释与推论护栏；不直接生成学校总分。

## 2. Important correction: Congruence is not a maturity scale

五维全等模型中的 `Leadership / Critical Tasks / Structure & Systems / Culture / Capability` 是组织诊断维度。它关注这些维度之间是否相互支持以及失配发生在哪里。

因此：

- `Dimension` 本身不定义 Level 1–4；
- “明显低于阶段目标 / 部分达到 / 基本达到 / 达到且稳定”等状态来自 Workbench 对当前 StageTarget 的评估；
- Agent 可以用全等框架解释 mismatch，但不得仅凭维度标签推导成熟阶段。

## 3. Outer and inner loops

```text
外循环（Schooling by Design）
使命 / 长期结果 → 可接受证据 → 对齐的系统行动 → 反馈与调整
                         ↕
内循环（Data Wise）
学习或成人发展问题 → 实践证据 → 实践问题 → 小步行动 → 影响评估
```

外循环提供方向、成功标准和系统条件；内循环提供课堂、团队、领导与 coaching 等真实实践证据，并反过来修正目标与行动。

## 4. Data Wise scope

Data Wise 不等于“教师状态模型”，也不只适用于学生学习。Workbench 使用 Third Edition 的更通用表述：`evidence of learning` 与 `our own practice`。

因此在项目早期可以用于：

- 校长团队如何学习与调整领导实践；
- 中层如何形成共同任务理解；
- 教研团队如何看见自己的实践；
- coaching / professional learning 是否改变成人实践。

只有当任务确实指向课堂与学生学习时，才要求先形成 learner-centered problem；不能对所有组织诊断强制套用学生问题。

## 5. Task routing

| 用户任务                  | 主框架                | 必要联查                                              |
| ------------------------- | --------------------- | ----------------------------------------------------- |
| 评估学校整体变革设计      | Schooling by Design   | StageTarget、全等框架                                 |
| 分析使命与行动脱节        | Schooling by Design   | 全等框架、角色标准                                    |
| 分析组织为什么卡住        | 五维全等框架          | StageTarget、SBD 系统对齐                             |
| 判断某角色是否能承担任务  | 角色专业标准          | 实践证据、当前组织条件                                |
| 分析教师/团队能否看见实践 | Data Wise             | 角色标准、相关学习/成人发展证据                       |
| 形成课堂或团队改进行动    | Data Wise             | 当前 StageTarget、资源与结构条件                      |
| 判断阶段达成度            | Workbench StageTarget | 全等失配、角色标准、SBD、Data Wise 作为证据与解释来源 |

## 6. Cross-check examples

- 目标很清楚但课堂无变化：检查 `SBD.C4.SYSTEM_ALIGNMENT` 与 `DW.C2.PRACTICE_VISIBILITY`。
- 有大量教研活动但难证实影响：检查 `SBD.C2.EVIDENCE_BEFORE_ACTION` 与 `DW.C5.ACTION_IMPACT_COHERENCE`。
- 团队迅速提出培训方案：先检查问题与实践证据，再看是否有可信差距基线。
- 个别课堂片段被推广为全校结论：触发 Data Wise inference discipline 与 SBD gap-grounding。
- 制度目标与教师实际条件冲突：用全等模型定位 mismatch，用 SBD 解释系统错位，用 Data Wise 描述实践层后果。

## 7. Criterion 五维主归属

`dimensionKey` 表示 Criterion 在当前 Workbench 中用于查询、路由和组织诊断联查时的**主归属**，不表示该 Criterion 只能解释该维度，也不把方法论 Criterion 变成五维成熟度锚点。

| Criterion | 主归属 |
| --- | --- |
| `SBD.C1.RESULT_CLARITY` | `leadership` |
| `SBD.C2.EVIDENCE_BEFORE_ACTION` | `key_tasks` |
| `SBD.C3.GAP_GROUNDED` | `capability` |
| `SBD.C4.SYSTEM_ALIGNMENT` | `structure` |
| `SBD.C5.FEEDBACK_ADJUSTMENT` | `culture` |
| `DW.C1.LEARNING_PROBLEM_QUALITY` | `key_tasks` |
| `DW.C2.PRACTICE_VISIBILITY` | `structure` |
| `DW.C3.PROBLEM_OF_PRACTICE_QUALITY` | `culture` |
| `DW.C4.INFERENCE_DISCIPLINE` | `capability` |
| `DW.C5.ACTION_IMPACT_COHERENCE` | `leadership` |

两个当前 Pack 的 `behaviorAnchors` 继续为空；在可靠角色专业标准源完成结构化和人审前，不为补齐表结构而编造锚点。

## 8. Conflict and precedence

1. 可定位的 ObservationFact 优先于方法论标签；
2. 当前顾问确认的 StageTarget 是阶段达成判断的直接参照；
3. 全等框架解释组织匹配/失配，不独立生成成熟等级；
4. 角色判断必须引用对应角色行为锚点；
5. 多个方法论解释冲突时并列为替代假设，不由 Agent 擅自消解；
6. 证据不足或不可比时输出下一步观察建议，不输出虚假精度；
7. 只有顾问可以形成 AcceptedJudgment 与 StateSnapshot。
