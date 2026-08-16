# Agent Assessment Protocol v1.1

## 1. Purpose

本协议定义 Agent 如何把 Evidence 转化为可审核的 `DiagnosisProposal`。Agent 负责专业推理和建议；Workbench 保存事实、版本与状态；顾问负责最终判断。

正式认识链：

```text
Evidence
↓
ObservationFact
↓
Claim
↓
DiagnosisProposal
↓
HumanReview
↓
AcceptedJudgment
↓
Assessment / StateSnapshot
```

## 2. Minimum input

- 学校、时间窗与当前阶段；
- 本次问题或决策范围；
- Evidence 引用及来源元数据；
- 适用的 Methodology Pack、Criterion 与角色锚点版本；
- 已确认的历史 AcceptedJudgment 与 StateSnapshot。

缺少范围、证据来源或适用标准时，不得形成正式阶段建议。

## 3. Seven-step assessment

1. **Scope**：明确评估对象、时间窗、维度与角色，不跨范围泛化。
2. **Facts**：从材料中提取低推论 `ObservationFact`，保留来源、时间、主体和 locator。
3. **Evidence quality**：检查真实性、直接性、多样性、代表性、时效性与可比性。
4. **Criterion mapping**：先按任务路由选择 Pack，再映射稳定 Criterion ID；语义相似度不能决定标准。
5. **Claims / gap hypothesis**：比较 StageTarget、Criterion 与 Fact，形成可被支持或反驳的 Claim。
6. **Challenge**：主动搜索相反证据，提出至少一个可行替代解释，检查是否把相关性误写成因果。
7. **Action / impact**：提出最小可行动步骤、责任主体、预期变化、取证方法和调整条件。

## 4. Reviewable reasoning only

只保存以下可审核结构：

```text
Observation Facts
Claims
Interpretations
Provisional Judgment
Criterion References
Supporting Evidence
Counter Evidence
Alternative Hypotheses
Confidence + Limitations
Next Observation / Action / Impact Evidence
```

不得保存或要求模型披露隐藏思维链。`Interpretations` 仅保存简短、面向证据的说明。

## 5. Abstention conditions

出现任一条件，Agent 输出 `insufficient_evidence` 或降低置信度，不得强行定级：

- 关键结论只有单一、间接或无法核验的来源；
- 样本无法代表所判断的学校范围或角色群体；
- 证据与判断时间窗不一致；
- 缺少明确 StageTarget、Criterion 或角色锚点；
- 支持与相反证据无法合理解释；
- 无法区分事实与评价性语言；
- 涉及个人绩效、敏感归因或超出顾问授权的结论。

## 6. Canonical DiagnosisProposal contract

本契约是 MCP 输入、Domain DTO 与测试的唯一语义来源；工程实现应以一个共享 Zod Schema 生成类型，不再维护平行手写版本。

```ts
type DiagnosisProposal = {
  type: 'state' | 'characteristic' | 'mismatch' | 'practice'
  title: string
  scope: {
    schoolId: string
    timeWindow: string
    dimensionKeys: string[]
    roleRefs?: string[]
  }
  methodologyRefs: Array<{
    packId: string
    version: string
    criterionId: string
  }>
  facts: Array<{
    statement: string
    evidenceId: string
    locator: Record<string, unknown>
  }>
  claims: Array<{
    statement: string
    supportingFactIndexes: number[]
    counterFactIndexes: number[]
  }>
  interpretations: string[]
  provisionalJudgment: string | null
  mechanism?: string
  stageTargetIds: string[]
  alternativeHypotheses: string[]
  unresolvedQuestions: string[]
  confidence: 'low' | 'medium' | 'high'
  limitations: string[]
  recommendedActions: Array<{
    action: string
    owner?: string
    timing?: string
  }>
  nextObservations: string[]
  impactEvidencePlan: string[]
  evidenceQuality: {
    directness: 'low' | 'medium' | 'high'
    triangulated: boolean
    notes?: string
  }
  status: 'proposed' | 'insufficient_evidence'
}
```

`methodologyRefs` 已同时固定 Pack、version 与 Criterion，不再额外维护重复的 `frameworkVersionIds`。

`confidence` 表示“现有证据对该判断的支撑程度”，不是模型自信，也不是学校得分。

## 7. Retrieval / RAG rules

检索按以下顺序进行：已批准的结构化 Pack → 元数据过滤后的本地全文检索 → 可选向量检索 → 原书短片段核验。RAG 只能定位相关来源、解释概念与补充出处；不能创建 Criterion、决定成熟度、覆盖相反证据或直接提交正式判断。

## 8. Human review gate

顾问审核时必须能看见：判断范围、Fact 引用、Claim、标准版本、支持与相反证据、替代解释、局限和下一步。顾问可批准、修改、驳回或要求补证。

Agent Proposal 保持不可变。顾问修改后的正式文本写入 `HumanReview` 并形成新的 `AcceptedJudgment`，不覆盖 Agent 原始 Proposal。

只有 AcceptedJudgment 才能参与 Assessment 与 StateSnapshot；Agent 无权自行批准或提交学校正式状态。
