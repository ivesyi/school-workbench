# Workbench Ontology

**状态：Ontology v1 语义校准中（draft）。** 规范见 `core-v1/`，架构决策见 `docs/architecture/ADR-002-workbench-ontology.md`。

Ontology v1 不是数据库表清单，也不是知识图谱产品。它只定义 Workbench 需要共享的领域语义，并显式区分四层：

```text
ontic       现实世界中实际存在或发生的对象、角色与实践
normative   阶段目标、预期结果与影响要求等“应该怎样”
epistemic   Evidence、Fact、Claim、Diagnosis、Review、Judgment、Snapshot 等“我们怎么知道”
methodology 外部框架的构念、维度与判断准则
```

核心规则：

- `Person` 与 `Role` 分离；校长、中层、教师、顾问、项目助理、学生都是角色，不是互斥人员类型；
- `Team` 是现实组织实体，不是 Role；
- `ObservationFact` 与 `Claim` 分离；Fact 是低推论描述，Claim 可以被支持、反驳和修正；
- `DiagnosisProposal` 是 Agent 的候选判断，`AcceptedJudgment` 必须经过 `HumanReview`；
- `StateSnapshot` 是某一时点经顾问确认的知识状态，不等于学校客观现实；
- 五维全等模型用于匹配/失配分析，不自带成熟等级；阶段达成状态相对于 Workbench StageTarget 判断。

原始框架内容属于 `references/`，评估准则属于 `knowledge/methodology/`，学校实例数据属于 SQLite。三者不得复制到本体文件中。

`core-v1` 在首次激活前允许语义校准。激活后才进入不可原地修改规则：兼容新增发布次版本，删除、重命名或语义变化发布主版本。`pending-review` 的框架映射不得用于正式 Diagnosis。
