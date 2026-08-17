# AI Runtime M1 — 真链路读方向接通

**日期：2026-08-17**
**基线提交：`76a4a82`**
**范围：Agent Host（ACP）+ loopback read plane 在 Electron 主进程启动 + 三张 Agent Runtime 表**

---

## 1. 这一轮做到了什么

```text
Agent Host（packages/agent-host，新建）
      ↓ ACP（@agentclientprotocol/sdk 1.3.0，client() fluent API）
codex-acp（@agentclientprotocol/codex-acp 1.4.0，spawn，从不 import）
      ↓ CODEX_PATH → 顾问本机 codex-cli 0.147.0
Codex
      ↓ MCP stdio（ACP session/new 的 mcpServers 注入）
school-workbench-mcp（packages/workbench-mcp，仓库既有真包）
      ↓ HTTP loopback 127.0.0.1 随机端口 + 能力令牌
WorkbenchLoopbackReadPlane（packages/workbench-read-plane，既有）
      ↓
SQLite
```

链路上除**最后一步 `session/prompt`（需要 Codex 凭据与真实模型调用）**之外，每一段都在这台机器上用真实组件跑通过（见第 4 节证据）。

M1 只做读方向。`evidence_register` / `diagnosis_propose` 与任何写 scope 都没有碰。

---

## 2. 交付清单

### 2.1 `packages/agent-host`（新建包，SPEC 65 已给的包名）

| 文件                       | 职责                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `contracts.ts`             | 六态、三态兼容性、7 个只读 tool 名、SPEC 25 禁止 tool 的**显式 negative 常量**、不广播的 ACP client 方法清单 |
| `run-status.ts`            | SPEC 61 六态状态机与合法迁移；`needs_input` 双向可进出                                                       |
| `session-updates.ts`       | `session/update` 的**全函数**读取器：任何未知/畸形输入都不抛，只标记 `unrecognised`                          |
| `mcp-descriptor.ts`        | 组装 ACP `McpServerStdio`；服务器名常量；按 `stdio.ts` 的规则**预先** fail-closed 校验四个 env               |
| `mcp-visibility.ts`        | 用真实 MCP client 跑真实 MCP server，验证 7 个只读 tool 可见、禁止 tool 不可见                               |
| `paths.ts`                 | workbench-mcp / codex-acp / 系统 codex 的路径解析（env → bundled → node_modules，含 asar 回退）              |
| `permission-policy.ts`     | ACP 权限策略：只对 workbench MCP 的 tool call 给 `allow_once`，其余 `reject_once`                            |
| `runtime-compatibility.ts` | SPEC 62 三态判定，**只看 initialize 返回 + capability 探测 + contract test**，不看版本号                     |
| `session-workspace.ts`     | D3 一次性 cwd，run 结束即删，且与工作台用户数据目录互不包含                                                  |
| `acp-runtime.ts`           | spawn codex-acp、NDJSON 流、以及**入站消息旁路观测**（见 4.3）                                               |
| `agent-host.ts`            | SPEC 7 全生命周期编排                                                                                        |

### 2.2 三张表 + 前向迁移

`packages/db/drizzle/0008_agent_runtime_tables.sql`：`runtime_profiles` / `agent_sessions` / `agent_runs`。

- journal 只追加（`_journal.json` 只有 +7 行，无删改），迁移 SQL **无 `INSERT` / `DROP` / 语句级 `UPDATE` / `ALTER`**
- `agent_runs.status` 的六态**写进了 SQL CHECK 约束**，不是只在 TypeScript 里。SPEC 39 说「Schema 不增加新的状态」，那就让数据库自己拒绝第七个
- `agent_sessions.compatibility` 同样用 CHECK 锁死三态；`runtime_profiles.transport` 用 CHECK 锁死 `'acp'`
- `agent_runs` **没有** reason / detail 列。SPEC 39 明确「具体原因不进数据库 enum」，一个自由文本列会悄悄变成同一份状态的第三个副本

### 2.3 loopback 在 Electron 主进程启动

