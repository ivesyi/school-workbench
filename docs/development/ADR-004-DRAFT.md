# ADR-004（草稿）：受控 harness 与宿主层的边界

**状态：草稿，未签署。** 正式 ADR 属于顾问签字的权威文档，放在 `docs/architecture/`；这份不是，它记录 WS2 切片做出的技术选择与代价，供顾问审阅后决定是否升格。**在升格之前，本文件不构成任何冻结约束。**

- 日期：2026-08-19
- 相关：ADR-001 ~ ADR-003、SPEC 7 / 8 / 12 / 13 / 18 / 25 / 62 / 64、PRD 14 / 15 / 16、台账 §14、§15
- 代码：`packages/agent-host/src/harness/`、`packages/agent-host/src/harness-pi/`、`apps/desktop/src/main/model-channel-store.ts`

---

## 1. 背景：宿主层不受产品控制

M1–M3 把真 AI 接进来的方式是：产品 → ACP → codex-acp → Codex CLI → 模型后端。这条链上产品只拥有第一段。

2026-08-18 台账 §14 记的那次事故是这个结构的必然产物，不是偶发：另一台机器上 codex CLI 自己升到 0.147.0，开始对模型后端发 `type:"namespace"` 形状的工具，后端不认，模型调用失败，codex 在退出路上把还在启动的工作台 MCP server 一并取消，产品把它误判成 `WORKBENCH_MCP_STARTUP_FAILED`。

产品对此**做不了任何预防**。顾问装的 CLI 会自动升级；它和模型后端之间说什么话，产品既看不见也管不着；SPEC 64 明确允许 Codex 按自己的节奏发版。WS1 已经把能做的都做了——真就绪探测、版本透明、失败现场切换按钮——但那些全是**事后**手段：让人更快看清坏在哪，不能让它不坏。

## 2. 决策：增加一个受控 harness，而不是替换宿主层

引入第二个助手，它的推理循环是**产品 lockfile 里锁死版本的库，跑在工作台进程内**。

|              | Codex（宿主层 harness）         | 工作台自带助手（受控 harness） |
| ------------ | ------------------------------- | ------------------------------ |
| 循环在哪     | 顾问装的 CLI，独立进程          | 产品进程内，pin 在 lockfile    |
| 什么时候变   | 它自己升级时                    | 只有本仓库改 pin 时            |
| 模型凭据     | Codex 账号，产品不碰（决策 L1） | 顾问在设置页填，产品负责保管   |
| 工具通路     | MCP stdio 子进程                | 进程内函数调用                 |
| 出事怎么发现 | 一次失败的运行                  | 改 pin 的那次 code review      |

**这不是替换。** 两个助手平级并存（PRD 15），默认仍是 Codex——它是唯一有过真模型端到端验收记录的（台账 §11）。产品里没有任何代码给它们排序、降级、路由或在失败后自动切换；换助手永远是人点一下。

代价也写清楚：模型连接从「别人的账号」变成「工作台要保管的密钥」。第 6 节是这件事的处理方式。

## 3. Harness 接口分层

`packages/agent-host/src/harness/contracts.ts` 定义 `HarnessDriver`。跨过这条线的东西刻意做得很少：一个任务、一份已签发的能力令牌授予、进度事件。ACP 会话、子进程、provider SDK 全留在驱动那一侧。

两条对所有实现都成立的规则：

- **能力令牌是进入工作台数据的唯一通路。** 驱动拿到的只有一个 loopback 地址和一个带 scope 的令牌，它没有 repository、没有数据库句柄、没有自己的 schoolId。所以「加一个驱动」这件事不可能绕过 `packages/workbench-read-plane` 的治理。
- **驱动之间平级。** 接口里没有优先级、没有 fallback、没有重试到下一个。

**codex 路径本轮没有重构**（避免范围爆炸），但已经落了一个**纯投影适配器** `harnessResultFromAcpOutcome`：`AgentHost` 一行没动，产品现在真的从这个接口读结果。这把「接口将来能容下 codex」从承诺变成了已经在跑的事实。三处形状差异各有去处：协商出的协议版本/agent 名 → session identity（字段可空正是为没有协议的 harness 留的）；不认识的 `session/update` 类型 → 通用的 `unrecognisedRuntimeSignals`；带 MCP server 命名空间的工具标题 → 用进度条已经在用的那个解析器降成裸工具名。唯一没有去处的是 `mcpStartupReportedFailure`，那本来就是某个特定 ACP bridge 对某个特定子进程的断言，`AgentHost` 已经据此做完决定并折进 `failure`，接口之上不丢任何判断。

