# AI Runtime 接入侦察报告

**类型：只读侦察报告，不是台账，不是任务书**

- 写于：2026-08-17
- 基于提交：`ab08537`（`feat(methodology): add pack review sign-off and activation path`）
- 本机 codex 版本：`codex-cli 0.147.0`（`/Users/yihu/.local/bin/codex` → `~/.codex/packages/standalone/releases/0.147.0-aarch64-apple-darwin/bin/codex`）

**这份报告要回答什么**：在「把真 AI 接进 school-workbench」这一轮动工之前，先确认三件事——(A) SPEC 冻结的 ACP 路线在 Codex 上是否真的走得通、(B) 走不通的退路是什么、(C) 仓库侧从「7 个只读 tool 已建好但没启动」到「一个真 AI 能提交一条通过 `validateAssessmentCandidate` 的候选」之间还差哪些具体件，以及 (D) 每块的复杂度与不确定性来源。全部结论附证据；查不到的显式标注。

---

# A. Codex 能不能被 ACP 驱动？

## A1. 本机 codex 版本与命令面

`codex --version` → `codex-cli 0.147.0`。

顶层子命令（`codex --help`）：

```
exec  review  login  logout  mcp  plugin  mcp-server  app-server  remote-control
app  completion  update  doctor  sandbox  debug  apply  resume  archive  delete
unarchive  fork  cloud  exec-server  features  help
```

关键全局 flag：`-c/--config <key=value>`（点路径覆盖 `~/.codex/config.toml`，值按 TOML 解析）、`--enable/--disable <FEATURE>`、`-m/--model`、`-p/--profile`、`-s/--sandbox {read-only|workspace-write|danger-full-access}`、`--strict-config`、`--remote <ws://|wss://|unix://>`、`--dangerously-bypass-approvals-and-sandbox`。

`codex exec` 关键 flag：`-C/--cd <DIR>`、`--add-dir <DIR>`、`--skip-git-repo-check`、`--ephemeral`、`--ignore-user-config`、`--ignore-rules`、**`--output-schema <FILE>`**、**`--json`**（JSONL 事件流到 stdout）、**`-o/--output-last-message <FILE>`**、`--color`。

`codex app-server`（标注 `[experimental]`）子命令：`daemon` / `proxy` / `generate-ts` / `generate-json-schema`；`--listen <URL>` 支持 `stdio://`（默认）、`unix://`、`ws://IP:PORT`、`off`，另有 `--ws-auth {capability-token|signed-bearer-token}`、`--ws-token-file`、`--ws-token-sha256` 等。

`codex mcp-server` = **把 Codex 自己作为 MCP server 暴露（stdio）**，注意这是「Codex 当被调用方」，与本项目需要的「Codex 当 MCP 客户端」是相反方向，别混淆。

## A2. Codex 原生不支持 ACP —— 但官方社区适配层存在且活跃 ✅

**Codex 本体没有 ACP。** 三条独立证据：

1. 二进制里零 ACP 痕迹：
   ```
   strings <codex bin> | grep -oE "\bacp\b|\bACP\b" | sort | uniq -c   →  （空）
   ```
   同一二进制里 `jsonrpc` 命中 17 次、`tools/call` 命中 15 次，说明 `strings` 抽取正常，不是提取失败。
2. `codex features list` 共 104 条 feature flag，`grep -icE "acp|agent.client"` → `0`。
3. 上游 issue：`openai/codex#2785`（2025-08-27，ACP 支持请求）已关闭且无 OpenAI 维护者回应；`openai/codex#9085`（2026-01-12）被 **closed as not planned**；`openai/codex#16385`（2026-04-01）报的是「ACP 拉起的 session 不出现在 Codex 桌面 app 里」——反证 ACP 是外挂的。

**适配层：`@agentclientprotocol/codex-acp`，就是 SPEC 第 12 章写的 `codex-acp`。** 我独立向 npm registry 核实（未安装）：

| 项       | 值                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 包名     | `@agentclientprotocol/codex-acp`                                                                                        |
| 最新版本 | **1.4.0**，发布于 **2026-08-16**（写这份报告的前一天）                                                                  |
| bin      | `codex-acp` → `dist/index.js`                                                                                           |
| 仓库     | `github.com/agentclientprotocol/codex-acp`                                                                              |
| 依赖     | **`@openai/codex: ^0.147.0`**、`@agentclientprotocol/sdk: ^1.3.0`、`vscode-jsonrpc ^9`、`zod ^4`、`diff ^9`、`open ^11` |
| 许可     | Apache 2.0                                                                                                              |
| 维护节奏 | 1.1.10 → 1.4.0 共 8 个版本发布于 2026-08-06 ~ 08-16（10 天）                                                            |

**关键巧合值得记一笔**：codex-acp 1.4.0 依赖 `@openai/codex@^0.147.0`，与本机已装的 codex 0.147.0 **完全同版本**。

启动方式（README 原文）：

```bash
npx -y @agentclientprotocol/codex-acp
# 或
npm install -g @agentclientprotocol/codex-acp && codex-acp --version
# 指定别的 codex 二进制（默认用它自己 bundle 的那份）
CODEX_PATH=/path/to/codex npx -y @agentclientprotocol/codex-acp
```

README 自述：_"`codex-acp` is a stdio ACP agent server. It starts the Codex App Server, translates ACP requests into Codex operations, and maps Codex events back into the client."_

它的运行时环境变量：`CODEX_API_KEY` / `OPENAI_API_KEY` / `CODEX_PATH` / `CODEX_CONFIG`（JSON，merge 进 session config）/ `MODEL_PROVIDER` / `DEFAULT_AUTH_REQUEST` / `INITIAL_AGENT_MODE`（`read-only|agent|agent-full-access`）/ `NO_BROWSER` / `APP_SERVER_LOGS`。

⚠️ **归属**：这是 `agentclientprotocol` 组织（ACP 生态方，前身 zed-industries）维护的，**不是 OpenAI 出品**。生态还存在 `zed-industries/codex-acp`、`cola-io/codex-acp` 以及一堆 fork（`@automatalabs/codex-acp`、`@melonite/codex-acp`、`@normahq/codex-acp-bridge`），只有 `@agentclientprotocol/codex-acp` 是 Zed 实际在用、且持续发布的那个。

## A3. Codex 的 MCP 客户端能力 —— 两条路，第二条才是我们要的 ⭐

**路 1：静态配置文件（`~/.codex/config.toml`）。** 表名 `[mcp_servers.<name>]`。本机现有配置就是活样本（只读引用 `~/.codex/config.toml:5-24`）：

```toml
[mcp_servers.computer-use]
command = "./Codex Computer Use.app/Contents/SharedSupport/.../SkyComputerUseClient"
args = ["mcp"]
cwd = "."
enabled = false

[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"
args = []
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/yihu/.codex"
NODE_REPL_NODE_PATH = "..."
```

HTTP（streamable）形式（来自官方文档 `https://learn.chatgpt.com/docs/extend/mcp?surface=cli`，由调研 worker 取回）：

```toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

`codex mcp add` 的真实签名（本机 `--help` 实测）：

```
codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)
  --env <KEY=VALUE>              仅 stdio server 可用
  --url <URL>                    streamable HTTP server
  --bearer-token-env-var <ENV>   仅 HTTP server 可用
  --oauth-client-id / --oauth-resource
```

配套：`codex mcp list|get|remove|login|logout`。

**路 2（对本项目决定性）：ACP `session/new` 的 `mcpServers` 会被 codex-acp 逐 session 注入 Codex，不写 config.toml。**

我读了 codex-acp 的源码确认（`agentclientprotocol/codex-acp@main`）：

- `src/CodexAcpServer.ts:312-315` —— initialize 时向 ACP client 广播能力：
  ```ts
  mcpCapabilities: { acp: false, http: true, sse: false }
  ```
  （ACP 规范中 stdio 是所有 Agent 必须支持、无需广播的默认传输）
- `src/CodexAcpServer.ts:533` —— `const requestedMcpServers = request.mcpServers ?? [];`
- `src/CodexAcpClient.ts:587-622` —— `createSessionConfig()` 把它们塞进 session config 的 `"mcp_servers"` 键
- `src/CodexAcpClient.ts:670-689` —— **传输映射的真实实现**：
  ```ts
  private createMcpSeverConfig(mcpServer: McpServer): JsonObject {
      if ("type" in mcpServer) {
          switch (mcpServer.type) {
              case "acp": throw RequestError.invalidRequest("Codex doesn't support MCP ACP transport protocol")
              case "sse": throw RequestError.invalidRequest("Codex doesn't support MCP SSE transport protocol")
              case "http": return { "url": ..., "http_headers": {...} }
          }
      }
      return {
          "command": mcpServer.command,
          "args": mcpServer.args,
          "env": Object.fromEntries(mcpServer.env.map(env => [env.name, env.value])),
      }
  }
  ```

**结论**：Workbench 的 Agent Host 在 `session/new` 里传一条 stdio `McpServer`，`env` 携带 `SWB_ENDPOINT / SWB_TOKEN / SWB_SCHOOL_ID / SWB_AGENT_RUN_ID`，就能让 Codex 在**这一个 run 内**连上 `school-workbench-mcp`，**不需要改用户的 `~/.codex/config.toml`，不需要写全局状态，run 结束即消失**。这与 SPEC 第 16/17 章「Agent Run 创建短期 Token → 注入 MCP Server」的设计完全吻合。

⚠️ 一处需要注意的实现细节：`CodexAcpClient.ts:609-613` 有个 `shouldDeduplicateMcpConflicts()` 开关，其实现（`CodexAcpClient.ts:1252-1255`）为：

```ts
function shouldDeduplicateMcpConflicts(): boolean {
  const disabledByEnv = process.env['DISABLE_MCP_CONFIG_FILTERING'] === 'true'
  return !disabledByEnv
}
```

即**默认开启**。开启时会先读现有 config 的 server 名（含所有 config layer），**同名的会被过滤掉、不配置**（注释：_"Prevents Codex from deep-merging incompatible field types, such as url and stdio schemas."_）。所以 MCP server 名要选一个不可能与顾问全局 `~/.codex/config.toml` 撞车的。

`sanitizeMcpServerName()` 的实现很温和（`src/McpServerName.ts` 全文）：

```ts
const MCP_SERVER_NAME_WHITESPACE = /\p{White_Space}/gu
export function sanitizeMcpServerName(name: string): string {
  return name.replace(MCP_SERVER_NAME_WHITESPACE, '_')
}
```

只把 Unicode 空白替换成 `_`。**只要名字里不含空白就是原样传递**，例如 `school_workbench` 安全。

## A4. Codex 的结构化输出 / 强制工具调用

- **结构化输出：支持。** `codex exec --output-schema <FILE>` —— "Path to a JSON Schema file describing the model's final response shape"（`codex exec --help` 实测）。配合 `-o/--output-last-message <FILE>` 拿最终消息、`--json` 拿 JSONL 事件流。
- **强制工具调用（forced tool choice）：未查证。** `codex --help` / `codex exec --help` 里没有任何 `--tool-choice` / `--require-tool` 类 flag，`codex features list` 的 104 条里也没有对应项。是否能通过 `-c` 覆盖某个配置键实现，**我没有查到，不做推断**。

⚠️ 对本项目的实际意义：**SPEC 第 23 章要求 `diagnosis_propose` 必须是结构化 MCP Tool 提交，不能从回复文本解析。** 所以 `--output-schema` 这条路其实**不是**我们要走的路——它约束的是「最终回复文本的形状」，而我们需要的是「模型调用了 MCP 写面 tool」。真正的强制力来源应该是：MCP tool 的 inputSchema（Zod）+ 服务端 `validateAssessmentCandidate` fail-closed，而不是模型端的输出约束。

## A5. ACP 协议现状（联网查证）

| 项           | 结论                                                                                                                                                                     | 来源                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 仓库         | 已从 `zed-industries/agent-client-protocol` 迁到独立组织 **`agentclientprotocol/agent-client-protocol`**                                                                 | https://github.com/agentclientprotocol/agent-client-protocol                                         |
| 规范站       | https://agentclientprotocol.com                                                                                                                                          | 同上                                                                                                 |
| 稳定协议版本 | **v1**（README：_"The current stable ACP protocol version is `1`."_；`schema/v1/meta.json` 里 `"version": 1`）                                                           | https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/meta.json |
| v2           | **草案**，官方明说 _"ACP v2 is still a draft. Its wire protocol and the TypeScript API may change incompatibly in any SDK release."_                                     | 官方 docs                                                                                            |
| 活跃度       | `schema/v1/CHANGELOG.md` 更新到 **1.20.0 / 2026-07-21**                                                                                                                  | 同仓库                                                                                               |
| 治理         | **查不到**。没找到 governance 文档，没找到捐给基金会的证据（对比：MCP 已于 2025-12-09 进入 Linux Foundation 的 Agentic AI Foundation）。只能说「还在那个 GitHub 组织下」 | —                                                                                                    |

**方法面（直接读 `schema/v1/meta.json`，非记忆）**：

- Agent 方法：`initialize`、`authenticate`、`session/new`、`session/load`、`session/set_mode`、`session/set_config_option`、`session/prompt`、`session/cancel`、`session/list`、`session/delete`、`session/resume`、`session/close`、`logout`
- Client 方法：`session/request_permission`、`session/update`、`fs/write_text_file`、`fs/read_text_file`、`terminal/create`、`terminal/output`、`terminal/release`、`terminal/wait_for_exit`、`terminal/kill`、`elicitation/create`、`elicitation/complete`
- 协议方法：`$/cancel_request`

**SDK**（向 npm / crates.io registry 实查）：

| 包                                      | registry  | 最新      | 说明                                                                                                                                                |
| --------------------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@agentclientprotocol/sdk`**          | npm       | **1.3.0** | 当前正牌 TS SDK；实现 ACP **client**（我们这一侧）用它的 `client()` fluent API。旧的 `AgentSideConnection` / `ClientSideConnection` 类已 deprecated |
| `@zed-industries/agent-client-protocol` | npm       | 0.4.5     | 旧名，npm 页面自己写了已更名，仅向后兼容                                                                                                            |
| `agent-client-protocol`                 | crates.io | 2.0.0     | Rust 核心类型                                                                                                                                       |
| `agent-client-protocol`                 | PyPI      | 0.12.1    | 社区 Python 实现                                                                                                                                    |

