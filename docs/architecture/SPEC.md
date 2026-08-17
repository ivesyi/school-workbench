# 学校变革陪跑工作台

## Product & Technical SPEC v1.3 — Methodology Pack + Evidence Reasoning Freeze

**状态：工程冻结基线**

本版本正式冻结：

```text
ACP = Workbench → Agent 控制协议

MCP = Agent → Workbench 能力协议

lark-cli = Agent → 飞书业务能力

Workbench = Domain + State + UX

Human = Final Judgment

Methodology Pack = Versioned Assessment Knowledge

RAG = Source Retrieval / Provenance, Not Scoring
```

删除前期所有没有现实需求的 fallback 架构。

---

# 0. 架构最高原则

## Workbench Owns State

学校正式状态属于 Workbench。

---

## Agent Owns Reasoning

Agent 负责专业推理。

---

## Human Owns Final Judgment

最终裁定属于顾问。

---

## ACP Controls Agents

Workbench 驱动 Agent 统一走 ACP。

---

## MCP Exposes Workbench Capabilities

Agent 访问 Workbench Domain 统一走 MCP。

---

## Runtime Plugins Compose DSH

DSH 特有的运行组合使用 DSH Profile / Bundle / Cordis Plugins。

---

## Zero-Maintenance UX

所有基础设施复杂性不得泄漏到顾问日常界面。

---

## Methodology Grounds Assessment

Agent 的判断必须受版本化方法论、阶段目标、行为锚点和证据质量约束。

书籍原文与 RAG 不能直接产生正式评分。

---

# 1. 正式删除的架构

V1 不再实现：

```text
swb CLI

CLI fallback

Codex SDK fallback

DSH native adapter

Codex native adapter

PTY fallback

Terminal screen parser

Herdr integration

Orca hook integration

自研 Workbench Agent Protocol
```

如果未来出现现实需求：

> 再独立评估。

不提前设计。

---

# 2. 总体架构

```text
┌──────────────────────────────────────────┐
│         School Workbench Desktop         │
│                                          │
│ React                                    │
│ Experience Layer                         │
│ Domain Services                          │
│ Methodology + Assessment                 │
│ SQLite                                   │
│ FeishuAuthCoordinator                    │
│                                          │
│ Internal Local API                       │
└──────────────┬────────────────▲──────────┘
               │                │
              ACP              MCP
               │                │
               ▼                │
        ┌───────────────────────┴───────┐
        │          Agent Runtime         │
        │                                │
        │   DeepSeek Harness    Codex    │
        └─────────────┬──────────────────┘
                      │
                      │ shell
                      ▼
                   lark-cli
                      │
                      ▼
                     飞书
```

## 2.1 产品形态冻结

正式产品是：

> **Electron Desktop Application。**

其中：

```text
Electron = 桌面应用壳、进程与系统能力
React = Renderer 中的 Web UI
Node = Main Process 与本地服务
```

它不是：

- 部署到浏览器访问的 Web App；
- 云端 SaaS；
- 浏览器 UI + 用户手动启动本地 Daemon；
- Electron 内嵌第三方登录浏览器。

选择桌面客户端是因为 V1 必须统一管理：

- SQLite 生命周期；
- 本地文件、录音与 Evidence；
- ACP Runtime 子进程；
- System Codex / DSH；
- MCP stdio Server；
- `lark-cli`；
- 默认浏览器授权与自动恢复；
- 本地日志、数据目录和升级。

如果改成浏览器 Web UI，仍需额外安装本地 Agent Daemon，并解决浏览器文件权限、进程管理、身份与生命周期协调，反而增加顾问维护成本。

详细决策见：

> `docs/architecture/ADR-001-electron-desktop.md`

---

# 3. 两个协议的职责严格分离

## ACP

Control Plane。

只负责：

- Agent 启动；
- Session；
- Prompt；
- 状态；
- Permission；
- Cancel；
- Shutdown。

---

## MCP

Capability Plane。