- `apps/desktop/package.json` 补齐 `@school-workbench/workbench-read-plane`、`@school-workbench/workbench-mcp`、`@school-workbench/agent-host`、`@agentclientprotocol/codex-acp`
- `apps/desktop/src/main/read-plane-runtime.ts` 组装 `SqliteReadPlaneRepository(database)`（吃 `WorkbenchDatabase` 整体）→ `WorkbenchReadCapabilityService` → `createWorkbenchReadPlaneBootstrap` → `plane.start()`
- `MethodologyRuntime` 扩展为额外暴露 `registry` / `repository`，`index.ts` **没有**第二份 registry/repository，因此没有第二次 `syncRegistry`
- `before-quit` 里 `await plane.stop()` 再 `closeDatabase()`（异步收尾，2 秒上限）

### 2.4 MCP 子进程路径解析

- 开发态：根 `dev` 脚本改为先构建 workbench-mcp 再起 electron-vite
- 打包态：`electron.vite.config.ts` 新增 `copyWorkbenchMcp()`，把 `dist/stdio.js` 复制到 `out/main/workbench-mcp/stdio.js`
- 解析顺序：`SWB_WORKBENCH_MCP_ENTRY` → bundle 旁 → 逐级向上找 `node_modules`；每个候选都额外探 `app.asar.unpacked`（子进程不能从 asar 内执行）

### 2.5 Agent Bootstrap

`packages/agent-host/src/bootstrap.ts` 逐行照抄 `SPEC.md` 第 26 章代码块（原文在 `SPEC.md:784-802`）。含 `diagnosis_propose` 那几句一并注入，没有删改。有测试断言逐句存在。

---

## 3. 关键设计决定

### 3.1 依赖放 dependency 还是 devDependency

