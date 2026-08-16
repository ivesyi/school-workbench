# ADR-002: Workbench Ontology Architecture

**状态：Accepted**  
**日期：2026-08-17**  
**适用版本：Workbench V0.1+**

## Context

Workbench 已有数据库 Schema、Methodology Pack、阶段目标与行为锚点，但它们分别回答“如何存储”和“如何评估”，尚不能保证不同框架、Agent 与功能模块对 School、Person、Role、Practice、Evidence、Claim、Diagnosis、Action 和 StateSnapshot 等概念使用同一含义。

V0.1 是单用户 Local-first 应用，没有采用通用知识图谱平台的现实需求。

## Decision

建立一个**轻量、版本化、可机器校验的领域语义模型**：

```text
knowledge/ontology/   人工审核的概念、关系、约束与映射
packages/ontology/    加载、Schema 校验与引用完整性检查
SQLite                学校实例与业务状态
```

Ontology v1 使用 YAML 作为可审阅源格式，并由 Zod 在构建和测试阶段验证。稳定 ID 使用 `swb:` 前缀。数据结构保持 JSON-LD 可映射性，但 V0.1 不引入 RDF、OWL、SPARQL、Neo4j 或远程图数据库。

Ontology 显式区分四层：

```text
ontic       现实对象、角色、团队、实践与行动
normative   Stage、DesiredResult、ImpactIndicator 等“应该怎样”
epistemic   Evidence、ObservationFact、Claim、Diagnosis、Review、Judgment、Assessment、Snapshot
methodology 外部框架构念、Dimension 与 Criterion
```

关键语义：

- Person 与 Role 分离；Role 通过 RoleAssignment 绑定学校与时间窗；
- Team 是组织实体，不是 Role；
- ObservationFact 与 Claim 分离；
- Agent 只形成 DiagnosisProposal；HumanReview 才能形成 AcceptedJudgment；
- StateSnapshot 是经顾问确认的知识状态，不是学校客观现实；
- 全等模型的 Dimension 用于匹配/失配分析，不自带成熟等级；成熟/达成判断相对于 Workbench StageTarget。

本体不保存学校实例，不复制 Methodology Criterion，不生成成熟度分数，也不代替 Domain Service 的事务不变量。`constraints.yaml` 是可机器读取的语义约束清单，不建设通用规则执行引擎；真正写入不变量由 Domain Service 与测试执行。

## Versioning and Governance

首个版本在语义校准完成前保持 `draft`。`draft` 可编辑；首次激活后：

- `active` 版本不可原地改变语义；
- 删除或改变既有语义发布新主版本；
- 新增兼容概念或关系发布次版本；
- 每个 Framework Mapping 独立声明来源版本与审核状态；
- 未经人工审核的映射只能标记 `pending-review`，不能进入正式判断。

由于当前尚无生产历史数据，不为保存错误的首次草案而人为创建 v2。

## Consequences

- Agent、Methodology、Domain、数据库和 UI 可共享稳定概念；
- 现实、规范、知识与方法论对象不会被混为一层；
- 原始书籍、方法论规则和学校事实继续保持分层；
- 如未来出现复杂图查询，可增加图投影，而不重写领域语义。

## Revisit Conditions

只有出现跨学校大规模图查询、外部本体互操作或标准化语义推理的真实需求时，才评估 RDF Store、OWL reasoner 或图数据库。