只负责 Agent 使用 Workbench：

- 当前学校上下文；
- 当前阶段；
- 当前状态；
- 历史状态；
- Evidence；
- Diagnosis；
- Standards；
- Methodology；
- Feishu readiness。

---

# 4. 技术栈冻结

继续冻结：

```text
Electron 43.x
React 19
TypeScript 5
Node 24
pnpm
electron-vite
Vite
```

UI：

```text
Tailwind CSS 4
shadcn/ui（new-york / neutral / Radix base）
Lucide
React Router
Zod
```

Zustand 只在出现真实的跨页面临时 UI 状态时引入。V0.1 不把 React Hook Form 作为必需依赖。完整组件治理与视觉 Token 见 `docs/architecture/ADR-003-ui-system.md`。

数据库：

```text
SQLite
better-sqlite3
Drizzle ORM
WAL
FTS5
```

Embedding 检索不是 V1 必需依赖。只有 FTS5 与元数据过滤不能满足真实案例时才增加。

内部 API：

```text
Fastify
127.0.0.1
随机端口
```

测试：

```text
Vitest
React Testing Library
Playwright
```

---

# 5. Electron 进程结构

```text
Renderer
React UI
     │
 typed IPC
     │
Preload
     │
     ▼
Electron Main
     │
     ├── Domain Services
     ├── Experience Services
     ├── SQLite
     ├── Agent Host
     ├── Runtime Registry
     ├── FeishuAuthCoordinator
     ├── Local API
     └── File Service
```

Renderer 不：

- 访问 SQLite；
- spawn Agent；
- spawn lark-cli；
- 直接访问 filesystem。

---

# 6. Experience Layer

React 不直接围绕数据库表设计。

正式增加：

```text
SchoolHomeExperience

SchoolStateExperience

JudgmentReviewExperience

TeacherPracticeExperience

AuthorizationExperience

SettingsExperience
```

职责：

> Domain → 用户可以理解的体验。

---

# 7. Agent Host

Agent Host 只负责 ACP。

```text
Runtime discovery
↓
Spawn
↓
ACP initialize
↓
Capability negotiation
↓
Session
↓
Prompt
↓
Status
↓
Permission
↓
Cancel
↓
Teardown
```

不放任何学校业务逻辑。

---

# 8. V1 Agent Runtime 要求

要进入 Workbench V1：

必须满足：

```text
可通过 ACP 驱动
+
支持 MCP
```

V1 首批：

```text
DeepSeek Harness

Codex
```

不存在：

> 不支持 MCP 的兼容模式。

---

# 9. DeepSeek Harness

正式接入：

```text
Workbench Agent Host
        ↓
ACP
        ↓
DSH ACP
        ↓
DeepSeek Harness
```

Workbench 不依赖：

- DSH 内部 DB；
- Session 文件格式；
- private API；
- Web UI。

---

# 10. DSH Workbench Profile / Bundle

V1 为 DSH 提供一个非常薄的运行组合。

作用：

```text
DeepSeek Harness
+
ACP Server
+
dsh-mcp-client
+
Workbench MCP
+
Persona / Instructions
+
必要 sandbox / permission
```

不是：

> School Workbench DSH Plugin 产品。

---

# 11. DSH 插件边界

只有需求属于：

> 修改 / 扩展 DSH Runtime 本身

才开发 DSH Native Plugin。

例如：

- tool execution hook；
- permission policy；
- Agent lifecycle event；
- DSH service；
- DSH-specific UI extension。

学校 Domain 能力：

> 不写 DSH Plugin。

统一 MCP。

---

# 12. Codex

正式接入：

```text
Workbench Agent Host
        ↓
ACP
        ↓
codex-acp
        ↓
Codex
```

优先使用顾问现有 System Codex。

不开发第二套 Codex SDK 路径。

---

# 13. Workbench MCP

新正式模块：

```text
packages/workbench-mcp
```

它是：

> **Agent 访问 Workbench Domain 的唯一正式接口。**

---

