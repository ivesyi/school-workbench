# Workbench Ontology

**状态：Ontology v1 已冻结。** 规范见 `core-v1/`，架构决策见 `docs/architecture/ADR-002-workbench-ontology.md`。

Ontology v1 在这里定义：

- 学校变革核心概念及稳定 ID；
- 合法关系、方向、基数和时间约束；
- Evidence、Claim、Diagnosis、Action 与 Impact 的语义连接；
- Schooling by Design、Data Wise、五维全等模型和角色标准的映射；
- 版本、弃用、兼容和人工批准规则。

原始框架内容属于 `references/`，评估准则属于 `knowledge/methodology/`，学校实例数据属于 SQLite。三者不得复制到本体文件中。

`core-v1` 的 `active` 内容不可原地改变语义。兼容新增发布次版本；删除、重命名或语义变化发布主版本。`pending-review` 的框架映射不得用于正式 Diagnosis。