**ACP × MCP 的关系（直接读 `schema/v1/schema.json`）**：

- `NewSessionRequest` 的 `"required"` 是 `["cwd", "mcpServers"]` —— **`mcpServers` 是必填字段**（空数组也得给）
- `McpServer` 是按 `"type"` 标签的判别联合：
  - stdio（默认变体，无需 `type` 标签）→ `McpServerStdio`，字段 `name` / `command`（"Absolute path to the MCP server executable"）/ `args` / `env`（`EnvVariable[]`），required 全部四个。规范原文：_**"All Agents MUST support this transport."**_
  - `"type": "http"` → `McpServerHttp`：`name` / `url` / `headers`（`HttpHeader{name,value}[]`）。仅当 agent 广播 `mcp_capabilities.http === true` 时可用
  - `"type": "sse"` → `McpServerSse`：同上，需 `mcp_capabilities.sse`
- 规范文档锚点：https://agentclientprotocol.com/protocol/session-setup#mcp-servers

**哪些 runtime 原生说 ACP**：

- **Gemini CLI**：原生，Google 第一方。flag 早期是 `--experimental-acp`，新版别名 `--acp`（https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md）。⚠️ 本机**未安装**（`command -v gemini` → not found）
- **OpenCode**：原生第一方，`opencode acp` 子命令（https://opencode.ai/docs/acp/）。本机未安装
- **Codex**：**非原生**，靠 `@agentclientprotocol/codex-acp`（见 A2）
- **Claude Code**：**非原生**（`claude --help` 无任何 acp flag）。有 `@agentclientprotocol/claude-agent-acp`（npm 实查 **0.69.0**，bin `claude-agent-acp`），是 Zed 基于 Anthropic 官方 Claude Agent SDK 写的包装，非 Anthropic 出品
- **DeepSeek Harness**：⚠️ 见下节 B，**这是本轮最需要注意的一条**
- Zed 自己的 agent 目录 https://zed.dev/acp 列了 44 个 agent（Goose / Amp / Cursor / GitHub Copilot / Devin / Cline / Kilo / Qwen Code / JetBrains Junie / Grok Build 等），但除上面 4 个外，「原生 vs 适配器」未逐条核实

---

# B. 退路，以及各自与 SPEC 的偏离度

先说结论：**Codex 这条路是通的，A2/A3 已经把它验到源码级，本轮不需要退路。** 但下面这条与 SPEC 的偏差必须先摆到台面上。

## B0. ⚠️ SPEC 第 8/9 章的 DeepSeek Harness 前提需要重新确认

SPEC 第 8 章把「DeepSeek Harness」和「Codex」并列写成 V1 首批 runtime，第 9 章画的链路是 `Agent Host → ACP → DSH ACP → DeepSeek Harness`。实查结果：

- **DeepSeek Harness 本体是真的存在**：https://github.com/deepseek-ai/deepseek-harness（`dsh`，基于 Cordis 的插件架构）
- **但它的 README 完全没提 ACP**（调研 worker 直接抓取核对）
- ACP 能力来自**第三方**：`@openma/deepseek-harness-acp`（我独立向 npm 实查：**最新 0.4.9**，bin `dsh-acp`，仓库 `openma-ai/deepseek-harness-acp`）。README 自述用法：`npm i -g @openma/deepseek-harness-acp` 后跑 `dsh-acp`，或 `dsh plugin --profile acp add`。项目规模很小（约 8 star / 3 fork / 47 commit）
- 另有 crates.io 上的 `deepseek-acp-adapter`（0.6.0，Alpha）、`acp-llm-adapter`（0.7.2），均社区/alpha
- **没有找到任何 deepseek-ai 第一方维护的 ACP 插件**。若干中文/SEO 博客（agenticcontrolplane.com、openclawlaunch.com、deepseekagent.io）把这事写得比一手资料更「官方」，**这些属于未经核实的二手内容**
- **本机 `dsh` / `deepseek` 均未安装**

**对本轮的意义**：SPEC 第 8 章「V1 首批 = DSH + Codex」这条冻结项，DSH 侧站在一个 0.4.x、小规模、第三方的适配器上；Codex 侧站在一个 1.4.0、10 天 8 个版本、ACP 组织自己维护、且正好锁 codex 0.147.0 的适配器上。**两条腿的成熟度差一个数量级。** 建议本轮只做 Codex，DSH 作为第二 runtime 推后——这不违反 SPEC（SPEC 说的是「进 V1 必须满足 ACP+MCP」，没说必须同时上线），但**改变了两者的落地顺序，属于需要人确认的事项，不是我能替你定的**。

## B1. 各退路方案（若 Codex 路真的塌了）

| 方案                                        | 驱动方式                                                                                                                                           | MCP 支持                                                           | 与 SPEC 偏离度                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gemini CLI + 原生 ACP**                   | `gemini --acp`（stdio ACP server）                                                                                                                 | ACP `session/new` 原生带 `mcpServers`                              | **零协议偏离**（ACP + MCP 都满足）。偏离点只在 SPEC 第 8 章的「首批 = DSH + Codex」名单，需要改名单。本机未装                                                                            |
| **OpenCode + 原生 ACP**                     | `opencode acp`                                                                                                                                     | 同上                                                               | 同上，零协议偏离，改名单即可。本机未装                                                                                                                                                   |
| **Claude Code + `claude-agent-acp` 适配器** | `claude-agent-acp`（0.69.0）                                                                                                                       | 走 ACP `mcpServers`                                                | 零协议偏离，改名单。本机已装 claude 2.1.233，但适配器未装                                                                                                                                |
| **Claude Code 裸 CLI（不走 ACP）**          | `claude -p --input-format stream-json --output-format stream-json --mcp-config <file> --strict-mcp-config`（本机 `claude --help` 实测有这些 flag） | 有，`--mcp-config` + `--strict-mcp-config`（只用指定的，忽略全局） | **严重偏离**：绕开 ACP，Agent Host 变成 Claude 私有 stream-json 协议的宿主，直接违反 SPEC 第 3、7、8 章。而且 SPEC 第 64 章「Workbench 不依赖 Codex 内部私有结构」的同类原则在这里被打破 |
| **cursor-agent 裸 CLI**                     | `cursor-agent -p --output-format stream-json`（本机 2026.07.09-a3815c0 实测），`--approve-mcps`                                                    | 有 `cursor-agent mcp`                                              | 同上，严重偏离                                                                                                                                                                           |
| **Codex `app-server`（不走 codex-acp）**    | `codex app-server --listen stdio://`，用 `codex app-server generate-ts` 生成 TS 绑定                                                               | 走 Codex session config 的 `mcp_servers`                           | **中度偏离 + 明确违反 SPEC 第 64 章**（"Workbench 不依赖 Codex 内部 Session / DB / **App Server** 私有结构"）。而且 app-server 自带 `[experimental]` 标记                                |
| **Codex `exec` 一次性调用**                 | `codex exec --json --output-schema ... -c mcp_servers.xxx=...`                                                                                     | 靠 `-c` 覆盖注入                                                   | **严重偏离**：没有 session、没有 permission、没有 cancel，SPEC 第 7 章的 Agent Host 生命周期只剩一半                                                                                     |