# 14. MCP Transport

V1 固定：

> **stdio**

不同时实现 HTTP MCP。

原因：

- 单机；
- 本地；
- Agent Runtime 与 MCP Server 在同一机器；
- 更少网络生命周期；
- 更少配置；
- 不需要 MCP 远程部署。

---

# 15. MCP Server 与 Workbench Core

由于 MCP Server 是独立子进程：

```text
Agent
↓
MCP stdio
↓
school-workbench-mcp
↓
Internal Local API
↓
Workbench Domain
↓
SQLite
```

其中：

> Internal Local API 只是实现细节。

不是对 Agent 的正式能力协议。

正式协议只有：

> MCP。

---

# 16. Local API

Workbench 启动：

```text
127.0.0.1:<random-port>
```

Agent Run 创建短期 Token。

注入 MCP Server：

```text
SWB_ENDPOINT
SWB_TOKEN
SWB_SCHOOL_ID
SWB_AGENT_RUN_ID
```

---

# 17. Token Scope

允许：

```text
school.read
stage.read
state.read
evidence.read
evidence.register
diagnosis.read
diagnosis.propose
standards.read
feishu.ensure_ready
```

不允许：

```text
diagnosis.approve
diagnosis.reject
state.commit
stage.activate
human.review
```

---

# 18. Workbench MCP Tools v1

正式冻结为：

```text
school_context

stage_current

state_current

state_history

evidence_list

evidence_register

diagnosis_list

diagnosis_propose

standards_get

feishu_ensure_ready
```

V1 不继续增加几十个 Tool。

`standards_get` 同时承载版本化 Methodology Pack 的查询，不为每一本书新增 MCP Tool。

---

# 19. school_context

返回 Agent 真正需要的学校上下文：

```text
School
Active Stage
Stage Summary
Current Snapshot Summary
Recent Approved Judgments
```

避免 Agent 自己拼大量查询。

---

# 20. stage_current

返回：

```text
当前阶段
本阶段总目标
五维阶段目标
```

---

# 21. state_current

返回：

```text
最新正式 Snapshot
五维判断
团队特点
对应诊断
```

---

# 22. evidence_register

Agent 真正使用某份材料后：

```text
evidence_register(...)
```

Domain Service：

- 校验学校；
- 去重；
- 建立来源；
- 生成 Evidence ID。

---

# 23. diagnosis_propose

结构化 MCP Tool。

不能通过：

> 普通 Agent 回复文本

解析正式 Diagnosis。

Agent 必须结构化提交。

---

# 24. Diagnosis strict Assessment Contract

Diagnosis 的 canonical 输入边界不再维护第二套 `DiagnosisProposalInput`。

正式 contract 以 `packages/assessment` 的 strict schema 为准：

```text
AssessmentInput
AssessmentCandidate
```

Agent / future MCP write plane 形成候选后，Workbench 必须执行：

```text
validateAssessmentCandidate(input, candidate)
```

只有通过 strict schema、引用完整性、school/stage/methodology/provenance 与 assessment protocol 校验的 candidate，才允许映射为 immutable `DiagnosisProposal` 并进入 HumanReview。调用方不能用额外布尔位或另一套宽松 DTO 绕过 validation gate。

## 24.1 Assessment Provenance

`AssessmentInput` 负责提供可验证的 School、StageTarget、Evidence、ObservationFact、Claim 与 Methodology 上下文；`AssessmentCandidate` 只引用这些输入中的稳定 ID，并保持 Interpretation、Provisional Judgment、Alternative Hypothesis、Counter-evidence search、Unresolved Question 与 Action / Observation / Impact plan 分离。

Workbench 保存可审核的解释与 provenance，不保存或展示模型隐藏思维过程。

## 24.2 standards_get

当前 read plane 的输入允许：

```text
packKey          required
version          required
schoolId         optional scope assertion only
dimensionKeys    bounded canonical filter
practiceType     bounded filter
criterionRefs    bounded stable-id filter
```

