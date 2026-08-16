# Foundation Implementation Status

**状态：Complete**  
**验收日期：2026-08-17**

## Implemented Vertical Slice

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
- `packages/domain`：School Entity 与 Repository Port；
- `packages/application`：School 用例；
- `packages/db`：Drizzle Schema、Migration 与 SQLite Adapter；
- `packages/ontology`：Ontology v1 加载和引用完整性校验；
- `packages/experience`：Quiet Workbench Token 与受控 shadcn/Radix 组件。

## Verification

以下命令均已通过：

```text
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm test       5 files / 7 tests
pnpm build
pnpm test:e2e  1 Electron restart persistence test
```

`pnpm dev` 已实际启动 Electron Main、Preload、Vite Renderer 与桌面窗口；验收后通过 SIGINT 人工结束开发进程。

## Deliberately Deferred

- 当前 Migration 只实现首个纵切需要的 `schools` 表；Canonical Schema 的 Stage、Evidence、Diagnosis、Snapshot 与 Runtime 表在对应纵切实现；
- 工作台文本输入只验证页面体验，不保存或调用模型；
- 文件、DeepSeek Harness、Codex ACP、Workbench MCP、飞书、RAG 与 Assessment Pipeline 均未进入本阶段；
- 未实现打包、签名、自动更新和暗色主题；
- 目标 Node 版本仍为 24；当前工作站使用 Node 26.7.0 完成兼容性验证。

## Next Vertical Slice

下一阶段应实现本地 Evidence 注册、Observation Fact、Diagnosis Proposal 与 Human Review，并继续使用测试 Runtime；外部 Agent Runtime 集成仍作为其后的独立兼容性纵切。
