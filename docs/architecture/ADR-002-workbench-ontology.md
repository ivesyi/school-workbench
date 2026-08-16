# ADR-002: Workbench Ontology Architecture

**状态：Accepted**  
**日期：2026-08-17**  
**适用版本：Workbench V0.1+**

## Context

Workbench 已有数据库 Schema、Methodology Pack、阶段目标与行为锚点，但它们分别回答“如何存储”和“如何评估”，尚不能保证不同框架、Agent 与功能模块对 School、Evidence、Practice、Diagnosis、Action 和 Impact 等概念使用同一含义。

如果仅依赖自然语言或检索相似度做跨框架连接，概念会漂移，关系无法验证，历史判断也难以稳定解释。另一方面，V0.1 是单用户 Local-first 应用，没有采用通用知识图谱平台的现实需求。

## Decision

建立一个**轻量、版本化、可执行的领域本体**：

```text
knowledge/ontology/   人工审核的概念、关系、约束与映射
packages/ontology/    加载、校验与查询代码
SQLite                学校实例与业务状态
```

Ontology v1 使用 YAML 作为可审阅源格式，并由 Zod 在构建和测试阶段验证。稳定 ID 使用 `swb:` 前缀；每个版本一经激活不得原地改变语义。数据结构保持 JSON-LD 可映射性，但 V0.1 不引入 RDF、OWL、SPARQL、Neo4j 或远程图数据库。

本体只定义共享语义：

- 核心概念；
- 合法关系及方向；
- 跨学校、时间、证据和人工批准约束；
- 外部方法论与共同概念的显式映射边界。

本体不保存学校实例，不复制 Methodology Criterion，不生成成熟度分数，也不代替 Domain Service 的事务不变量。

## Versioning and Governance

- `draft` 版本可编辑，`active` 版本不可原地修改；
- 删除或改变既有语义必须发布新主版本；
- 新增兼容概念或关系发布次版本；
- 每个 Framework Mapping 独立声明来源版本与审核状态；
- 未经人工审核的映射只能标记 `pending-review`，不能进入正式判断。

## Consequences

- Agent、Methodology、数据库和 UI 可共享稳定概念标识；
- 关系错误能在运行前被发现；
- 原始书籍、方法论规则和学校事实继续保持分层；
- 如未来出现复杂图查询，可在不改变语义源的前提下增加投影，而不是重写领域模型。

## Revisit Conditions

只有出现跨学校大规模图查询、外部本体互操作或标准化语义推理的真实需求时，才评估 RDF Store、OWL reasoner 或图数据库。