至少提供 `dimensionKeys / practiceType / criterionRefs` 之一；未知值、重复值、越界 limit/filter 必须 fail closed。`schoolId` 如出现必须与 capability token / run scope 精确一致。

只有 file Registry 与 persisted SQLite 中同一个 Pack 都为 `active`，并且 key/version/content hash/source fingerprint/criterion projection 精确一致时才返回内容。

返回最小相关投影：

```text
Pack / Version / Hash Provenance
Required Constructs
Selected Criteria
Selected Behavior Anchors
Evidence Guidance
Counter Indicators
Inference Guardrails
Source Locators
```

默认不返回整本书、PDF 或整个 Methodology Pack。

---

# 25. Agent 不能修改正式状态

Workbench MCP 不暴露：

```text
diagnosis_accept
diagnosis_reject
state_commit
stage_activate
```

因此即使 Agent 自己决定“应该确认”：

> 技术上也做不到。

---

# 26. Agent Bootstrap

每次运行注入非常短的规则：

```text
你正在辅助学校变革陪跑顾问。

正式学校状态来自 School Workbench MCP。

不要把自己的 Session Memory 当作正式状态。

如果需要当前学校情况：
使用 school_context。

如果需要学校正式状态：
使用 state_current。

如果形成新的专业判断：
先登记真正使用的依据，
再使用 diagnosis_propose。

必须主动寻找相反证据。

你没有权限替顾问确认最终判断。
```

---

# 27. 飞书业务访问

飞书业务继续使用：

```text
Agent
↓
lark-cli
↓
Feishu
```

不增加：

> Feishu MCP Wrapper。

---

# 28. 为什么 Workbench 仍然参与飞书

Workbench 不参与：

> 飞书业务访问。

Workbench 只参与：

> **需要人操作的授权 Experience。**

这属于 UX 协调，不属于飞书业务 Connector。

---

# 29. FeishuAuthCoordinator

Electron Main 新增：

```text
FeishuAuthCoordinator
```

职责严格限制为：

```text
检测 CLI
检测配置
检测授权
发起授权
生成授权 Experience
等待结果
验证授权
通知 Agent Run 继续
```

不负责：

- 搜飞书；
- 读飞书；
- 写飞书；
- 解析学校资料。

---

# 30. feishu_ensure_ready

Agent 在准备第一次访问飞书前：

```text
feishu_ensure_ready
```

正常：

```json
{
  "ready": true
}
```

Agent 随后直接使用：

```text
lark-cli
```

---

# 31. 飞书授权状态判断

Coordinator 内部逻辑：

```text
检查 lark-cli
↓
检查 CLI 配置
↓
检查 auth status / verify
```

如果正常：

> 不产生 UI。

---

# 32. 未配置飞书

Coordinator 发起官方 CLI 初始化流程。

Experience 层只显示：

```text
正在启用飞书

需要完成一次飞书设置。

已经在默认浏览器打开。
也可以用手机扫码。

● 等待中……
```

不向用户显示 CLI 命令。

---

# 33. 未授权 / 授权失效

Coordinator 调用官方 CLI 的非阻塞授权模式：

```text
获得：
verification URL
device code
```

其中 URL 用于：

1. 系统默认浏览器；
2. Workbench QR。

Device Code：

> 仅 Coordinator 内部使用。

---

# 34. 默认浏览器

固定使用：

```text
Electron shell.openExternal(verificationUrl)
```

因此：

> HTTPS 地址由用户系统默认浏览器打开。

不使用：

- Electron WebView；
- 内嵌网页登录窗口；
- 指定 Chrome；
- 指定 Safari。

---

# 35. 二维码

Workbench 使用：

```text
verificationUrl
```

在本地生成 QR Code。

二维码：

> 只是同一官方 URL 的另一种呈现形式。

不实现第二种 OAuth。

---

# 36. QR 技术

采用一个轻量本地 QR library。

输入：

```text
verificationUrl
```

输出：

```text
SVG / Data URL
```

