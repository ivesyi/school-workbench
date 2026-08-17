# School Workbench

学校变革陪跑工作台是一个 Local-first 的 Electron 桌面客户端，唯一用户是学校变革陪跑顾问。顾问只感知三个动作：**说情况 → 做判断 → 看变化**；Stage、Evidence、Diagnosis、Snapshot、MCP、SQLite 等复杂度不进入顾问的认知负担。

当前产品链路已经用真实 Domain 与 SQLite 跑通：创建学校 → 说一条新情况 → `Evidence → ObservationFact → Claim → DiagnosisProposal → HumanReview → AcceptedJudgment` → 阶段推荐与确认 → 起点状态 Snapshot #1 → 新判断带来的状态变化与「和上一次相比」。所有推理仍由确定性的 Baseline Engine 承担，真实 Agent 尚未接入。

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

## Implementation Status

每一轮都有独立台账，写明边界、不变式、本轮未做与已知限制。**台账是进度的权威来源，README 只做索引。**

已接入产品运行时（Electron Main 已装配）：

- Foundation：Electron + typed IPC + Drizzle/SQLite + Ontology 校验 — `docs/development/FOUNDATION_STATUS.md`
- Evidence → AcceptedJudgment 认识链路与人工审核 — `docs/development/EPISTEMIC_VERTICAL_SLICE_STATUS.md`
- Stage 推荐与顾问确认（五维目标、单 active Stage） — `docs/development/STAGE_RECOMMENDATION_SLICE_STATUS.md`
- 起点状态 Snapshot #1（不可变、五维、FK provenance） — `docs/development/BASELINE_STATE_SLICE_STATUS.md`
- 后续状态与「和上一次相比」 — `docs/development/STATE_CHANGE_SLICE_STATUS.md`
- Methodology Registry 装配 + Pack 默认可用与顾问否决机制（启动加载 + `syncRegistry` + 设置页高级设置下的审核工作台 + sign-off 落库 + 否决驱动本地状态） — `docs/development/METHODOLOGY_PACK_ACTIVATION_STATUS.md`

已建立但**尚未接入产品运行时**的能力面：

- Assessment 契约与 Golden 质量门禁：quality gate，不是推理引擎，不接 live flow — `docs/development/ASSESSMENT_QUALITY_HARNESS_FOUNDATION_STATUS.md`
- Validated Diagnosis 持久化缝：协议校验后落库，未接 IPC / UI — `docs/development/VALIDATED_DIAGNOSIS_PERSISTENCE_SEAM_STATUS.md`
- Workbench MCP 只读面（7 个 read tool + 能力令牌）：仅提供 bootstrap factory，Electron 不启动 loopback server — `docs/development/WORKBENCH_MCP_READ_PLANE_STATUS.md`

尚未开始：Agent Host、ACP / DeepSeek Harness / Codex、MCP 写面（`evidence_register`、`diagnosis_propose`）、飞书授权与 lark-cli、RAG / FTS / 向量检索、本地文件与音频 Evidence、教师实践纵切、打包签名与自动更新。

下一轮方向：给两份 Pack 补齐翻译内容（10 条 criterion 的真实描述、行为锚点边界、证据指引）。待补清单见 `docs/development/METHODOLOGY_PACK_ACTIVATION_STATUS.md`。历史任务书（前瞻性文档，已执行）：`docs/development/METHODOLOGY_PACK_ACTIVATION_BRIEF.md`。

已知的关键约束：

- 产品 live flow 当前使用确定性的 `BaselineAssessmentEngine`，**不经过 Assessment validator，也不引用 Methodology Criterion**。接入真实 Agent 时应替换 Engine 实现，而不是改动 Domain、SQLite 或 Human Review 协议。
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