**推荐顺位**：Codex + codex-acp（首选，已验证）→ Gemini CLI 或 OpenCode 原生 ACP（若 codex-acp 出事，换 runtime 比换协议便宜得多）→ 其余都要先改 SPEC。

---

# C. 仓库侧还差什么

## C1. 现有只读面怎么工作，在 Electron 里启动还差哪几步

**传输与链路**（SPEC 第 14/15/16 章）：

```
Agent Runtime
  ↓ MCP stdio（@modelcontextprotocol/server 2.0.0，serveStdio）
school-workbench-mcp（独立子进程，不碰 SQLite）
  ↓ HTTP POST 127.0.0.1:<random>/internal/v1/<capability>，Bearer token
WorkbenchLoopbackReadPlane（Fastify）
  ↓
WorkbenchReadCapabilityService
  ↓
SqliteReadPlaneRepository → SQLite
```

**启动**：`packages/workbench-read-plane/src/loopback.ts:142-157`

```ts
async start(): Promise<string> {
  await this.#server.listen({ host: '127.0.0.1', port: 0 })   // OS 随机端口
  // 硬断言：地址不是 127.0.0.1 就 close 并 throw
  this.#endpoint = `http://127.0.0.1:${info.port}/internal/v1`
}
```

工厂：`createWorkbenchReadPlaneBootstrap(service, {tokenStore?, safeLog?})`（`loopback.ts:181-189`）。构造 `WorkbenchReadCapabilityService` 需要三个依赖（`service.ts:107-112`）：`ReadPlaneRepository`、`MethodologyRegistry`（file registry）、`MethodologyRepository`。

**能力令牌怎么发**：`loopback.ts:165-178` 的 `issueToken({schoolId, agentRunId, scopes, ttlMs?})` → `CapabilityTokenStore.issue()`（`auth.ts:88-122`）：

- 令牌 = `randomBytes(32).toString('base64url')`，**只存 SHA-256 摘要**（`auth.ts:53-55, 120`），进程重启即全失效
- 默认 TTL 5 分钟，上限 15 分钟（`auth.ts:50-51`），小于 1 秒或超上限直接 throw
- scope 必须来自冻结的 6 个只读 scope（`auth.ts:101-103`）：`school.read / stage.read / state.read / evidence.read / diagnosis.read / standards.read`。**注意：SPEC 第 17 章允许的 `evidence.register` / `diagnosis.propose` / `feishu.ensure_ready` 目前会被这里直接拒绝**（`READ_SCOPE_SET` 只含 6 个 read scope）
- 鉴权三重绑定（`auth.ts:131-155`）：scope + `agentRunId` + `schoolId` 全部要对，任何一条不符各自报 `AUTH_SCOPE_DENIED` / `AUTH_RUN_MISMATCH` / `AUTH_SCHOOL_MISMATCH`
- HTTP 侧强制 `x-swb-school-id` + `x-swb-agent-run-id` 两个 header（`loopback.ts:103-110`），query string 一律拒（`loopback.ts:115-120`）

**MCP 子进程的引导契约**：`packages/workbench-mcp/src/stdio.ts:15, 96-108` —— 四个环境变量，全部 fail-closed：

```
SWB_ENDPOINT      必须是 http://127.0.0.1:<port>/internal/v1，
                  协议/主机/端口/无 user/pass/无 query/无 hash/路径精确匹配（stdio.ts:68-94）
SWB_TOKEN         必须匹配 /^[A-Za-z0-9_-]{32,512}$/
SWB_SCHOOL_ID     ≤160 字符
SWB_AGENT_RUN_ID  ≤160 字符
```

引导失败时 `process.stderr.write('workbench-mcp bootstrap failed: ENV_INVALID\n')` + `exitCode = 1`，**且绝不启动 server**（`stdio.ts:273-300`）。stdout 只走协议，诊断只走 stderr。

**要在 Electron 里启动它，还差这几步**（当前 `apps/desktop/src/main/index.ts` 123 行里一个都没有）：

1. `apps/desktop/package.json` 的 `dependencies` **既没有 `@school-workbench/workbench-read-plane` 也没有 `@school-workbench/workbench-mcp`** —— 先补 workspace 依赖
2. 在 `app.whenReady()` 里 new 一个 `SqliteReadPlaneRepository(database)`（构造签名 `sqlite-read-plane-repository.ts:84`，吃 `WorkbenchDatabase` 整体，不是 `.db`）
3. 拿到 `MethodologyRegistry` + `MethodologyRepository`。⚠️ **现在拿不到**：`methodology-runtime.ts:73-84` 把 `registry` 和 `methodologyRepository` 都关在闭包里，只把 `MethodologyReviewService` 暴露出来。要么改 `MethodologyRuntime` 的返回类型多暴露两个字段，要么在 index.ts 里再造一份（不可取，会重复 `syncRegistry`）
4. `createWorkbenchReadPlaneBootstrap(service)` → `await plane.start()` 拿 endpoint。⚠️ 注意 methodology runtime 是**故意异步且允许失败**的（`index.ts:93-97` 的设计注释：任何失败都静默降级），read plane 的启动时机必须尊重这个约束，不能把 methodology 失败变成 read plane 启不来
5. 生命周期：`before-quit` 里 `await plane.stop()`（现在只有 `closeDatabase()`）
6. MCP 子进程的可执行路径：`packages/workbench-mcp/package.json` 的 bin 指向 `./dist/stdio.js`，由 esbuild bundle 生成。根 `package.json` 的 `build` 脚本已经先构建 workbench-mcp 再构建 desktop ✅，但 **`dev` 脚本（`electron-vite dev`）不构建它** —— 开发态跑 Agent 会找不到 dist
7. 打包路径解析：Electron 打包后 `dist/stdio.js` 在哪，需要一套类似 `resolveMethodologyPaths()` 的 bundled/repository 双路径回退

## C2. 一条能通过校验的判断候选，最小必需字段集

校验入口：`validateAssessmentCandidate(rawInput, rawCandidate, registry)`（`packages/assessment/src/validator.ts:141`）。它分两段：先 `buildAssessmentContext(rawInput, registry)`（`context.ts:141`）验 Input，再验 Candidate 并做交叉引用检查。

### 前置：两道「先于 schema」的红线

`context.ts:83-109` 与 `validator.ts:65-91` 在跑 Zod 之前先做递归键名扫描（`errors.ts:93-116`，键名归一化 = 去掉 `_`/`-` 后转小写），**Input 和 Candidate 两边都查**：

- **禁止数值评分类键**（`errors.ts:62-79`）：`score/scores/weight/weights/rating/ratings/rank/ranking/schoolRank/compositeScore/overallScore/numericScore/numericalScore/aggregateLevel/overallLevel/compositeLevel` → `ASSESSMENT_NUMERIC_SCORING_FORBIDDEN`
- **禁止隐藏推理类键**（`errors.ts:81-87`）：`chainOfThought/reasoningTrace/hiddenReasoning/scratchpad/privateReasoning` → `ASSESSMENT_HIDDEN_REASONING_FORBIDDEN`

另外 `context.ts:69-80, 111-122`：`observationFacts` 数组里任何一条 `kind === 'interpretation'` 直接 `ASSESSMENT_FACT_INTERPRETATION_CONFUSION`。

**这三条对 MCP 写面的 tool 描述有直接约束**：如果 tool description 或 inputSchema 里出现「打分」「置信度分数」措辞，模型很容易生成一个 `score` 字段然后被 fail-closed 打回。

### AssessmentInput 必填结构（`contracts.ts:100-112`，`.strict()` —— 多一个字段就 fail）

```
protocolVersion       字面量 1
school                { kind: 'school', schoolId }
activeStage           { id, schoolId, title, status: 'active' }
confirmedStageTargets 数组，min(1)，每条 { id, stageId, schoolId,
                        dimensionKey ∈ leadership|key_tasks|structure|culture|capability,
                        title, description, status: 'confirmed' }