Renderer 展示。

不解析终端 ANSI QR。

---

# 37. 授权 Experience Event

FeishuAuthCoordinator 向 Experience Layer 发布：

```ts
type ExternalAuthorizationView = {
  provider: 'feishu'

  title: string

  explanation: string

  verificationUrl: string

  qrDataUrl: string

  status: 'waiting' | 'success' | 'failed' | 'expired'
}
```

`verificationUrl` 默认不直接显示为文本。

---

# 38. 授权 UI

Renderer：

```text
需要确认一下飞书权限

已经在你的默认浏览器中打开授权页面。

完成授权后这里会自动继续。


[ QR CODE ]

也可以直接用手机扫码。


● 等待授权……

[再次打开浏览器]
```

---

# 39. AgentRun 状态

现有 SQLite：

```text
needs_input
```

用于表达：

> Run 当前正在等待用户完成一个外部动作。

因此：

> SQLite Schema 不增加新的状态。

Experience Layer 再区分：

```text
external_authorization
provider = feishu
```

---

# 40. Agent 动态发现未授权

如果 Agent 在运行过程中才发现需要飞书：

```text
Agent
↓
feishu_ensure_ready
↓
发现未授权
↓
Coordinator 创建授权 Experience
↓
Agent Run = needs_input
```

当前 Agent Turn 可以结束或暂停。

---

# 41. 授权后的自动恢复

授权成功：

```text
Coordinator verify
↓
Experience = success
↓
Agent Run 恢复
```

Workbench 自动继续：

> 原任务。

不要求用户重新发送。

---

# 42. 同 Session 恢复优先

如果当前 Agent Runtime Session 仍然有效：

Workbench 自动发送：

```text
飞书授权已经完成。
继续刚才的任务。
```

继续同一 Session。

---

# 43. Session 无法恢复时

如果 Runtime Session 已经失效：

```text
创建新 Session
↓
重新注入：
School Context
Original User Instruction
已完成飞书授权
↓
继续任务
```

用户无感。

这不会影响正式业务状态，因为：

> Agent Session 从来不是 System of Record。

---

# 44. 显式飞书请求的预检

如果用户输入明显包含：

- 飞书链接；
- “飞书”；
- “妙记”；
- 明确要求查看飞书文档；

Workbench 可以在启动 Agent 前先执行：

```text
FeishuAuthCoordinator.ensureReady()
```

如果已授权：

> 无延迟继续。

如果未授权：

> 先完成授权，再启动 Agent。

这样是最丝滑的路径。

---

# 45. 非显式请求

如果用户只是：

> 看看最近中层到底发生了什么。

Agent 运行后自主决定需要查询飞书。

此时：

> 使用 `feishu_ensure_ready` 动态触发授权。

---

# 46. JIT Authorization

禁止：

> Workbench 启动就弹飞书授权。

只在：

> 本次任务真正需要飞书。

才执行。

---

# 47. 资源 ACL 错误

必须区分：

```text
OAuth / CLI authorization failure
```

和：

```text
resource access denied
```

前者：

> 重新授权。

后者：

> 提示用户找资源所有者获得访问权限。

不进行无意义重复扫码。

---

# 48. 权限补充

如果当前 CLI 已登录，但某次业务操作需要新增 scope：

Coordinator 可以触发：

> 补充权限授权。

用户 UI 仍然复用同一授权组件。

不暴露：

> scope 名称

除非技术详情。

---

# 49. Authorization Timeout

如果授权超时：

```text
授权链接已过期

[重新打开授权]
```

重新获取新的：

> verification URL。

不要求用户刷新或重新开始整个任务。

---

# 50. Authorization Cancel

用户可以关闭授权浮层。

当前 Run：

```text
needs_input
```

转：

```text
cancelled
```

或由用户选择：

> 暂时不使用飞书继续。

V0.1 可以先只支持：

```text
取消本次分析
```

避免增加复杂分支。

---

# 51. 设置页授权

