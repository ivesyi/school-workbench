# Versioned Knowledge

本目录保存 Workbench 使用的版本化、可审核知识，不保存学校实例数据。

- `methodology/`：评估构念、准则、证据指导、推论护栏与 Agent 评估协议。
- `ontology/`：未来的核心概念、关系、约束和跨框架映射；Ontology v1 冻结后建立。

`knowledge/` 是内容源；未来 `packages/ontology` 与 `packages/methodology` 是加载、验证和查询这些内容的运行时代码。两者不得混放，也不得让运行时静默改写知识源。