## 4. 为什么选 pi

调研给的候选是 dsh（DeepSeek Harness）与 pi；用户 2026-08-19 拍板 pi。本轮对两者都做了实测（dsh 那轮在改向前完成），结论如下——**两条都被证实可以薄嵌，选型不是「另一个不行」**：

|          | pi（本轮采用）                                                           | dsh（备选，已实测）                                                   | 手写最小 loop |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------- |
| 包       | `@earendil-works/pi-agent-core` + `pi-ai`                                | `@deepseek-ai/dsh-*` 一族（Cordis 插件）                              | —             |
| 嵌入形态 | `runAgentLoop(prompts, context, config, emit, signal, streamFn)`，纯函数 | 用 Cordis 手工组装 5 个服务：`agents/sessions/llm/tools/systemPrompt` | —             |
| 假模型   | **自带** `fauxProvider` + `setResponses` 脚本化                          | 自己实现 `LlmAdapter`                                                 | 自己实现      |
| 依赖体量 | **92MB / 94 包**，含 2 个 install script                                 | **3.0MB / 20 包**，全第一方，无 install script                        | ~0            |
| 工具注册 | `AgentTool`（typebox schema）                                            | Cordis `defineTool`                                                   | 自己写        |
| 成熟度   | 0.84.2，2026-08-14 发版                                                  | 0.1.0-rc.7，开源 5 天                                                 |               |

选 pi 的实际理由：循环是一个可以直接调用的纯函数（不需要装配一整个 IoC 容器）；`streamFn` 是天然的假模型注入口；自带 faux provider 白送了假 LLM 测试设施；版本成熟度高。

**dsh 的实测事实值得留档**（将来若要加它作为第三个驱动，这些不用重做）：核心确实可以薄嵌——`agent-loop` 只 inject 五个服务，装下来 20 个包 3MB，零原生依赖，web UI / bash / fs / telemetry 全都不用挂；实测跑通了带工具调用的完整循环。两个坑：官方**没有** MCP 客户端插件（`dsh-tool-mcp` 确认 404），工具得自己桥接；Cordis 的服务注册比 `ctx.fiber.await()` 晚一个 tick，组装要循环等待服务就位。

**手写最小 loop 的工作量对比**：把 pi 挪走、自己写循环，需要自建的是——流式 chunk 装配（文本/工具调用增量合并）、工具调用调度与结果回灌、消息历史与 provider 报文的双向转换、错误与中断语义、上下文压缩。粗估 800–1500 行加上它们自己的测试，且这些是**会静默出错**的代码（一个装配 bug 表现为模型偶尔漏掉工具调用）。相比之下 pi 给的是 0 行加 92MB。本轮判断是：这类基础设施不值得自己写，除非依赖体量成为部署硬约束。

## 5. 只用第一方，不开放第三方插件

受控 harness 跑在**工作台进程内**，和 SQLite、能力令牌、loopback 在同一个地址空间。所以：

- 只挂产品自己写的工具（`harness-pi/workbench-tools.ts` 里的十个），一个 pi 内置编码工具都不挂——没有 read/write/edit/bash/终端。
- 不提供任何加载社区插件的入口。宿主层 harness 里一个流氓插件顶多毁掉那个子进程；这里它就在数据库旁边。
- pi 的 provider 层硬依赖 openai / @google/genai / @anthropic-ai/sdk / @aws-sdk-bedrock 四个 SDK（不是 optional），装机 92MB。产品只走 OpenAI 兼容那一条，其余三个从不加载。它们带来的两个 install script（`@google/genai`、`protobufjs`）在 `pnpm-workspace.yaml` 的 `allowBuilds` 里**显式设为 false**——用不到的依赖最不该被允许跑安装脚本。

## 6. 模型密钥的保管

Codex 自带账号，产品不碰凭据（决策 L1、SPEC 12/64）。进程内 harness 没有账号，端点和密钥必须由顾问在设置页填。规则只有一条：

> **密钥要么被操作系统自己的密钥保管服务加密，要么不存。**

没有第三个分支。不混淆、不 base64 冒充加密、`safeStorage` 说不行时也不「就这一次」明文落盘。实现在 `apps/desktop/src/main/model-channel-store.ts`：

