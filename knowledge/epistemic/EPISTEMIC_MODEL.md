# Epistemic Model v0.1

## 1. Purpose

Workbench 不把数据库里的记录等同于学校客观现实。它保存的是：在某个时间、范围与证据条件下，顾问对学校现实所作出的可追溯判断。

因此正式链路为：

```text
School Reality
↓ observed through
Evidence
↓ described as
ObservationFact
↓ supports / counters
Claim
↓ organized into
DiagnosisProposal
↓ reviewed by
HumanReview
↓ produces
AcceptedJudgment
↓ contributes to
Assessment
↓ recorded in
StateSnapshot
```

## 2. Semantic boundaries

### Evidence

被实际用于分析的来源材料、记录或直接观察。文件本身不是结论。

### ObservationFact

可回到 Evidence 定位的低推论描述。不得包含能力、动机、价值判断或因果解释。

### Claim

关于学校现实的判断性陈述。Claim 必须具有明确范围和时间窗，可以被支持、反驳或后续修正。

### DiagnosisProposal

Agent 对一个或多个 Claim 的暂定专业组织。它必须引用 Criterion、支持与相反证据，并提出替代解释或明确证据不足。

### HumanReview

顾问对 Proposal 的认识论关口。顾问可以接受、修改、驳回或要求补证。

### AcceptedJudgment

经 HumanReview 后成立的正式判断。只有它可以参与正式学校状态。

### Assessment

在当前 StageTarget、时间和范围下，利用 AcceptedJudgment 对某个维度或对象作出的状态评估。

### StateSnapshot

某一时间点正式确认的一组 AcceptedJudgment 与 Assessment。Snapshot 是当时的最佳知识状态，不是现实本身，因此历史 Snapshot 不因未来新证据而原地改写。

## 3. Confidence

`confidence` 表示现有证据对判断的支撑程度，不是模型自信，也不是学校分数。

## 4. Evidence discipline

正式 Proposal 必须：

- 区分 ObservationFact、Interpretation 与 Claim；
- 保留 source / locator；
- 主动寻找 counter evidence；
- 至少给出一个可行替代解释，或说明为何不存在；
- 证据不足时允许 `insufficient_evidence`，不得强行定级；
- 不把单一片段泛化为全校结论；
- 不把相关性写成单一因果。

## 5. Relationship to ontology and methodology

Ontology 定义学校世界中的共同语义；Methodology 定义“应该问什么、什么证据算相关、如何避免错误推断”；Epistemic Model 定义 Workbench 如何把 Evidence 变成可审核知识。

三者关系：

```text
Ontology        = Reality semantics
Methodology     = Reference / assessment semantics
Epistemic Model = Knowledge semantics
Zod             = Data contract
SQLite          = Persistence
```

## 6. UI boundary

这些术语主要属于 Domain。顾问界面继续使用低学习成本语言：

- Evidence → 依据
- DiagnosisProposal → 我发现一个新的情况，想让你确认
- HumanReview → 认同 / 我想改一下 / 不认同
- StateSnapshot → 现在的状态 / 上一次状态

不把 Ontology、Claim、Epistemic Model 暴露成一级产品概念。