evidence              数组（可空），每条 { kind:'evidence', id, schoolId,
                        sourceType ∈ feishu_doc|feishu_minutes|audio|local_file|observation|pasted_text|other,
                        title, uri: string|null, inlineText: string|null,
                        locator: string|null, capturedAt: string|null }
                        —— uri/inlineText/locator/capturedAt 四个是 nullable 但【必须出现】
observationFacts      数组（可空），每条 { kind:'observation_fact', id, schoolId, evidenceId,
                        factType ∈ learner|adult_practice|organization|context,
                        text, locator（非空，必填）, directness ∈ low|medium|high }
claims                数组（可空），每条 { kind:'claim', id, schoolId, statement,
                        predicateKey, scope: { kind:'school', schoolId } }
claimFacts            数组（可空），每条 { claimId, factId, stance ∈ supporting|counter }
methodologyContext    数组（可空），每条 { packKey, version, criterionId }
```

长度约束：id ≤200；shortText 1~~1000；longText 1~~20000（`contracts.ts:4-6`）。

Input 的交叉校验（`context.ts:152-352`）：所有 id 去重；`activeStage.schoolId` / 每条 target/evidence/fact/claim 的 `schoolId` 及 `claim.scope.schoolId` 必须 === `school.schoolId`；每条 target 的 `stageId` 必须 === `activeStage.id`；每条 fact 的 `evidenceId` 必须在 `evidence` 里；每条 claimFact 的 `claimId`/`factId` 必须都在；`methodologyContext` 每条必须 `registry.getPack()` 找得到 **且 `status === 'active'` 且 criterion 存在**。

### AssessmentCandidate 必填结构（`contracts.ts:149-171`，同样 `.strict()`）

```
protocolVersion         字面量 1
school                  { kind:'school', schoolId }
claimRefs               string[]
criterionMappings       [{ packKey, version, criterionId, reason(1~500) }]
stageTargetRefs         string[]
supportingFactRefs      string[]
counterFactRefs         string[]
counterEvidenceSearch   { completed: boolean, summary(1~700),
                          searchedEvidenceRefs: string[], searchedFactRefs: string[] }
interpretations         [{ kind:'interpretation', id, summary(1~700), factRefs: string[] }]
provisionalJudgment     string(1~1000) | null
mechanism               string(1~1000) | null
alternativeHypotheses   string[]（每条 1~700）
unresolvedQuestions     string[]
recommendedActions      string[]
nextObservations        string[]
impactEvidencePlan      string[]
evidenceQuality         { directness ∈ low|medium|high,
                          triangulation ∈ single_source|multiple_sources,
                          limitations: string[] }
confidence              low|medium|high
status                  proposed | insufficient_evidence
```

**全部 19 个字段都是必填**（数组可以是 `[]`，两个可空字段必须显式给 `null`，但键不能缺）。

### `status: 'proposed'` 时额外的 12 道门（`validator.ts:385-506`）

1. `resolvedMethodology.length > 0` **且** 选中 Claim 上至少有一条 supporting stance 的 fact，否则 `ASSESSMENT_ABSTENTION_REQUIRED`
2. `claimRefs.length ≥ 1`
3. `criterionMappings.length ≥ 1`
4. `stageTargetRefs.length ≥ 1`
5. `supportingFactRefs.length ≥ 1`
6. `provisionalJudgment` 非空
7. `counterEvidenceSearch.completed === true`
8. `completed` 时 `searchedEvidenceRefs` 与 `searchedFactRefs` **不能同时为空**
9. `alternativeHypotheses.length ≥ 1`
10. **选中 Claim 上所有 counter stance 的 fact 必须全部出现在 `counterFactRefs`** —— 漏一条就 `ASSESSMENT_COUNTER_FACT_OMITTED`（这是最容易被 AI 踩的一条：模型倾向于只报支持自己的证据）
11. `completed` 时，所有已知 counter fact 必须全部出现在 `searchedFactRefs`
12. 交叉引用：`supportingFactRefs` 的每条必须在 Input 的 facts 里，**且必须在 claimFacts 里以 `supporting` stance 挂在某条被选中的 Claim 上**（否则 `ASSESSMENT_FACT_STANCE_MISMATCH`）；counter 侧同理；把 interpretation id 塞进 factRef 位置会被专门识别为 `ASSESSMENT_FACT_INTERPRETATION_CONFUSION`；`criterionMappings` 的每条必须与 `methodologyContext` **精确同键**（`packKey@version#criterionId`）才行（`ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT`）

`status: 'insufficient_evidence'` 时反过来（`validator.ts:507-526`）：`provisionalJudgment` **必须是 null**，且 `unresolvedQuestions` 与 `nextObservations` 都不能为空。

### 现成的最小可用样例

`packages/assessment/golden/v1/cases.ts:19-133` 的 `baseInput()` / `baseCandidate()` 就是一对能通过的最小样本：1 个 stage + 1 个 target + 1 条 evidence + 1 条 fact + 1 条 claim + 1 条 supporting claimFact + 1 条 criterionRef（`schooling-by-design@1#SBD.C4.SYSTEM_ALIGNMENT` 或 `data-wise@3#DW.C2.PRACTICE_VISIBILITY`）。**做 Agent bootstrap prompt 和写面 tool 的 example 时应该直接照抄这个形状。**

### ⭐ 已经存在的 AI 接入插座

`packages/assessment/src/golden.ts:49-52, 124-144` —— 这个接口是上一轮**专门为真 AI 留的**：

```ts
export interface AssessmentRuntimeAdapter {
  readonly id: string
  createCandidate(input: unknown): unknown | Promise<unknown>
}

export async function runGoldenCaseWithAdapter(
  goldenCase,
  registry,
  adapter,
): Promise<GoldenCaseResult> // 失败自动归类为 ASSESSMENT_RUNTIME_ADAPTER_ERROR
```

**意味着「真 AI 能不能产出合格候选」这件事，可以在不启动 Electron、不接 ACP 的情况下先单独验证**（把 codex-acp 包成一个 `AssessmentRuntimeAdapter` 跑 golden 套件）。这应该是本轮的第一个可验证里程碑，而不是最后一个。

## C3. 两个写面 tool 落地时接什么

