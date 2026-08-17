# Assessment Contract + Quality Harness Foundation

本轮建立 `@school-workbench/assessment`，它是 **quality gate**，不是推理引擎，也不接入现有 Workbench live flow。

## 已建立的边界

- `AssessmentInput` 显式携带学校 scope、当前 active Stage、confirmed StageTargets、Evidence、ObservationFacts、Claims / ClaimFact stance，以及精确到 `pack key + version + criterion stable id` 的 methodology context。
- `AssessmentCandidate` 只保存可审核的短理由、引用、暂定判断、机制、替代假设、未决问题、下一步观察与影响证据计划；不保存也不要求隐藏思维链。
- 所有协议 schema 使用 strict / fail-closed；numeric score、weight、综合等级、学校排名字段不属于协议。
- `MethodologyRegistry` 只做精确解析。生产校验只接受 `active` Pack；仓库当前两份 Pack 仍保持 `review`。
- Validator 不选择 Criterion、不生成判断，只验证候选是否满足 scope、引用、stance、counter-evidence、StageTarget 和 methodology 约束。
- `proposed` 至少需要 Criterion、StageTarget、supporting fact、完成的 counter-evidence search 和一个 alternative hypothesis；已知 counter fact 不能遗漏。
- 证据不足时允许且要求 `insufficient_evidence`：`provisionalJudgment = null`，并给出 unresolved question 与 next observation。
- methodology context 只接受稳定 Criterion 引用；RAG 相似度、检索片段或原书摘录不是 Criterion，也不是 Evidence。本轮没有 retrieval。
- Golden Harness 使用完全合成的学校材料，只验证 protocol correctness。需要专业判断的正向案例统一标记 `pending_review`，不声称 consultant agreement 或模型准确率。
- Runner 与 runtime adapter 解耦；同一 candidate 无论来自何种后续 adapter，都经过同一 validator。

## 本轮未做

没有 migration，没有 diagnosis persistence integration，没有 `diagnosis_criteria`，没有 UI / IPC / Application / Domain live-flow 改造，没有 Pack 激活 UI，没有 Agent / ACP / MCP，没有 `standards_get`，没有 RAG / FTS / vector，没有飞书，也没有新增 Congruence / Role Standards 方法论实现。

## 已知限制

当前 harness 证明的是协议、引用与质量门禁的一致性，不证明候选判断在教育咨询专业上正确。仓库 Methodology Pack 仍处于 `review`；测试通过深拷贝并仅改变生命周期 `status` 构造 active 内存 fixture，不改变仓库 Pack 状态。
