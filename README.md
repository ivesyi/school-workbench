# School Workbench

学校变革陪跑工作台是一个 Local-first 的 Electron 桌面客户端，唯一用户是学校变革陪跑顾问。顾问只感知三个动作：**说情况 → 做判断 → 看变化**；Stage、Evidence、Diagnosis、Snapshot、MCP、SQLite 等复杂度不进入顾问的认知负担。

当前产品链路已经用真实 Domain 与 SQLite 跑通：创建学校 → 说一条新情况 → `Evidence → ObservationFact → Claim → DiagnosisProposal → HumanReview → AcceptedJudgment` → 阶段推荐与确认 → 起点状态 Snapshot #1 → 新判断带来的状态变化与「和上一次相比」。判断由真实 Agent（Codex，经 ACP 接入）产出：**Agent 是产品必需能力**，strict 契约是 `DiagnosisProposal` 的唯一来源，工作台自身不做任何冒充 Agent 的兜底推理；Agent 不可用时顾问只能查看既有内容，不能开始新的分析。

## Repository Map

```text
apps/          Electron 桌面应用（Main / Preload / React Renderer）
packages/      shared、domain、application、db、ontology、experience、
               methodology、assessment、workbench-read-plane、workbench-mcp
docs/          产品、架构、数据模型、ADR 与各纵切实现台账
knowledge/     本体、认识模型与方法论等版本化派生知识
references/    原始书籍、框架、标准与田野材料
tests/e2e/     Playwright 持久化与流程验证
AGENTS.md      贡献与 Agent 工作规则
```

权威入口：

- 产品行为：`docs/product/PRD.md`
- 技术架构：`docs/architecture/SPEC.md`
- 数据模型：`docs/data/DATABASE_SCHEMA.md`
- 桌面形态：`docs/architecture/ADR-001-electron-desktop.md`
- 本体架构：`docs/architecture/ADR-002-workbench-ontology.md`
- UI 系统：`docs/architecture/ADR-003-ui-system.md`
- 认识模型：`knowledge/epistemic/EPISTEMIC_MODEL.md`
- 方法论基线：`knowledge/methodology/README.md`
- 原始资料目录：`references/README.md`
- 工具链基线：`docs/development/TOOLCHAIN.md`
- 怎么跑起来（给顾问的指南）：`docs/development/HOW_TO_RUN.md`

## Implementation Status

每一轮都有独立台账，写明边界、不变式、本轮未做与已知限制。**台账是进度的权威来源，README 只做索引。**

已接入产品运行时（Electron Main 已装配）：

- Foundation：Electron + typed IPC + Drizzle/SQLite + Ontology 校验 — `docs/development/FOUNDATION_STATUS.md`
- Evidence → AcceptedJudgment 认识链路与人工审核 — `docs/development/EPISTEMIC_VERTICAL_SLICE_STATUS.md`
- Stage 推荐与顾问确认（五维目标、单 active Stage） — `docs/development/STAGE_RECOMMENDATION_SLICE_STATUS.md`
- 起点状态 Snapshot #1（不可变、五维、FK provenance） — `docs/development/BASELINE_STATE_SLICE_STATUS.md`
- 后续状态与「和上一次相比」 — `docs/development/STATE_CHANGE_SLICE_STATUS.md`
- Methodology Registry 装配 + Pack 默认可用与顾问否决机制（启动加载 + `syncRegistry` + 设置页高级设置下的审核工作台 + sign-off 落库 + 否决驱动本地状态） — `docs/development/METHODOLOGY_PACK_ACTIVATION_STATUS.md`
- AI 运行时（M1–M3）：Agent Host + ACP/Codex 接入、MCP 读面（loopback server 与 capability token 由 Agent Host 启停）与写面（`evidence_register`、`diagnosis_propose`）、设置页默认助手、高层进度文案、判断确认与详情；strict Assessment 契约校验是 `DiagnosisProposal` 落库前的必经关口 — `docs/development/AI_RUNTIME_LOOP_LEDGER.md`（真 Codex 端到端验收见其 §11、§11.1）

早先「已建立但尚未接入产品运行时」的三块（Assessment 契约与 Golden 质量门禁、Validated Diagnosis 持久化缝、Workbench MCP 只读面）已随 AI 运行时接入 live flow；各自台账保留当时的边界与不变式 — `docs/development/ASSESSMENT_QUALITY_HARNESS_FOUNDATION_STATUS.md`、`docs/development/VALIDATED_DIAGNOSIS_PERSISTENCE_SEAM_STATUS.md`、`docs/development/WORKBENCH_MCP_READ_PLANE_STATUS.md`。

尚未开始：DeepSeek Harness、飞书授权与 lark-cli、RAG / FTS / 向量检索、本地文件与音频 Evidence、教师实践纵切、打包签名与自动更新。

悬而未决与下一步：全新学校的起点建立方式待顾问决定（见 `docs/development/AI_RUNTIME_LOOP_LEDGER.md` §12 的三条路）；两份 Pack 的翻译内容待补齐（10 条 criterion 的真实描述、行为锚点边界、证据指引，清单见 `docs/development/METHODOLOGY_PACK_ACTIVATION_STATUS.md`）。历史任务书（前瞻性文档，已执行）：`docs/development/METHODOLOGY_PACK_ACTIVATION_BRIEF.md`。

已知的关键约束：

- **Agent 是产品必需能力，工作台不冒充 Agent。** 伪 Agent 兜底链路已整条删除（`BaselineAssessmentEngine` 等符号在生产源码中零引用，由 `packages/application/src/proposal-creation.architecture.test.ts` 的读源码断言锁死）；`GroundedDiagnosisService` 的 strict 契约是 `DiagnosisProposal` 的唯一产生通道，校验失败即失败，不产生降级判断。Agent 不可用 / 失败 / 弃权各有明确的产品行为：前两者数据库零新增，弃权只落一条永远进不了 accept/modify 的 `insufficient_evidence` proposal。
- **两份 Pack 出厂即 `status = active`，顾问零操作即可用于判断。** 顾问在审核工作台把任意一条标为「需要修订」，该 Pack 的本地状态立即降回 `review`，`standards_get` 与 `GroundedDiagnosisService` 随即 fail-closed；这个否决在重启后也不会被 `syncRegistry` 自动推翻。现有翻译的 10 条 criterion 的 `description` 与 `title` 仍完全相同、无行为锚点，专业充分性由顾问自己判断，不再由机制代他把关。
- 现有台账证明的是协议正确性、引用完整性与持久化不变式，**不证明判断在教育咨询专业上正确**。

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm test:e2e
```

目标工具链为 Node.js 24 与 pnpm 11（见 `.node-version` 与 `package.json#engines`）。Ontology v1 当前保持 draft。原始参考资料不进入应用安装包；Agent 运行时只使用经过审核、版本化的知识派生物。