### `diagnosis_propose` —— 后端**已经全部就绪** ✅

现成可复用的链条：

```
GroundedDiagnosisService.create({ schoolId, type, title,
                                  rawAssessmentInput, rawAssessmentCandidate })
  → validateAssessmentCandidate(...)                     application/src/grounded-diagnosis-service.ts:130
  → 二次断言 validated.input.school.schoolId === schoolId  :137-145
  → createGroundedDiagnosisProposal(...)  [domain]        :148-166
  → criterionProjection() 逐条重解析 pack（再次要求 active）:71-120, 168-170
  → repository.saveGroundedProposal(...)                  :172-177
```

实现：`packages/db/src/sqlite-grounded-diagnosis-repository.ts:325`（`SqliteGroundedDiagnosisRepository(database: BetterSQLite3Database)`，事务写入）。错误类型 `GroundedDiagnosisProtocolError` 携带 `errors: AssessmentProtocolError[]`（含 34 个稳定错误码，`assessment/src/errors.ts:3-39`）。

**写面 tool 基本上只需要**：新增 `diagnosis.propose` scope → loopback 加一条 POST 路由 → service 方法转调 `GroundedDiagnosisService.create` → MCP 侧注册 tool（inputSchema 用 `assessmentCandidateSchema` 派生）。**没有新 domain 逻辑要写。**

⚠️ 但有两处必须动的地方：

- `packages/workbench-read-plane/src/auth.ts:49, 101-103` 的 `READ_SCOPE_SET` 只认 6 个 read scope，写 scope 会被 `issue()` 直接 throw
- `loopback.ts:37` 的 `statusFor()` 与 `ReadPlaneApiErrorCode` 联合类型没有涵盖 assessment 协议错误，需要扩展错误映射（34 个 `ASSESSMENT_*` 码要么透传要么折叠）
- `GroundedDiagnosisService` **当前完全没有在 Electron main 里被实例化**（`apps/desktop/src/main/index.ts` 只 new 了 School/Judgment/Stage/State 四个 service）

### `evidence_register` —— 后端**没有现成 service** ❌

- 表结构齐了：`packages/db/src/schema.ts:18-33` 的 `evidence` 表已有 `sourceType / uri / inlineText / title / locatorJson / contentHash / capturedAt / registeredBy / **agentRunId** / createdAt`。`observation_facts` 表同样已有 `extractedBy` + `agentRunId`（`schema.ts:35-50`）。**Agent 归属字段是预留好的。**
- 但**没有 EvidenceService**。唯一的 evidence 写入路径埋在 `packages/db/src/sqlite-judgment-repository.ts` 的 `saveProposalChain()` 里，是 `JudgmentService.submitSituation()` 顺手整链写的（`application/src/judgment-service.ts:95-104` → `createProposalChain`），**不能单独注册一条 Evidence**
- SPEC 第 22 章要求 `evidence_register` 的 Domain Service 做四件事：**校验学校 / 去重 / 建立来源 / 生成 Evidence ID**。其中「去重」需要用 `contentHash`（列已有，但当前没有任何代码在算它，也没有唯一索引）
- 结论：**`evidence_register` 需要新建一个 Domain/Application service + 一条迁移（contentHash 去重约束），是本轮唯一需要新写 domain 逻辑的写面**

## C4. SPEC 第 39 / 61 章 —— AgentRun 状态机要求

**第 61 章**（SPEC.md:1528-1556）冻结六态：

```
queued  running  needs_input  completed  failed  cancelled
```

**第 39 章**（SPEC.md:1062-1084）加了一条硬约束：

> **SQLite Schema 不增加新的状态。**

`needs_input` 一个状态覆盖三类等待：飞书授权、Agent 需要顾问补信息、其他人机外部动作。**具体原因不进数据库 enum**，由 Experience Layer 表达（例如 `external_authorization` + `provider = feishu`）。

关联的第 62 章：Runtime 兼容性判定为 `Verified / Compatible / Unsupported`，判据是 `ACP initialize + Required capability + Contract test`，**明确要求「不依赖硬编码版本」**。第 64 章：`codex-acp` 负责 ACP 边界，Workbench 不依赖 Codex 内部 Session/DB/App Server 私有结构。

**⚠️ 落地缺口**：`docs/data/DATABASE_SCHEMA.md:295-303` 写了 `runtime_profiles / agent_sessions / agent_runs` 三张表并给了 status enum，但 **`packages/db/src/schema.ts` 里这三张表一张都没有**（现有 17 张表：schools / evidence / observation_facts / claims / claim_facts / diagnosis_proposals / diagnosis_claims / human_reviews / accepted_judgments / judgment_claims / stages / stage_targets / stage_judgments / state_snapshots / dimension_assessments / assessment_judgments / snapshot_judgments）。而 `evidence.agent_run_id` / `observation_facts.agent_run_id` 已经是**指向不存在的表的悬空外键语义**（没有 FK 约束，只是文本列）。

`packages/db/` 目录下也没有 `runtime_profiles` / `agent_sessions` / `agent_runs` 的任何迁移。`packages/agent-host/` 包不存在（SPEC 第 65 章的目标结构里有）；根目录 `runtimes/dsh/` 与 `runtimes/codex/` 也不存在。

---

# D. 工作量与风险（复杂度 + 不确定性来源，不给时间估计）

## D0. 基线

- 当前测试：`pnpm vitest run packages/workbench-read-plane packages/workbench-mcp packages/assessment` → **6 files / 44 tests 全绿**，1.15s
- ⚠️ 本机 Node 是 **v26.3.1**，仓库 `engines` 要求 **24.x**，pnpm 已经在 warn（`[WARN] Unsupported engine`）。Electron 43 + better-sqlite3 13 的 native 模块在 Node 26 下的行为**未验证**

## D1. MCP loopback 在 Electron 里启动

**要动的文件**：`apps/desktop/package.json`（加 2 个 workspace 依赖）、`apps/desktop/src/main/index.ts`、`apps/desktop/src/main/methodology-runtime.ts`（暴露 registry + repository）、可能新增 `apps/desktop/src/main/read-plane-runtime.ts`。

**规模**：小。~100 行主进程接线 + 1 处既有模块的返回类型扩展。

**最大风险点**：**methodology runtime 的「允许失败」语义与 read plane 的「必须可用」语义冲突**。现在 methodology 失败是静默降级（`index.ts:90-97` 的注释是明确的设计意图），但 `WorkbenchReadCapabilityService` 把 registry 当构造参数强依赖。如果直接把 read plane 挂在 methodology promise 后面，methodology 一挂 Agent 功能全挂；如果不挂，`standards_get` 就没法工作。**这个取舍需要先定，属于设计决策不是实现细节。**

**不确定性来源**：打包后 `workbench-mcp/dist/stdio.js` 的路径解析（asar 内 vs 外）；`electron-vite dev` 不构建 mcp 包。

## D2. MCP 写面（`evidence_register` + `diagnosis_propose`）

