# School Workbench

学校变革陪跑工作台是一个 Local-first 的 Electron 桌面客户端。当前已完成 Foundation 阶段：可创建学校、进入本地工作台，并通过 SQLite 在应用重启后保留学校数据。

## Repository Map

```text
apps/          Electron 桌面应用
packages/      Domain、Application、DB、Ontology 与 Experience 代码
docs/          产品、架构、数据模型与 ADR
knowledge/     本体与方法论等版本化派生知识
references/    原始书籍、框架、标准与田野材料
AGENTS.md      贡献与 Agent 工作规则
```

权威入口：

- 产品行为：[PRD](docs/product/PRD.md)
- 技术架构：[SPEC](docs/architecture/SPEC.md)
- 数据模型：[DATABASE_SCHEMA](docs/data/DATABASE_SCHEMA.md)
- 桌面形态决策：[ADR-001](docs/architecture/ADR-001-electron-desktop.md)
- 本体架构决策：[ADR-002](docs/architecture/ADR-002-workbench-ontology.md)
- UI 系统决策：[ADR-003](docs/architecture/ADR-003-ui-system.md)
- Foundation 验收状态：[FOUNDATION_STATUS](docs/development/FOUNDATION_STATUS.md)
- 方法论基线：[Methodology](knowledge/methodology/README.md)
- 原始资料目录：[References](references/README.md)

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

目标工具链为 Node.js 24 与 pnpm 11。Ontology v1 与首期 UI 系统已经冻结。原始参考资料不进入应用安装包；Agent 运行时只使用经过审核、版本化的知识派生物。
