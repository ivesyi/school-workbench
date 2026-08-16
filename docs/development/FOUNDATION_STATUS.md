# Foundation Implementation Status

**状态：Complete**  
**Foundation 验收日期：2026-08-17**

## Implemented Foundation Slice

```text
Electron Main
↓ typed IPC
Preload
↓ typed WorkbenchApi
React Renderer
↓
创建学校 → 进入学校工作台
↓
SchoolService → SchoolRepository → Drizzle / SQLite
↓
应用重启后仍可读取学校
```

实际 workspace：

- `apps/desktop`：Electron Main、Preload、React Renderer；
- `packages/shared`：IPC DTO 与 Zod Contract；
- `packages/domain`：Domain Entity 与 Repository Port；
- `packages/application`：Application Service；
- `packages/db`：Drizzle Schema、Migration 与 SQLite Adapter；
- `packages/ontology`：Ontology 加载和引用完整性校验；
- `packages/experience`：Quiet Workbench Token 与受控 shadcn/Radix 组件。

## Foundation Verification

Foundation 验收时以下命令通过：

```text
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Subsequent Vertical Slice

Foundation 之后已经进入真实业务链开发。首个认识链路纵切实现：

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
```

实现与人工验收说明见：

> `docs/development/EPISTEMIC_VERTICAL_SLICE_STATUS.md`

## Still Deferred

- Stage / StageTarget / StateSnapshot 状态纵切；
- 本地文件、音频与飞书 Evidence；
- DeepSeek Harness / Codex ACP；
- Workbench MCP；
- Methodology Criterion / StageTarget runtime mapping；
- 飞书授权协调；
- 打包、签名、自动更新和暗色主题。

目标工具链仍为 Node 24 + pnpm 11。