**要动的文件**：`packages/workbench-read-plane/src/{contracts,auth,service,loopback}.ts`（4 个都要改：加 capability 名、加 write scope、加输入 schema、加路由与错误映射）、`packages/workbench-mcp/src/stdio.ts`（注册 2 个 tool，且这两个的 annotations 必须是非 readOnly——现在 `READ_ONLY_ANNOTATIONS` 是写死的常量给全部 7 个 tool 用，`stdio.ts:32-37`）、`packages/application/`（新建 EvidenceService）、`packages/db/`（EvidenceRepository + 一条 contentHash 去重迁移）、`apps/desktop/src/main/index.ts`（实例化 GroundedDiagnosisService）。

**规模**：`diagnosis_propose` 中等偏小（后端全有，主要是接线 + 错误映射）；`evidence_register` 中等（要新写 service + 迁移）。

**最大风险点**：

1. **错误面的爆炸**。`validateAssessmentCandidate` 会吐 34 种 `ASSESSMENT_*` 码，而 loopback 现有的错误信封只有 5 个 `ReadPlaneErrorCode` + 7 个 `CapabilityAuthErrorCode`（`contracts.ts:117-118`、`auth.ts:4-12`）。设计上要决定：**把结构化 errors 数组原样返给 Agent（让它自我纠正）还是折叠成一个码（保护信息面）**。前者对模型迭代友好，后者对 SPEC 第 24 章「不能用额外布尔位或宽松 DTO 绕过 validation gate」的精神更安全。**这是判断题，不是实现题。**
2. **写 scope 一旦引入，`READ_SCOPE_SET` 的白名单就不再是「只读」的保证。** 当前 `auth.ts:101-103` 这行是最后一道结构性防线（「Only frozen read scopes can be issued in this slice」）。放开它之后，SPEC 第 25 章禁止的 `diagnosis_accept / diagnosis_reject / state_commit / stage_activate` 就只靠「没写这些 tool」在挡，而不是靠类型系统。**建议把禁止清单做成一个显式的 negative 常量 + 测试，而不是靠「没实现」。**
3. `evidence_register` 的去重语义：contentHash 怎么算（inlineText 的规范化？uri 的规范化？）SPEC 没写，**需要先定契约**。

## D3. Agent Host

**要动的文件**：新建 `packages/agent-host/`（SPEC 第 65 章已给名字）；`packages/db/src/schema.ts` + 迁移（`runtime_profiles` / `agent_sessions` / `agent_runs` 三张表，六态 enum）；`apps/desktop/src/main/index.ts` + 新 IPC 模块；`apps/desktop/src/preload/index.ts`。

**规模**：**本轮最大的一块。** ACP client 要实现 11 个 client-side 方法（`session/update`、`session/request_permission`、`fs/read_text_file`、`fs/write_text_file`、`terminal/*` 5 个、`elicitation/*` 2 个），加 runtime discovery / spawn / 生命周期 / 六态状态机 / 三张新表 / IPC。

**最大风险点**：

1. **`session/update` 是流式的、事件形状极多。** codex-acp README 列的事件种类：shell command、file change、permission request、MCP tool call、terminal output、reasoning、plan、web search、image generation、image view、token usage、review、subagent。**Agent Host 必须对未知事件类型 fail-open（忽略并继续）而不是 fail-closed**，否则 codex-acp 每次发版都可能打挂 Workbench——这直接关系到 SPEC 第 64 章「Codex 独立升级」能不能成立。
2. **`fs/*` 与 `terminal/*` 是 client 侧方法，意味着 Agent 可以要求 Workbench 读写文件和开终端。** SPEC 第 7 章说 Agent Host「不放任何学校业务逻辑」，但没说这些能力给不给。**给了就等于 Agent 有了 MCP 之外的第二条访问路径，与 SPEC 第 13 章「Workbench MCP 是 Agent 访问 Workbench Domain 的唯一正式接口」直接张力。** 建议：`fs/*` 严格限制在 run 的 cwd 沙箱内且不含 Workbench 数据目录；`terminal/*` 保留（SPEC 第 27 章要求 Agent 通过 shell 调 `lark-cli`，那正是 terminal 能力）。**这条必须先想清楚再写代码。**
3. **`session/new` 的 `cwd` 给什么？** ACP 规范里 `cwd` 是必填。Workbench 是 local-first 桌面应用，没有「项目目录」概念。给用户数据目录会让 Agent 能读 SQLite（违反 SPEC 第 5 章「Renderer 不访问 SQLite」的同源精神），给临时目录则 `lark-cli` 的工作区语义要另外安排。**未解决的设计问题。**
4. **SPEC 第 62 章要求兼容性判定走 contract test 而非硬编码版本**，这意味着 Agent Host 要自带一套针对 runtime 的启动期契约探测。

**不确定性来源**：`@agentclientprotocol/sdk` 1.3.0 的 `client()` fluent API 我**没有实读过**（只从 README 摘要看到旧类已 deprecated）；ACP v2 是草案且官方警告「任何 SDK 版本都可能不兼容变更」，需要在 package.json 里**精确 pin 而不是 caret**。

## D4. Codex 接入

**要动的文件**：`packages/agent-host/` 的 runtime 注册表；可能新增 `runtimes/codex/`（SPEC 第 65 章结构）；打包配置。

**规模**：中等偏小 —— **前提是 D3 的 ACP client 做对了**。codex-acp 已经把最难的部分（Codex App Server 协议翻译）做完了，Workbench 侧只需要：spawn `codex-acp`、`initialize`、`session/new` 带上 stdio MCP 描述符。

**MCP 注入的具体形状**（源码级已验证，见 A3）：

```jsonc
// ACP session/new 的 mcpServers 里放一条：
{
  "name": "school_workbench", // 会过 sanitizeMcpServerName()
  "command": "<绝对路径>/node", // 规范要求 absolute path
  "args": ["<绝对路径>/workbench-mcp/dist/stdio.js"],
  "env": [
    { "name": "SWB_ENDPOINT", "value": "http://127.0.0.1:<port>/internal/v1" },
    { "name": "SWB_TOKEN", "value": "<32~512 字符 base64url>" },
    { "name": "SWB_SCHOOL_ID", "value": "<schoolId>" },
    { "name": "SWB_AGENT_RUN_ID", "value": "<agentRunId>" },
  ],
}
```

**最大风险点**：

1. **依赖链是三层第三方叠加**：`codex-acp@1.4.0` → `@openai/codex@^0.147.0` → OpenAI 后端。codex-acp 10 天发了 8 个版本，**必须 pin 精确版本并做升级契约测试**，否则 SPEC 第 64 章的「独立升级」会变成「随机爆炸」。
2. **`shouldDeduplicateMcpConflicts()` 的同名跳过逻辑默认开启**（`CodexAcpClient.ts:609-613` + `:1252-1255`，默认 true）：如果顾问的 `~/.codex/config.toml`（或任何 config layer）里恰好有同名 server，我们的注入会被**静默过滤掉**，表现为「Agent 看不到 workbench tool」且没有明显报错。**server 名必须选一个极不可能撞车的**，并且 Agent Host 必须在 `session/new` 之后主动验证 tool 列表（codex-acp 侧有 `awaitMcpServerStartup(serverNames, afterVersion)` 机制可借鉴）。逃生阀是给子进程设 `DISABLE_MCP_CONFIG_FILTERING=true`，但那会让 Codex 去深合并两套不兼容 schema，不推荐。
3. **认证是用户级的，不是应用级的。** codex-acp 支持 ChatGPT login / `CODEX_API_KEY` / `OPENAI_API_KEY` / 自定义 gateway。顾问的 Codex 已登录（SPEC 第 12 章「优先使用顾问现有 System Codex」），但 `CODEX_PATH` 不设时 codex-acp 用**它自己 bundle 的那份 codex**，凭据是否共享（`CODEX_HOME`）需要实测。**未验证。**
4. **npm 依赖引入方式**：把 codex-acp 作为 Workbench 的 npm 依赖打进包（体积 + 版本锁），还是 `npx -y` 运行时拉（需要网络 + 不可复现），还是要求顾问预装。**三选一没有明显最优解**，且直接影响 SPEC 第 62 章的 runtime discovery 怎么写。