设置页可以主动：

```text
飞书

尚未启用

[启用]
```

使用完全相同的：

> FeishuAuthCoordinator。

不能实现第二套设置授权逻辑。

---

# 52. 默认设置 UI

```text
AI 助手
✓ 正常

默认 AI 助手
Codex >

飞书
✓ 可以使用

本地数据
✓ 正常
```

---

# 53. Advanced Settings

才显示：

```text
Codex executable

DSH runtime

ACP contract

MCP

lark-cli version

Feishu auth diagnostics

Data directory

Logs
```

---

# 54. Error Translation

增加统一：

```text
TechnicalError
↓
Experience Error
```

例如：

```text
lark-cli not found
```

用户：

> 飞书功能还没有准备好。

```text
auth token expired
```

用户：

> 飞书需要重新确认一下权限。

```text
resource forbidden
```

用户：

> 当前飞书账号没有这份资料的访问权限。

---

# 55. Evidence Flow

```text
Agent
↓
lark-cli 读取飞书
↓
实际使用某份材料
↓
evidence_register MCP
↓
Evidence ID
↓
diagnosis_propose MCP
```

注意：

> 飞书读取和 Workbench Evidence 注册是两件事。

---

# 56. Stage 自动提议

继续使用现有：

```text
stages.status = planned

stage_targets.status = draft
```

用户确认后：

```text
stage = active

targets = confirmed
```

不新增 Proposal 表。

---

# 57. Diagnosis Review

仍然由 Workbench UI 完成：

```text
认同
修改
先补充更多依据
不认同
```

Agent MCP 不具备最终确认能力。

---

# 58. Natural Language Modify

用户修改：

```text
human feedback
+
original diagnosis
```

交给当前 Agent。

生成新的 suggested judgment。

顾问最终确认。

---

# 59. State Commit

只有顾问点击：

> 确认现在的状态

才执行：

```text
create StateSnapshot
```

---

# 60. SQLite

正式升级为：

> SQLite Schema v1.1 — Methodology & Assessment Provenance

作为 Canonical Data Model。

本版本：

> **在首个应用实现前完成 Schema Freeze。**

原因：

- Methodology Pack 必须可版本化；
- Diagnosis 必须引用具体 Criterion；
- Evidence Fact、解释与判断必须可分离追溯；
- 当前工作区尚未存在可执行数据库，不需要迁移用户数据。

完整定义见：

> `docs/data/DATABASE_SCHEMA.md`

---

# 61. Agent Run 仍采用现有状态

```text
queued
running
needs_input
completed
failed
cancelled
```

其中：

```text
needs_input
```

覆盖：

- 飞书授权；
- Agent 需要顾问提供额外信息；
- 其他未来的人机外部动作。

具体原因：

> 不进入数据库 Enum。

由 Experience Layer 表达。

---

# 62. Runtime Compatibility

继续：

```text
Verified
Compatible
Unsupported
```

判断：

```text
ACP initialize
+
Required capability
+
Contract test
```

不依赖硬编码版本。

---

# 63. DSH 独立升级

DSH：

```text
0.x → 1.x → 2.x
```

只要：

> ACP contract + MCP capability 仍然成立，

Workbench 不需要同步升级。

---

# 64. Codex 独立升级

同样：

> Workbench 不依赖 Codex 内部 Session / DB / App Server 私有结构。

`codex-acp` 负责 ACP 边界。

---

# 65. Repository Structure

正式收敛：

```text
school-workbench/
│
├── apps/
│   └── desktop/
│
├── packages/
│   ├── shared/
│   ├── domain/
│   ├── ontology/
│   ├── methodology/
│   ├── assessment/
│   ├── application/
│   ├── db/
│   ├── agent-host/
│   ├── workbench-mcp/
│   └── experience/
│
├── knowledge/
│   ├── ontology/
│   └── methodology/
│
├── runtimes/
│   ├── dsh/
│   └── codex/
│
├── tests/
│   ├── e2e/
│   ├── golden/
│   ├── contracts/
│   └── fixtures/
│
├── references/
│   ├── books/
│   ├── frameworks/
│   ├── standards/
│   └── field-notes/
│
└── docs/
    ├── product/
    ├── architecture/
    └── data/
```