- 端点与模型名是普通设置，原样存；密钥经 `safeStorage.encryptString` 后带前缀 `swb-safe-storage-v1:` 存进同一张偏好表。前缀是必需的——没有它，一个解不开的值和一个从没被加密的值就分不清，而「那就当明文读读看」正是绝不能存在的回退路径。
- 这台机器没有可用密钥保管服务时，`save()` **什么都不写**（连无害的端点也不写），返回一句人话，工作台自带助手保持不可用。宁可助手用不了——那可以恢复；一个躺在顾问以为安全的 SQLite 文件里的密钥不能。
- **密钥从不回读到任何界面。** `readView()` 只报「有没有」，`readConfig()` 只在一次运行真的要发请求时才被调用。渲染进程收不到它，因此渲染进程的 bug 也漏不出它。
- 存下来的值解不开（换了机器、换了用户、损坏）一律当作「没有密钥」，产品退回「还没配置」这个已经处理得很干净的状态。

## 7. pin 版本与升级流程

`@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 在 `packages/agent-host/package.json` 和 `apps/desktop/package.json` 里**都**精确 pin（禁止 `^` / `~`，与决策 L8 对 codex-acp 的要求一致）。`pinnedBuiltinHarnessVersion` 是同一个字符串，有测试锁住它必须等于两份 manifest 里的 pin。

升级一个新版本，流程与台账 §14.3 对其他 runtime 的要求相同：

1. 改两份 manifest 的 pin 与 `pinnedBuiltinHarnessVersion`，跑完整验收命令。
2. 配好模型连接，**从界面完整走通一次真实分析**：打一句话 → 看到四句进度 → 判断进 HumanReview → 顾问点认同。
3. 通过之后才把这次运行记进台账，并把设置页的版本标注从「未经产品验证」改掉。

**注意现在它就标着「此版本未经产品验证」**，因为确实还没有过真模型端到端运行（第 9 节）。这行字不是靠改常量消掉的。

## 8. 与既有冻结要求的关系

- **SPEC 13 / 18 / 25**：工具面完全一致。`workbench-tool-parity.test.ts` 起真的 MCP server 子进程列真的工具，逐项比对名称、描述、参数 schema——两个助手拿到的指令不可能悄悄分叉。装配时还会跑一次 SPEC 18 / SPEC 25 契约检查，工具集不对就在花掉一个 token 之前抛错。
- **SPEC 17 / 治理面**：每次工具调用都走同一个 loopback HTTP 端点、同一个 bearer 令牌、同样两个 scoping header，落进同一个 Fastify 路由做鉴权、查 scope、按同一批 zod 契约校验。read plane 分辨不出两个助手的区别——这正是目的。
- **SPEC 24 / 判断链路**：`GroundedDiagnosisService` 与写面语义一行未动。判断只能走 `evidence_register` / `diagnosis_propose` / `stage_propose`，失败即失败，拒绝的 `errors[]` 逐字回传给模型（决策 L5）。
- **SPEC 62**：三态判定仍来自运行时真实表现，不看版本号。进程内 harness 没有协议握手，能验的只有工具面契约，所以 `verified` 由那次契约检查得出；`protocolVersion` 与 `acp_session_id` 记 `null` 而不是编一个像样的值。
- **PRD 16**：四句进度文案由 pi 的 `tool_execution_start` 事件喂给既有的 `nextProgressPhase`，只有工作台自己的工具能进这条通路。

## 9. 已知代价与未验证项（不许粉饰）

1. **真模型端到端未验证。** 本轮所有证据来自脚本化模型 + 真 SQLite / 真 loopback / 真契约。这不是「工作台自带助手能用」的证据，只是「模型和数据库之间的一切能用」的证据。
2. **92MB 依赖 + 2 个被拒的 install script。** pi 的 provider 层硬拉四个厂商 SDK。将来若打包体积成为问题，选项是自己写一个 OpenAI 兼容 provider 顶掉 `pi-ai`（`pi-agent-core` 硬依赖它，所以不能简单删）。
3. **参数预校验会做类型强转。** pi 在调用工具前用 typebox 校验并**强转**参数（`"5"` → `5`，可空字段的 `null` 被删掉）。codex 路径没有这一层，只有 loopback 的 zod 把关。强转后的载荷仍然要过同一个 zod，所以不会有完整性漏洞——但两个助手对模型的格式毛刺容忍度确实不同，这里如实记下。
4. **`workbench_tools_cancelled` 这个探测态在这条路径上永远落不到**，因为没有 MCP 子进程可被取消。连接测试如实报告，不假装能覆盖六态。
5. **工具描述文案在 `harness-pi/workbench-tools.ts` 里重述了一遍**（`workbench-mcp` 是进程入口，import 它会起一个 MCP server）。有 parity 测试锁住不漂移；更干净的终局是把描述下沉到 `workbench-read-plane/contracts`，那需要改动本轮边界外的包。