## D5. 进度 UI

**要动的文件**：`packages/experience/`（新组件）、`apps/desktop/src/renderer/features/`（新页面/面板）、preload + IPC。

**规模**：中等。

**最大风险点**：`ADR-003-ui-system.md:63` 明确要求「**默认不展示 ACP、MCP、Runtime、Token、数据库或内部状态名**」，而 SPEC 第 39/61 章的六态里 `needs_input` 的**具体原因不进数据库**、必须由 Experience Layer 表达。这意味着进度 UI 不能简单地把 `agent_runs.status` 映射成文案，需要 Experience 层自己维护一份 transient 的原因状态。**这是「零维护 UX」原则与「状态机在数据库」之间的接缝，容易做成两边都存一份的第三副本。**

**不确定性来源**：codex-acp 的 `session/update` 事件粒度很细（reasoning / plan / token usage / subagent），**哪些该给顾问看、哪些该丢掉，是产品判断不是工程判断**。SPEC 第 26 章的 Agent Bootstrap 措辞暗示顾问看到的应该是「工作台语言」而非「Agent 语言」。

## D6. 设置里选默认助手

**要动的文件**：`apps/desktop/src/renderer/features/settings/settings-page.tsx`（**占位已经在了**：第 24-33 行的「AI 助手 / 将在后续 Runtime 阶段接入 / 尚未启用」）、新增 settings 持久化（当前没有任何 settings 存储机制）、`runtime_profiles` 表。

**规模**：小 —— 但**依赖 D3 的 runtime 注册表和 D4 的 discovery 先存在**。

**最大风险点**：当前**仓库里没有任何用户偏好持久化设施**（没有 settings 表、没有 electron-store、没有 config 文件读写）。「选默认助手」会顺带引入第一套 settings 存储，**这个决定的影响面比这个功能本身大**（以后所有偏好都会往这里堆）。

## D7. 建议的落地顺序（基于「可验证性」而非「依赖顺序」）

1. **先做 C2 提到的 `AssessmentRuntimeAdapter` 探针** —— 把 codex-acp 包成 adapter 跑 golden 套件。不动 Electron、不动 schema、可完全丢弃。**这一步就能证伪「真 AI 能不能产出合格候选」这个最大的未知数**，而且失败成本接近零。
2. D1（loopback 启动）—— 让只读面在真 Electron 里活起来，可用现有 44 个测试兜底。
3. D3 的最小骨架 + D4 —— 只做 `initialize` + `session/new` + `session/prompt` + `session/cancel`，`fs/*` 和 `terminal/*` 先一律拒绝（ACP 允许 client 不广播这些能力），跑通「Codex 能读到 school_context」。
4. D2 的 `diagnosis_propose`（后端全有）→ D2 的 `evidence_register`（要新写）。
5. D5 / D6。

---

# 未验证 / 需要进一步确认的事项

## 我明确查不到的

1. **Codex 的强制工具调用（forced tool choice）**：`--help` 和 104 条 feature flag 里都没有。是否能通过 `-c` 覆盖实现——**查不到，不推断**。
2. **ACP 的治理归属**：`agentclientprotocol` GitHub 组织的实际所有方（是否仍是 Zed 员工、是否独立法人）——**没找到 governance 文档**。PyPI 上的 Python 实现描述仍写 "by Zed Industries"。
3. **`@agentclientprotocol/sdk` 1.3.0 的 client 侧 API 细节**：我只从 README 摘要知道 `client()` fluent API 取代了 `ClientSideConnection`，**没有实读源码或类型定义**。写 Agent Host 之前必须先读。
4. **zed.dev/acp 列的 44 个 agent 中，除 Gemini CLI / OpenCode / Codex / Claude Code 外的「原生 vs 适配器」状态**——未逐条核实。

## 需要实测才能确认的

5. **codex-acp 的凭据共享**：不设 `CODEX_PATH` 时它用自己 bundle 的 `@openai/codex`，是否共享顾问已登录的 `~/.codex/auth.json`——**未实测**（我按纪律没有跑任何 codex 任务）。
6. ~~`shouldDeduplicateMcpConflicts()` 的默认值~~ —— **已查证**：默认 **true**（除非 `DISABLE_MCP_CONFIG_FILTERING=true`）。同名静默跳过是真实风险，见 A3 与 D4 风险 2。
7. ~~`sanitizeMcpServerName()` 的具体规则~~ —— **已查证**：仅把 Unicode 空白替换为 `_`，无空白的名字原样传递。
8. **Node 26.3.1 vs 仓库要求的 24.x**：pnpm 已 warn。Electron 43 + better-sqlite3 13 + 新增的 ACP 子进程在 Node 26 下是否稳定——**未验证**。
9. **`@openma/deepseek-harness-acp` 的实际可用性**：我只做了 registry 元数据核实（0.4.9，bin `dsh-acp`），**没有安装、没有跑过**。DSH 本体本机也未装。

## 需要人做决策的（不是我能定的）

10. **SPEC 第 8 章「V1 首批 = DSH + Codex」的落地顺序**：两者成熟度差一个数量级（见 B0）。建议本轮只做 Codex，但这改变了 SPEC 的隐含顺序，需要确认。
11. **`fs/*` 和 `terminal/*` 这两组 ACP client 能力给不给 Agent**：给了就在 MCP 之外开了第二条路，与 SPEC 第 13 章张力（见 D3 风险 2）。
12. **`session/new` 的 `cwd` 给什么**（见 D3 风险 3）。
13. **写面 tool 的错误返回粒度**：34 个结构化错误码原样返给 Agent，还是折叠（见 D2 风险 1）。
14. **methodology runtime 失败时 read plane 是否仍启动**（见 D1 风险）。
15. **`evidence_register` 的 contentHash 去重契约**：SPEC 没写（见 D2 风险 3）。
16. **codex-acp 的引入方式**：打包进 npm 依赖 / 运行时 `npx -y` / 要求预装（见 D4 风险 4）。

## 报告边界

本次侦察**只读**：未修改任何仓库文件（本报告文件除外，为协调方明确追加要求）、未 commit、未 `pnpm install` 任何新包、未让 codex 执行任何任务（仅 `--help` / `--version` / `mcp list` / `features list`）。所有 npm/crates 版本号均为向 registry 直接查询所得，codex-acp 源码为 raw.githubusercontent.com 直取的 `main` 分支。
