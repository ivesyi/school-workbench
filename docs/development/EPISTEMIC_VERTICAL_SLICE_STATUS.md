# Evidence → AcceptedJudgment Vertical Slice

**状态：Implemented baseline**  
**日期：2026-08-17**

## Scope

```text
顾问输入
↓
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
```

正式判断仍只由顾问产生。`DiagnosisProposal` 创建后不原地修改；接受、修改或拒绝通过独立 `HumanReview` 记录；只有接受或修改才产生 `AcceptedJudgment`。

## Implemented

- Zod contract：提交情况、待确认判断、人工审核、正式判断列表；
- Domain factory 与 Repository port；
- SQLite migration 与 Drizzle schema；
- Application `JudgmentService` 和可替换的 `AssessmentEngine`；
- Electron typed IPC + preload；
- 工作台 UI：说情况 → 看依据 → 认同 / 修改 / 不认同；
- 正式判断跨应用重启持久化；
- Domain、Application、Repository、IPC、UI 和 Electron E2E tests。

## Temporary assessment engine

当前 `BaselineAssessmentEngine` 是确定性本地实现，只负责验证业务闭环：

- 原始输入登记为 `pasted_text` Evidence；
- ObservationFact 只记录“顾问报告了这件事”，不会把报告内容自动升级成已验证事实；
- 基于该报告形成低置信度、未三角验证的暂定 Claim；
- Proposal 默认要求寻找独立材料交叉验证。

后续接入真实 Agent 时，应替换 `AssessmentEngine` 实现，而不是改变 Domain、SQLite 或 Human Review 协议。

## Manual acceptance path

1. `pnpm dev`；
2. 新建学校并进入工作台；
3. 输入：`今天的中层会议里，任务拆解还是主要由校长完成。`；
4. 点击“提交情况”；
5. 检查“我发现一个新的情况，想让你确认”；
6. 展开“为什么这样判断？”；
7. 分别验证“认同”“我想改一下”“不认同”；
8. 接受或修改后重启应用，正式判断仍应存在。

## Known limitations

- 尚未接入 DSH / Codex ACP 与 Workbench MCP；
- 尚未接入 Methodology Criterion / StageTarget mapping；
- 当前只支持顾问直接输入文本作为 Evidence；
- 未审核 Proposal 暂无跨重启恢复界面；
- AcceptedJudgment 尚未汇入 StateSnapshot。