`knowledge/` 保存可版本化的声明式知识，`packages/ontology` 与 `packages/methodology` 保存加载、验证和查询代码。`references/` 只保存原始研究资料，不进入产品安装包。禁止在根目录新增领域材料或把同一规则复制到多个目录。

Ontology 的概念、关系、约束和映射边界见 `knowledge/ontology/core-v1/`；架构决策见 `docs/architecture/ADR-002-workbench-ontology.md`。

删除：

```text
swb-cli/

runtime-adapters/

vendor/herdr/

vendor/orca/
```

除非未来真的开始使用。

---

# 66. Open-source 复用原则

需要某个实现时：

> 先找成熟代码，再写。

但：

> 不因为未来“也许需要”就提前把代码拉进仓库。

Paseo、Herdr、Orca：

> 继续作为研究和代码参考源。

---

# 67. 第一个工程纵切

```text
新建学校
↓
进入工作台
↓
输入：
“看看昨天飞书里的中层会议”
↓
发现飞书未授权
↓
自动打开默认浏览器
+
显示 QR
↓
用户完成授权
↓
自动继续
↓
Agent 使用 lark-cli
↓
读取会议纪要
↓
MCP evidence_register
↓
MCP diagnosis_propose
↓
UI：
“有一个新的判断需要你确认”
↓
认同
```

这一个纵切同时验证：

- Zero-Maintenance UX；
- ACP；
- MCP；
- DSH/Codex；
- lark-cli；
- 授权；
- Evidence；
- Diagnosis；
- Human Review。

---

# 68. 第二纵切

```text
多个已确认判断
↓
State Draft
↓
显示学校当前状态
↓
顾问确认
↓
Snapshot #1
↓
“已经记录学校当前起点状态”
```

---

# 69. 第三纵切

```text
新的飞书材料
↓
无需重新授权
↓
Agent 自动读取
↓
新的 Diagnosis
↓
顾问确认
↓
状态变化
↓
Snapshot #2
↓
显示“和上一次相比”
```

## 69.1 第四纵切：教师看见自己的实践

```text
拖入教案 + 课堂录音 + 教师反思
↓
提取学生学习与课堂实践事实
↓
standards_get 获取：
Data Wise + 教师行为锚点
↓
区分事实 / 解释 / 判断
↓
形成实践问题与替代解释
↓
提出下一步行动和影响证据
↓
顾问确认
```

该纵切验证：

- 本地文件与音频 Evidence；
- Methodology Pack；
- ObservationFact / Claim；
- Practice Diagnosis；
- 影响验证。

---

# 70. 授权专项 E2E

必须覆盖：

### Case A

默认浏览器已经登录飞书。

目标：

> 一次确认完成。

### Case B

浏览器未登录，但手机飞书已登录。

目标：

> 扫码完成。

### Case C

授权已有效。

目标：

> 完全无感。

### Case D

Token 失效。

目标：

> 自动重新授权并恢复任务。

### Case E

URL 过期。

目标：

> 一键重新生成。

### Case F

资源 ACL 不足。

目标：

> 不进入重复 OAuth。

---

# 71. UX 自动测试

普通 UI 禁止出现：

```text
ACP

MCP

Runtime

Device Code

OAuth Scope

Verification URL

Evidence Registry

Diagnosis Proposal

State Snapshot

Commit
```

除：

> 高级设置 / 技术详情。

---

# 72. Methodology Layer

正式增加：

```text
packages/methodology
```

职责：

- 加载和验证 Methodology Pack；
- 按版本提供 Construct、Criterion 与 Behavior Anchor；
- 保存来源定位；
- 为 `standards_get` 提供最小相关上下文。

V1 Pack：

