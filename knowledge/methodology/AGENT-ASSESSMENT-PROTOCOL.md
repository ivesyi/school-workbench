# Agent Assessment Protocol v1

## 1. 目的

本协议把 Evidence 转化为可审核的 `DiagnosisProposal`。Agent 负责专业推理和建议；Workbench 保存事实、版本与状态；顾问负责最终判断。

## 2. 最小输入

- 学校、时间窗与当前阶段；
- 本次问题或决策范围；
- Evidence 引用及来源元数据；
- 适用的 Methodology Pack、Criterion 与角色锚点版本；
- 已批准的历史 Diagnosis 和 State Snapshot。

缺少范围、证据来源或适用标准时，不得形成正式阶段建议。

## 3. 七步评估

1. **Scope**：明确评估对象、时间窗、维度与角色，不跨范围泛化。
2. **Facts**：从材料中提取可观察事实，保留来源、时间、主体和上下文。
3. **Evidence quality**：检查真实性、直接性、多样性、代表性、时效性与可比性。
4. **Criterion mapping**：先按任务路由选择 Pack，再映射稳定 Criterion ID；语义相似度不能决定标准。
5. **Gap / practice hypothesis**：比较阶段目标与事实，形成暂定差距或实践问题。
6. **Challenge**：主动搜索相反证据，提出至少一个可行替代解释，检查是否把相关性误写成因果。
7. **Action / impact**：提出最小可行动步骤、责任主体、预期变化、取证方法和调整条件。

## 4. 可保存推理记录

只保存以下可审核结构：

```text
Observation Facts
Interpretations
Provisional Judgment
Criterion References
Supporting Evidence
Counter Evidence
Alternative Hypotheses
Confidence + Limitations
Next Observation / Action / Impact Evidence
```

不得保存或要求模型披露隐藏思维链。`Interpretations` 使用简短、面向证据的说明，不记录冗长内部推演。

## 5. 必须保留意见的情形

出现任一条件，Agent 输出 `insufficient_evidence` 或降低置信度，不得强行定级：

- 关键结论只有单一、间接或无法核验的来源；
- 样本无法代表所判断的学校范围或角色群体；
- 证据与判断时间窗不一致；
- 缺少明确阶段目标、Criterion 或角色锚点；
- 支持与相反证据无法合理解释；
- 无法区分事实与评价性语言；
- 涉及个人绩效、敏感归因或超出顾问授权的结论。

## 6. Proposal 最小契约

```ts
type DiagnosisProposal = {
  scope: { schoolId: string; timeWindow: string; dimensions: string[] }
  methodologyRefs: Array<{ packId: string; version: string; criterionId: string }>
  facts: Array<{ statement: string; evidenceIds: string[] }>
  interpretations: string[]
  provisionalJudgment: string | null
  supportingEvidenceIds: string[]
  counterEvidenceIds: string[]
  alternativeHypotheses: string[]
  confidence: 'low' | 'medium' | 'high'
  limitations: string[]
  nextObservation: string[]
  recommendedActions: Array<{ action: string; owner?: string; timing?: string }>
  impactEvidencePlan: string[]
  status: 'proposed' | 'insufficient_evidence'
}
```

置信度表示“现有证据对该判断的支撑程度”，不是模型自信，也不是学校得分。

## 7. Retrieval / RAG 规则

检索按以下顺序进行：已批准的结构化 Pack → 元数据过滤后的本地全文检索 → 可选向量检索 → 原书短片段核验。RAG 只能定位相关来源、解释概念与补充出处；不能创建 Criterion、决定成熟度、覆盖相反证据或直接提交 Diagnosis。

## 8. 人工审核门

顾问审核时必须能看见：判断范围、事实引用、标准版本、支持与相反证据、替代解释、局限和下一步。顾问可批准、修改、驳回或要求补证。只有批准后的 Diagnosis 才能参与 State Commit；Agent 无权自行批准或提交学校正式状态。
