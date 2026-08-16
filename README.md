# School Workbench

学校变革陪跑工作台是一个 Local-first 的 Electron 桌面客户端。当前已完成 Foundation 与首个认识链路纵切：可创建学校、直接说一条新情况，并完成 `Evidence → ObservationFact → Claim → DiagnosisProposal → HumanReview → AcceptedJudgment` 的本地持久化闭环。

## Repository Map

```text
apps/          Electron 桌面应用
packages/      Domain、Application、DB、Ontology 与 Experience 代码
docs/          产品、架构、数据模型与 ADR
knowledge/     本体、认识模型与方法论等版本化派生知识
references/    原始书籍、框架、标准与田野材料
AGENTS.md      贡献与 Agent 工作规则
```

权威入口：

- 产品行为：`docs/product/PRD.md`
- 技术架构：`docs/architecture/SPEC.md`
- 数据模型：`docs/data/DATABASE_SCHEMA.md`
- 桌面形态：`docs/architecture/ADR-001-electron-desktop.md`
- 本体架构：`docs/architecture/ADR-002-workbench-ontology.md`
- 认识模型：`knowledge/epistemic/EPISTEMIC_MODEL.md`
- UI 系统：`docs/architecture/ADR-003-ui-system.md`
- Foundation 状态：`docs/development/FOUNDATION_STATUS.md`
- Evidence→Judgment 纵切：`docs/development/EPISTEMIC_VERTICAL_SLICE_STATUS.md`
- 方法论基线：`knowledge/methodology/README.md`
- 原始资料目录：`references/README.md`

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

目标工具链为 Node.js 24 与 pnpm 11。Ontology v1 当前保持 draft；首个 Evidence→Judgment 纵切已经开始用真实 Domain 和 SQLite 验证其语义边界。原始参考资料不进入应用安装包；Agent 运行时只使用经过审核、版本化的知识派生物。