```text
schooling-by-design-v1
data-wise-v3
congruence-framework-v1
role-standards-v1
```

书籍 Pack 是经过人工校验的结构化派生内容，不是自动切块结果。

当前人工审核基线位于：

```text
knowledge/methodology/schooling-by-design-v1/PACK.md
knowledge/methodology/data-wise-v3/PACK.md
knowledge/methodology/WORKBENCH-METHODOLOGY-CROSSWALK.md
knowledge/methodology/AGENT-ASSESSMENT-PROTOCOL.md
```

这些 Markdown 是产品与领域审核输入。工程实现必须在顾问批准后，将其转译为满足下述 Contract 的 YAML / JSON；不得直接把 Markdown 标题或自然语言段落当作运行时评分代码。

---

# 73. Methodology Pack Contract

```ts
type MethodologyPack = {
  id: string
  version: string
  title: string
  sourceType: 'book' | 'framework' | 'standard'
  sourceRef: string

  constructs: Construct[]
  criteria: Criterion[]
  behaviorAnchors: BehaviorAnchor[]
  evidenceGuidance: EvidenceGuidance[]
  inferenceGuardrails: InferenceGuardrail[]
}
```

Pack 内容必须具有稳定 ID。已经提交的 Diagnosis 永远引用当时的版本，不随 Pack 更新漂移。

---

# 74. Assessment Pipeline

正式冻结：

```text
Evidence acquisition
↓
Observation Fact extraction
↓
Criterion mapping
↓
Stage-target comparison
↓
Supporting / counter evidence search
↓
Alternative-hypothesis check
↓
Diagnosis Proposal
↓
Human Review
```

可以由同一 Runtime 分阶段执行。V1 不要求多 Agent 编排。

---

# 75. Retrieval / RAG Boundary

运行时优先级：

```text
Structured Methodology Pack
↓
Metadata-filtered FTS5 retrieval
↓
Optional embedding retrieval
↓
Original source excerpt
```

禁止：

- 仅凭语义相似度选择评估标准；
- 把整本书注入 Prompt；
- 把检索到的原文当作自动分数；
- 无 Criterion 引用地形成正式 Diagnosis。

---

# 76. Assessment Quality Harness

建立顾问审核的 Golden Cases，至少验证：

```text
Evidence citation correctness
Observation / inference separation
Criterion mapping accuracy
Counter-evidence recall
Abstention when evidence is insufficient
Agreement with consultant judgment
Cross-runtime stability
```

在积累足够高质量审核案例前：

> 不进行模型微调。

---

# 77. Source Packaging Boundary

原始书籍只在顾问本地用于检索。

Workbench 保存：

- 方法论派生结构；
- 来源元数据；
- 章节 / 页码等定位；
- 判断所需的必要短摘录。

不把完整受版权保护书籍打包进可分发应用。

---

# 78. 最终冻结架构

```text
                 顾问
                  │
                  ▼
        School Workbench
                  │
      ┌───────────┴───────────┐
      │                       │
 Experience               Domain
      │                       │
      │              ┌────────┴────────┐
      │         Methodology         SQLite
      │              │
      │          Assessment
      │
      ├── Authorization UX
      │
      ▼
   Agent Host
      │
     ACP
      │
┌─────┴─────────────┐
│                   │
DSH                Codex
│                   │
└─────────┬─────────┘
          │
          ├── MCP ─────────→ Workbench Domain
          │
          └── lark-cli ────→ Feishu
```

---

# 79. 最终不可破坏原则

> **顾问负责工作，系统负责记账。**

> **Workbench owns state.**

> **Agent owns reasoning.**

> **Human owns final judgment.**

> **ACP controls agents.**

> **MCP exposes Workbench capabilities.**

> **Runtime plugins compose DSH.**

> **Methodology grounds assessment.**

> **Evidence constrains judgment.**

> **RAG retrieves sources; it does not score.**

飞书授权再增加一条明确的 UX 原则：

> **Browser First · QR Always Available · Auto Resume.**