| 包                                     | 放哪                                   | 理由                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@agentclientprotocol/sdk@1.3.0`       | `packages/agent-host` **dependencies** | 产品代码直接 import，electron-vite 会把它打进 `out/main`。devDependency 在生产安装时会被剪掉                                                                                                                                         |
| `@agentclientprotocol/codex-acp@1.4.0` | `apps/desktop` **dependencies**        | 它是**产品在运行时 spawn 的工件**，不是构建工具。放 devDependency 会让发布出去的应用起不了任何 Agent，而 `npx -y` 被明令禁止。只在 desktop 声明一次，因为需要它「在 node_modules 里可解析」的正是这个应用；agent-host 从不 import 它 |
| `@modelcontextprotocol/client@2.0.0`   | `packages/agent-host` **dependencies** | tool 可见性验证在产品路径上，每次 run 都会跑                                                                                                                                                                                         |

**代价（如实记）**：`@agentclientprotocol/codex-acp` 硬依赖 `@openai/codex@^0.147.0`，因此 `pnpm install` 会多拉 **262 MB** 的平台二进制（`@openai+codex@0.147.0-darwin-arm64`）。运行时**不会**用到它——`CODEX_PATH` 指向顾问自己的 `~/.local/bin/codex`（SPEC 12「优先使用顾问现有 System Codex」）。这是 D5 pin 精确版本带来的安装体积成本，无法在保留 pin 的前提下规避。

### 3.2 `agent_run_id` 补不补 FK：**不补**

`evidence.agent_run_id` 与 `observation_facts.agent_run_id` 现在终于有表可指了，但这一单**没有**加 FK 约束，理由三条：

1. SQLite 无法对已存在的表原地 `ADD CONSTRAINT`，只能走「建新表 → 拷数据 → 删旧表 → 改名」的 12 步重建。为一个可空的溯源指针去重建两张核心业务表，是拿顾问的真实数据换一条约束
2. 前向迁移一旦触碰 `evidence` / `observation_facts`，就不再是纯追加，违反不变式
3. 读平面本来就把它当不透明字符串处理（`EvidenceMetadataDto.agentRunId: string | null`），没有依赖引用完整性的读路径

有测试锁死这一点：迁移 SQL 里不允许出现 `evidence` / `observation_facts` 字样，且 `evidence` 建表语句里不允许出现 `agent_runs`。等真的需要按 run 反查证据时再单独评估。

### 3.3 MCP server 名：`school-workbench-internal-read-plane-3f9a1c`

codex-acp 1.4.0 的 `shouldDeduplicateMcpConflicts()` 默认开启：它先读 Codex 各 config layer 里已有的 server 名，**同名的直接过滤掉、不配置、不报错**，表现就是「Agent 看不到 workbench tool」。`DISABLE_MCP_CONFIG_FILTERING=true` 被明令禁止（那会让 Codex 深合并两套不兼容 schema），所以唯一的防线就是名字本身：

- 产品命名空间 + 用途 + 一段固定的任意后缀，共 41 字符
- **不含任何空白**，所以 `sanitizeMcpServerName()`（只把空白换成 `_`）原样透传，注入的名字和被比对的名字一致
- 只用 `[A-Za-z0-9-]`，是合法的 TOML 裸键

有测试锁死「无空白 / sanitize 后不变 / 不等于任何常见短名」。

### 3.4 「session/new 之后验证 tool 列表可见」怎么做的

**ACP v1 没有给 client 任何列举 agent 侧 tool 的方法**（`ClientRequestMethod` 里没有这种东西）。所以做了三层，全是真的：

1. **注入前的 contract test**：用**完全相同的 command / args / env** 起一次真实 workbench MCP server，走真实 MCP `initialize` + `tools/list`，断言 7 个只读 tool 齐全、SPEC 25 的 4 个禁止 tool 一个都没有。失败即整个 run 失败，不进 `session/new`。这同时是 SPEC 62 三态判定里 "Contract test" 那一条腿
2. **协议层信号**：codex-acp 把「MCP server 启动失败或被取消」编码成一条合成的 `tool_call`，`toolCallId = mcp_startup.<urlencode(名字)>`、`status = failed`。Agent Host 解码它，看到自己的 server 名即失败，**不静默继续**
3. **运行后的实际使用信号**：`toolCallTitles` 里是否出现 `mcp.<我们的 server 名>.*`，作为 `usedWorkbenchTools` 返回

三层之间的**优先级**（验收后修订，见第 10 节 B3）：层②是一份「server 有没有就绪」的**报告**，层③是同一件事的**直接观测**。报告可能超时误报，但工具结果不可能来自一个从未启动的 server，所以层③在场时压过层②。

### 3.5 D2：`fs/*` 与 `terminal/*` 不广播

Agent Host 传给 `initialize` 的 `clientCapabilities` 是 `{}`，并且**没有注册任何** `fs/*` / `terminal/*` 的 handler。契约测试从两侧锁死：广播的能力位全为 false；脚本化的 agent 依次请求全部 7 个方法，全部被拒。

⚠️ 见第 9 节：SDK 会把 `ClientCapabilities` 归一化，线上 payload 里这些键**一定存在**、值为 `false`，不能断言「键不存在」。

### 3.6 权限策略

M1 没有面向顾问的权限 UI（PRD 16 属于后续纵切），所以主进程不能问人。策略：workbench MCP 的 tool call 给 `allow_once`（它们本来就只读、且已被能力令牌三重绑定、SPEC 25 的写 tool 根本不在面上），其余一律 `reject_once`，没有可选项时 `cancelled`。**从不选 `allow_always` / `reject_always`**——常驻授权会活得比产生它的那次 run 更久。权限请求期间 run 处于 `needs_input`，答复后回到 `running`。

---

## 4. 实际跑通的证据

### 4.1 自动化（可复跑）

| 命令             | 基线（`76a4a82`）    | 现在                                               |
| ---------------- | -------------------- | -------------------------------------------------- |
| `pnpm typecheck` | 通过                 | 通过                                               |
| `pnpm lint`      | 通过                 | 通过（No issues found）                            |
| `pnpm format`    | 通过                 | 见 7.1（只剩两份**不属于本单**的未跟踪文档不合规） |
| `pnpm test`      | 47 files / 174 tests | **59 files / 261 tests**                           |
| `pnpm build`     | 通过                 | 通过                                               |
| `pnpm test:e2e`  | 8 passed             | **10 passed**                                      |

### 4.2 用真实 codex-acp + 真实 Codex 做的手工验证（本机，已完成）

**A. ACP initialize（真 codex-acp 1.4.0 + 真 codex-cli 0.147.0）**

用 Agent Host 的 spawn 配方（`process.execPath` + `ELECTRON_RUN_AS_NODE=1` + `CODEX_PATH=/Users/yihu/.local/bin/codex`）起 codex-acp，`initialize` 返回：

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "@agentclientprotocol/codex-acp", "title": "Codex", "version": "1.4.0" },
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "embeddedContext": true, "image": true },
    "sessionCapabilities": {
      "resume": {},
      "list": {},
      "close": {},
      "delete": {},
      "additionalDirectories": {}
    },
    "mcpCapabilities": { "acp": false, "http": true, "sse": false }
  }
}
```

→ `assessRuntimeCompatibility` 对这个真实返回给出 `verified`（protocolVersion 匹配、未声明缺失能力、contract test 通过）。
→ 顺带确认：`mcpCapabilities` 里**没有 stdio 位**，因为 stdio 是 ACP 的基线传输，只有 http/sse/acp 才是可选能力。兼容性判据据此写成「只有显式声明不支持 MCP 才算缺能力」。

**B. `session/new` + 真实注入 workbench MCP server（真 Codex）**

用真实的 `out/main/workbench-mcp/stdio.js`、真实的服务器名与四个 env，向真 Codex 发 `session/new`：

- `session/new` 成功返回 sessionId 与模型列表
- **连续 3 次**：`mcp_startup` 失败更新为空 → 服务器名**没有**被 dedup 过滤掉，Codex 接受了这个 MCP server
- 另用一个会记录自身启动的包装脚本确认：**Codex 确实 spawn 了 MCP 子进程**，并把我们注入的 `SWB_ENDPOINT` / `SWB_SCHOOL_ID` 原样传了进去

**C. 反向证据：检测机制真的会响**

第一次（冷启动）那一轮，Codex 报了：

```text
mcp_startup.school-workbench-internal-read-plane-3f9a1c  status=failed
"[codex-acp forwarded startup error] MCP server `...` startup was cancelled."
```

Agent Host 的解码逻辑原样捕获了它。之后连续 3 次都干净 → **判定为冷启动超时，不是名字冲突**。这条要点写进 7.2。

**D. 真实 MCP server × 真实 loopback × 真实 SQLite**

`packages/agent-host/src/mcp-visibility.test.ts` 不是替身：真 esbuild 产物、真 stdio、真 Fastify loopback、真迁移过的 SQLite。断言 `tools/list` 恰好是 7 个冻结的只读 tool，且 `diagnosis_accept` / `diagnosis_reject` / `state_commit` / `stage_activate` / `evidence_register` / `diagnosis_propose` 一个都不在。

### 4.3 一个必须讲清楚的实现细节：入站消息旁路

`@agentclientprotocol/sdk@1.3.0` 的 `ClientApp` 构造函数会无条件挂一个 `SessionUpdateRouter`，它对每条 `session/update` 都跑 `zSessionNotification.parse(...)`。而 1.3.0 的 `SessionUpdate` zod 联合**没有 catch-all 分支**——实测未知 `sessionUpdate` 标签会 parse 失败。

实测行为（在 SDK 上直接验的）：

- 连接**不会**断，prompt turn **照常**以 `end_turn` 完成，后续已知更新照常送达 → **SDK 层面已经是 fail-open**（notification 的错误在 `jsonrpc.js` 里被 catch 掉，只 `console.error`）
- 但那条未知更新**被丢弃**，任何 typed handler 都收不到——即使注册了宽松 parser 也一样，因为 router 先抛

所以 Agent Host 在 NDJSON 流上加了一层**只读旁路**（`observeInboundMessages`）：原样转发，不改写任何消息，只是在 SDK 解析之前把消息给观测器看一眼。这样未知更新种类**被看见、被记录、被忽略**，而不是既看不见也不知道。观测器本身是全函数，且包在 try 里——观测出错也不可能弄坏传输。

---

## 5. 新增 / 修改的测试

| 测试文件                                                 | 覆盖                                                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-host/src/run-status.test.ts`             | 六态冻结、`needs_input` 不裂变成第七态、终态不可逆、非法迁移抛错                                                                                                           |
| `packages/agent-host/src/session-updates.test.ts`        | 未知事件 fail-open、畸形输入永不抛、`mcp_startup` 解码、文本累积                                                                                                           |
| `packages/agent-host/src/mcp-descriptor.test.ts`         | descriptor 形状、server 名抗撞车、14 组 fail-closed 输入、只读 scope 集合、SPEC 25 禁止清单                                                                                |
| `packages/agent-host/src/runtime-compatibility.test.ts`  | 三态判定全分支 + **源码级断言：不出现版本号字面量、不按 agentName/agentVersion 分支**                                                                                      |
| `packages/agent-host/src/session-workspace.test.ts`      | 每 run 独立空目录、用完即删、与用户数据目录互不包含                                                                                                                        |
| `packages/agent-host/src/paths.test.ts`                  | 三种解析来源、asar.unpacked 回退、缺失时明确报错、系统 codex 发现                                                                                                          |
| `packages/agent-host/src/permission-policy.test.ts`      | 按 server 名而非 tool 名识别、只 allow_once、无可用选项则 cancel                                                                                                           |
| `packages/agent-host/src/agent-host.test.ts`             | SPEC 7 全生命周期、bootstrap 逐句原文、未知事件不打断、**`fs/*`+`terminal/*` 契约（双向）**、`needs_input` 进出、cancel、协议不兼容、tool 不可见即失败、MCP 启动失败即失败 |
| `packages/agent-host/src/mcp-visibility.test.ts`         | 真 MCP server × 真 loopback × 真 SQLite 的 `tools/list`                                                                                                                    |
| `packages/db/src/agent-runtime-schema-migration.test.ts` | 三表存在、迁移无 INSERT/DROP/ALTER、不触碰既有两张表、六态 CHECK、三态 CHECK、transport CHECK、仓储读写、`agent_runs` 列清单里没有 reason                                  |
| `apps/desktop/src/main/read-plane-runtime.test.ts`       | methodology 不可用时其余 6 个能力照常 200、`standards_get` fail-closed 409、启动不等 methodology、方法论到位后被采纳                                                       |
| `apps/desktop/src/main/agent-ipc.test.ts`                | 输入校验、读平面未起时明确拒绝、令牌/端点不得越过 IPC                                                                                                                      |
| `tests/e2e/agent-read-plane-startup.spec.ts`             | 真 Electron：方法论失败时读平面照常 ready、端口不外泄、产品流程不受影响；运行时缺失时 run 落 `failed` 且不谎称读过数据                                                     |
| `apps/desktop/src/main/methodology-ipc.test.ts`（改）    | 跟随 `MethodologyRuntime` 类型扩展                                                                                                                                         |

**测试里的 fake 边界**：只有一个——`agent-host.test.ts` 里的 in-process ACP agent，替的是**运行时进程**，为的是不花钱、不联网、不依赖 Codex 登录。它没有替 MCP server，没有替读平面，没有替数据库，也没有进产品代码路径（`AcpRuntimeLauncher` 是接口，生产实现是 `CodexAcpRuntimeLauncher`）。它**不构成**「跑通」的证据；跑通的证据是 4.2。

---

## 6. 与既有不变式的关系

- 历史迁移未改写，journal 只追加，迁移 SQL 无 `INSERT` ✅
- `packages/workbench-read-plane` 的鉴权三重绑定未放松，`auth.ts` 未改动 ✅
- loopback 仍只监听 `127.0.0.1`，硬断言未拆 ✅
- 令牌仍只存 SHA-256 摘要；此外 Agent Host **在 run 结束时主动 revoke**，不等 TTL ✅
- 未新建第二套宽松 DTO ✅
- Renderer 零改动（见 7.3） ✅
- `knowledge/` 与两份 `pack.json` 零改动；未激活任何 Pack；未预填 sign-off ✅
- `packages/assessment/src/golden.ts` 零改动；根 `engines` 零改动 ✅

---

## 7. 未验证 / 需要主会话知情的事

### 7.1 `pnpm format` 目前是红的，但不是本单造成的

失败的两个文件是主会话在本单执行期间新增的**未跟踪**文档：

```text
docs/development/AI_RUNTIME_INTEGRATION_BRIEF.md
docs/development/AI_RUNTIME_LOOP_LEDGER.md
```

把这两个文件排除后 `prettier --check .` 全绿。本单没有动它们（它们不属于本单，且可能正在被并发写入）。

### 7.2 Codex 首次冷启动可能把 MCP 启动报成 "cancelled"

4.2-C 实测到一次，之后 3 次连续干净。**验收时主会话用真 Codex 定性了这件事：它不是抖动，是误报**——MCP 起来了、tool 被调用了、数据读到了，run 却被记成 failed。已按第 10 节 B3 修复。仍然**未定量**：不知道触发概率，也不确定是否只在 codex app-server 冷启动时发生。没有为此加超时配置项（超范围）。

### 7.3 UI 与 renderer

- renderer 一行未改，没有做任何 Agent UI
- 但为了让这条链路**可被真实触发和验收**，加了一条 IPC 通道 `agent:run` 与 preload 桥。`AgentBridge` 类型**刻意没有并入 `WorkbenchApi`**——renderer 契约保持原样，四个 renderer 测试因此一行未动。这是本单唯一一处「简报没点名要、我判断必须有」的东西；如果主会话认为超范围，删掉 `agent-ipc.ts` / `agent-runtime.ts` / preload 里那 8 行即可，agent-host 与读平面都不受影响

### 7.4 明确没做 / 没验证

- **没有跑过一次真实的 `session/prompt`**。那需要 Codex 凭据与真实模型调用（花钱），而且我被明令禁止触碰 Codex 授权面。第 8 节给出主会话的手工步骤
- **打包态（asar）路径回退只有单元测试，没有真机验证**。本单不做打包，`electron-builder` 配置也不存在
- **`agent_sessions` 行是在 run 结束后一次性写入的**。如果应用在 run 中途崩溃，会留下一条 `running` 的孤儿 run 且没有 session 行。M1 没有崩溃恢复
- **DeepSeek Harness 零代码**（D6）
- 主进程 stderr 会出现 SDK 的 `Error handling notification`（未知 `session/update` 种类时）。那是 SDK 里写死的 `console.error`，不可配置。不影响运行，但日志会有噪声

---

## 8. 主会话手工验证真实 Codex 的确切步骤

前置：`~/.local/bin/codex` 已登录（本单没有、也不许碰这件事）。

```bash
cd /Users/yihu/zero/WorkSpace/school-workbench

# 1) 起开发态。dev 脚本现在会先构建 workbench-mcp，再起 electron-vite。
pnpm dev
```

在 Electron 窗口里：

1. 新建一所学校（或点开已有学校），随便提交一条情况并「认同」，让这所学校有真实数据
2. 打开 DevTools（macOS：`Cmd+Opt+I`），在 Console 里跑：

```js
const schools = await window.workbench.schools.list()
const target = schools[0]
console.log('school:', target)

const outcome = await window.workbench.agent.run({
  schoolId: target.id,
  message: '请先读一下这所学校现在的正式状态，再用一句话告诉我你看到了什么。',
})
console.log(outcome)
```

**预期现象**：

- `outcome.status === 'completed'`
- `outcome.runtimeCompatibility === 'verified'`
- `outcome.usedWorkbenchTools === true` ← **这条是 M1 的核心断言**：说明真 Codex 真的调用了 workbench MCP 的只读 tool
- `outcome.message` 里出现这所学校**真实的**名字 / 阶段 / 状态内容，而不是泛泛而谈
- `outcome.failureCode === null`

3. 在启动 `pnpm dev` 的终端里应能看到 `workbench read plane ready`；**不应**看到端口号或令牌

4. 核对数据库落地（`agent_runs` 是否落了正确的态）：

```bash
# userData 目录：macOS 开发态默认是 ~/Library/Application Support/school-workbench
sqlite3 "$HOME/Library/Application Support/school-workbench/school-workbench.sqlite" \
  "SELECT id, status, session_id IS NOT NULL AS has_session, started_at, ended_at FROM agent_runs ORDER BY created_at DESC LIMIT 3;
   SELECT key, transport FROM runtime_profiles;
   SELECT compatibility, protocol_version, agent_name, agent_version FROM agent_sessions ORDER BY created_at DESC LIMIT 3;"
```

预期：最新一行 `agent_runs.status = completed`、`has_session = 1`；`runtime_profiles` 有一行 `codex | acp`；`agent_sessions` 一行 `verified | 1 | @agentclientprotocol/codex-acp | 1.4.0`。

**如果 `usedWorkbenchTools === false`**：先看 `outcome.failureCode`。

- `WORKBENCH_MCP_STARTUP_FAILED` → Codex 报了 MCP 启动失败/取消。先原样重试一次（见 7.2 的冷启动现象）；连续复现才是真问题
- `WORKBENCH_MCP_TOOLS_INVISIBLE` → 注入前的 contract test 就没过，问题在 workbench-mcp 或 loopback，不在 Codex
- `null` 但 `usedWorkbenchTools === false` → Codex 起来了、也没报 MCP 错，但模型没去调 tool。这属于 prompt / 模型行为，不是接线问题

**不要**用 `DISABLE_MCP_CONFIG_FILTERING=true` 排障——那会让 Codex 深合并两套不兼容 schema。

---

## 9. 本单发现的、与既有文档不符的前提

见答卷；主要三条：`DATABASE_SCHEMA.md` §11 并没有给这三张表的字段（只给了 `agent_runs.status` 的 enum 和一句「保持原设计」）；SPEC 26 的正文在 `SPEC.md:784-802` 而非简报所写的 `762-800`；ACP SDK 1.3.0 会把 `ClientCapabilities` 归一化，`fs` / `terminal` 键在线上 payload 里必然存在（值为 `false`），「不广播 = 键不存在」这个说法不成立。

---

## 10. 验收后修复（2026-08-18）

主会话独立复跑并用**真 Codex 跑通了链路**（`usedWorkbenchTools: true`、`runtimeCompatibility: verified`、Codex 真读到 SQLite 返回 `no_snapshot`、落库与预测逐项一致），同时抓到三个第一版没报的缺陷。以下是修复。

### B1（根因）session workspace 的 root 预校验过严

`createSessionWorkspace` 对**临时根目录**也做了双向重叠校验：

```ts
const root = resolve(input.root ?? tmpdir())
assertIsolated(root, input.forbiddenRoots) // ← contains(tmpdir, userDataDir) 为真
```

于是只要工作台数据目录落在 `os.tmpdir()` 之下，所有 agent run 一律被拒。而**本仓库全部 e2e 的 `SWB_E2E_USER_DATA_DIR` 都是 `mkdtemp(resolve(tmpdir(), ...))`**——agent run 路径在整个 e2e 体系里不可达。生产路径（`~/Library/Application Support/…`）不在 tmpdir 下，所以真机上撞不到。

**修法**：把两种校验分开，因为它们要的东西根本不同。

| 校验对象                   | 规则                             | 理由                                             |
| -------------------------- | -------------------------------- | ------------------------------------------------ |
| workspace 根目录（创建前） | 只拒**根目录位于**受保护目录之内 | 这种根目录不可能产出合格的 workspace，早拒早报错 |
| 实际创建出的 cwd           | **双向**都拒（在其内 / 含有它）  | 这才是 L4 真正要守的不变式，原本就正确，一字未改 |

反向那条**必须**允许：一个根目录经常包含受保护目录，而其下的 workspace 与之毫无重叠——tmpdir 包含数据目录正是这种情况。

**L4 不变式未放松**：`workspaceOverlaps()` 被导出，双向都有直接测试；顺手把 `contains()` 里 `!relation.startsWith('..')` 这个会把 `..foo` 这类兄弟目录误判为「不包含」的写法，换成标准的 `relative` + `isAbsolute` 判据（原写法在这个方向上是**放松**而非收紧）。

**顺带修掉的**：`createSessionWorkspace` 原先在 `try` 之外调用，workspace 被拒时异常会**穿透 `AgentHost.run`**（该方法本应永不抛，只返回 outcome）。现已移入 `try`，工作区被拒和其它问题一样记成 failed run。

### B2 那条 e2e 为错误的原因通过

`agent-runtime.ts` 把所有 pre-flight 异常压成同一个 `AGENT_RUNTIME_UNAVAILABLE`，而 B1 的守卫**先行**产出同一个码——于是「no runtime installed」这条 e2e 即使 runtime 发现完全正常也会绿。

**修法**：保留 `AgentHostError` 自己的码。现在缺 runtime → `RUNTIME_NOT_FOUND`，缺 MCP bundle → `WORKBENCH_MCP_NOT_FOUND`，工作区被拒 → `SESSION_WORKSPACE_INVALID`，彼此可区分。

e2e 相应改成断言 `failureCode === 'RUNTIME_NOT_FOUND'` 且 `failureMessage` 含 `SWB_CODEX_ACP_ENTRY`，并显式断言 `!== 'SESSION_WORKSPACE_INVALID'`。

但这条用例走的是 runtime 发现，**在**工作区守卫之前，所以它本身不能证明 B1 已修。为此**新增**一条 e2e：把 `SWB_CODEX_ACP_ENTRY` 指向一个真实存在、但不是 ACP server 的脚本。于是发现成功 → 工作区被创建并通过 → 真实 MCP contract test 对着活的 loopback 跑过 → 最后停在 ACP 握手，`failureCode === 'AGENT_RUN_FAILED'`。**能走到这个码，就等于走过了工作区守卫和 MCP contract test 两关。**

### B3 冷启动误报：一条 run 记录自相矛盾

真 Codex 冷启动那次记录是 `status: failed` / `WORKBENCH_MCP_STARTUP_FAILED`，同时 `usedWorkbenchTools: true`、`message` 里是真读到的数据。

先修掉一个使这件事更糟的 bug：**codex-acp 合成的启动报告本身长得像一次 tool call**（`title = mcp__<名字>__startup`），旧代码把它计入 `toolCallTitles`，而 `usedWorkbenchTools` 用 `title.includes(serverName)` 判断——于是**一次启动失败会把自己算成「用过 workbench tool」的证据**。现在观测器识别出 `mcpStartupServerName` 后只把它记为启动报告，绝不计入 tool call。

再定判据。层②是一份关于「server 是否就绪」的**报告**；层③（经由同一个 server 的 tool call）是同一件事的**直接观测**。两者冲突时以直接观测为准：

```text
报告了启动失败？
  ├─ 本轮有经由 workbench server 的 tool call → 报告与事实矛盾：不失败，但记录 mcpStartupReportedFailure
  └─ 没有                                   → 硬失败 WORKBENCH_MCP_STARTUP_FAILED（不变）
```

**为什么这不会吞掉真失败**：真的没起来的 server 不提供任何 tool，也就拿不出任何可以反驳报告的东西，那条分支一字未改。反驳只认**经由本 server 名**的调用（`isWorkbenchToolCall` 锚定 server 名，且已排除合成的启动报告），所以别的 MCP server 或 shell 调用都不算数——这一条有专门的回归测试。误报也不会被抹掉：`mcpStartupReportedFailure` 照常返回，并写一行诊断。

### 本次改动文件

| 文件                                                | 改了什么                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/agent-host/src/session-workspace.ts`      | B1：拆分 root / cwd 两种校验；导出 `workspaceOverlaps`；收紧 `contains`                                  |
| `packages/agent-host/src/agent-host.ts`             | B1：workspace 创建移入 try；B3：矛盾判据 + `usedWorkbenchTools` / `mcpStartupReportedFailure` 进 outcome |
| `packages/agent-host/src/session-updates.ts`        | B3：合成启动报告不再计入 tool call                                                                       |
| `apps/desktop/src/main/agent-runtime.ts`            | B2：保留 `AgentHostError` 原码；改用 `outcome.usedWorkbenchTools`                                        |
| `packages/agent-host/src/session-workspace.test.ts` | B1 回归（含 e2e 形状与真实默认 root）                                                                    |
| `packages/agent-host/src/agent-host.test.ts`        | B1 + B3 回归                                                                                             |
| `tests/e2e/agent-read-plane-startup.spec.ts`        | B2：断言真实 runtime 发现路径；新增走过守卫的用例                                                        |

验收数字：`pnpm test` **59 files / 268 tests**（+7），`pnpm test:e2e` **11 passed**（+1），typecheck / lint 绿。
