# 任务书：真 AI 接入（真实 ACP + MCP，不走替身）

**类型：任务书草案，等顾问确认范围后才派工**

- 写于：2026-08-17
- 基线提交：`76a4a82`（本地与 `origin/main` 已同步，全套绿：typecheck / lint / format / test 47 files 174 tests / build / e2e 8 passed）
- 上游材料：`AI_RUNTIME_SCOUT_REPORT.md`（只读侦察）、`HANDOFF_2026-08-17.md`（会话交接）
- 状态：**待拍板**（第 5 节 8 条决策未定之前不派工）

---

## 0. 本版与上一版的差异（顾问 2026-08-17 两次更正）

| 更正                                                      | 影响                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **① 产品边界止于 ACP** —— Codex 的授权是 Codex 自己的问题 | 凭据处理退出交付物，降级为环境前提；任何走 ACP 以下的通道（`codex exec` / `app-server` / 直塞 `config.toml`）一律禁止           |
| **② 不要 mock，要真实的 ACP + MCP，不许偏离 PRD / SPEC**  | **上一版的一次性探针方案整体作废**：mock MCP server 作废、`codex exec --output-schema` 作废、「跑完即弃的 scratchpad 脚本」作废 |

**这一段因此从「探针」变成「SPEC 第一纵切的真实一截」。** 下面全部重写，不是在上一版上打补丁。

---

## 1. 这一段做什么

按 SPEC 冻结的链路，把真的那条路接起来：

```text
Agent Host（packages/agent-host，新建）
      ↓ ACP（@agentclientprotocol/sdk）
codex-acp
      ↓
Codex（顾问现有 System Codex）
      ↓ MCP stdio（session/new 注入）
school-workbench-mcp（packages/workbench-mcp，真的那个）
      ↓ HTTP loopback 127.0.0.1 + 能力令牌
WorkbenchLoopbackReadPlane
      ↓
SQLite
```

**没有替身、没有绕行、没有第二套通路。** 读走真 MCP tool，写走真 MCP tool，校验走 `validateAssessmentCandidate`。

---

## 2. 我核实过的前提

**以下全部是我在主会话逐处实读代码 / 逐章实读 SPEC 核实的，不是转述侦察报告。侦察报告有三处不够透，另有两处是它没碰到的。**

### 发现 E：`GroundedDiagnosisService` 没有任何生产调用者，且没人从 DB 组装 `AssessmentInput` ⭐⭐

```
grep -rn "GroundedDiagnosisService" packages apps --include "*.ts" | grep -v ".test.ts"
→ （空）
```

它今天只在自己的单测里被调用过。而它的签名是：

```ts
create({ schoolId, type, title, rawAssessmentInput, rawAssessmentCandidate })
```

**`AssessmentInput` 和 `AssessmentCandidate` 都是调用方给的。** `validateAssessmentCandidate` 校验的是这两者**之间**的引用完整性（`context.ts:152-352`），**不核对 Input 里的 Evidence / ObservationFact / Claim 是否真的存在于 SQLite**。

对上 SPEC 第 24.1 章原文：

> `AssessmentInput` 负责提供**可验证的** School、StageTarget、Evidence、ObservationFact、Claim 与 Methodology 上下文

**如果让 Agent 同时提交 Input 和 Candidate，Agent 就可以凭空编造 Evidence，且能通过全部校验。** 那是对 SPEC 24.1「可验证」的实质偏离——代码不会报错，但 provenance 是假的。**「谁来提供 AssessmentInput」是这一段必须先定的契约，不是实现细节**（决策 5）。

### 发现 F：SPEC 第 26 章的 Agent Bootstrap 要求「先登记依据，再提判断」

SPEC 第 26 章（`SPEC.md:786-800`）冻结的注入规则原文：

> 如果形成新的专业判断：
> **先登记真正使用的依据，**
> 再使用 `diagnosis_propose`。

**所以「只做 `diagnosis_propose`、不做 `evidence_register`」本身就偏离 SPEC 第 26 章。** 侦察报告 D2 把两者列成可分先后的两块（因为 `diagnosis_propose` 后端全有、`evidence_register` 要新写 service），那是**按工程成本排的**，不是按 SPEC 排的。要「不偏离」，两个写面 tool 必须一起上。

### 发现 A（修正版）：真实路径**绕不开** Pack 激活

上一版我提过 `registryForProfile('active')` 能在内存里把 status 覆成 active，从而不必等激活。**那条路随 mock 方案一起作废**——它本来就是替身。

真实路径的硬约束，SPEC 第 24.2 章原文：

> 只有 **file Registry 与 persisted SQLite 中同一个 Pack 都为 `active`**，并且 key/version/content hash/source fingerprint/criterion projection 精确一致时才返回内容。

代码侧同源：`packages/assessment/src/context.ts:325` Pack 非 active 直接报 `Methodology pack <key>@<ver> is not active.`。

**后果**（这是事实陈述，不是催你放行）：

- `standards_get`、`diagnosis_propose` 在 Pack 激活前**必然 fail-closed**
- 但这**不阻塞建造**：整条链路可以先建成、先跑通，终点停在 `ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE`。**那个 fail-closed 本身就是一次有效的端到端验收**——它证明 ACP 通了、MCP 注入可见了、tool 被调用了、校验器真的挡住了
- 你审完准则给出结论后，**同一条链路、同一次运行**，终点才变成真候选。届时不需要改任何代码

### 纠正 B（保留，降级用途）：golden 12 条里只有 4 条对真 AI 是有意义的考题

fixture 的 `expected` 是为确定性候选写的；adapter 模式下候选由 AI 现场生成，`runGoldenCaseWithAdapter`（`golden.ts:127-145`）却仍拿 AI 的结果去比 fixture 的 `expected`。逐条比对 `golden/v1/cases.ts:345-490`：

| 类别                                | case                                                                                                                                                    | 处理                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 1 真考题（4 条）**           | `sbd-system-alignment-proposed`、`data-wise-practice-visibility-proposed`、`unselected-claim-counter-does-not-pollute`、`single-vague-input-abstains`   | 期望 AI 的候选**通过**。`single-vague-input-abstains` 最值钱：输入无事实无 Claim，AI 只有**正确弃权**才能通过                            |
| **Tier 2 期望对 AI 是反的（3 条）** | `counter-fact-omitted`、`selected-claim-counter-still-required`、`criterion-version-mismatch-rejected`                                                  | fixture 故意给**有缺陷的候选**来测校验器，AI 不该复现缺陷 → **反转为期望通过**。前两条考的正是「模型只报支持自己的证据」这个已知失败模式 |
| **Tier 3 与候选无关（5 条）**       | `observation-interpretation-confusion`、`wrong-school-and-dangling-ref`、`review-pack-rejected`、`retired-pack-rejected`、`wrong-pack-version-rejected` | 在 `buildAssessmentContext` 阶段就挂，AI 产出什么都一样。只作冒烟，不计入能力判分                                                        |

**本版中这不再是交付主线，降级为「Agent 判断质量」的验收资产**——真实链路建成后拿它回归，判分口径写死、不许跑完再改。

### 纠正 C（保留）：`runGoldenCaseWithAdapter` 会吞掉失败原因

`golden.ts:143` 的 catch 是空的，连 error 对象都不接：模型超时、JSON 解析失败、进程崩了、codex 起不来——全折叠成 `ASSESSMENT_RUNTIME_ADAPTER_ERROR`。诊断必须自己记。**不许为此修改 `golden.ts`**（冻结的生产代码）。

### 纠正 D（保留，升为总纲）：产品边界止于 ACP

顾问 2026-08-17 明确，SPEC 有原文：

- **第 12 章**（`SPEC.md:481-485`）：「优先使用顾问现有 System Codex。**不开发第二套 Codex SDK 路径。**」
- **第 64 章**（`SPEC.md:1601-1605`）：「Workbench 不依赖 Codex 内部 Session / DB / App Server 私有结构。`codex-acp` 负责 ACP 边界。」

Codex 怎么登录、凭据放哪、`config.toml` 怎么写、内部 session 怎么管——产品不管、不存、不建 UI、不进 `runtime_profiles`。凭据不通就如实报「起不来」，**不许自己想办法绕过**。

### 已核实的环境与仓库事实

| 项                                                         | 实测                                                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex --version`                                          | `codex-cli 0.147.0`；`codex-acp` **未安装**                                                                                                               |
| `~/.codex/auth.json`                                       | 存在（4276 字节，ChatGPT 登录态）。**仅作环境前提记录，产品不碰**                                                                                         |
| `@modelcontextprotocol/server`                             | **2.0.0 已在仓库**，`registerTool` 直接吃 zod schema                                                                                                      |
| SPEC 第 17 章 Token Scope                                  | **`evidence.register` / `diagnosis.propose` 是 SPEC 允许清单里的**（`SPEC.md:571-590`）→ 加写 scope 不是偏离，是补齐                                      |
| SPEC 第 18 章 Tools v1                                     | 冻结 10 个 tool，现仓库只实现 7 个读 tool。缺 `evidence_register` / `diagnosis_propose` / `feishu_ensure_ready`                                           |
| `runtime_profiles` / `agent_sessions` / `agent_runs`       | `packages/db/src/schema.ts` 里**一张都没有**（`DATABASE_SCHEMA.md:295-303` 写了但没落地）                                                                 |
| `evidence.agent_run_id` / `observation_facts.agent_run_id` | 列已存在，当前是**指向不存在的表的悬空文本列**                                                                                                            |
| 本地 dev 库                                                | `~/Library/Application Support/@school-workbench/desktop/school-workbench.sqlite`；2 pack 均 `review`，10 条准则 `dimension_key` 全非空，sign-off 表 0 行 |

---

## 3. 「不偏离 PRD / SPEC 的可运行」到底有多大

诚实盘一遍。PRD / SPEC 对「顾问说一句话 → 真 Agent 干活 → 出判断给顾问确认」这条路的完整要求：

| 块                                                                              | SPEC / PRD 依据                                                          | 现状                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Agent Host（ACP 全生命周期）                                                    | SPEC 7                                                                   | **不存在**，`packages/agent-host/` 没建                                  |
| Runtime 兼容性判定                                                              | SPEC 62（`initialize` + capability + contract test，**不许硬编码版本**） | 不存在                                                                   |
| loopback 在 Electron 里启动                                                     | SPEC 14/15/16                                                            | 包建好了，**Electron 主进程一行没接**                                    |
| MCP 写面 `diagnosis_propose`                                                    | SPEC 18 / 23 / 24                                                        | 后端链条全有（`GroundedDiagnosisService`），**MCP 侧与 loopback 侧没有** |
| MCP 写面 `evidence_register`                                                    | SPEC 18 / 22 / 26                                                        | **没有 service**，要新写 domain 逻辑 + contentHash 去重迁移              |
| `agent_runs` 六态                                                               | SPEC 61 / 39                                                             | 三张表都没有                                                             |
| 设置里选默认 AI 助手                                                            | **PRD 15**                                                               | 只有占位（`settings-page.tsx:24-33`「尚未启用」）                        |
| Agent 高层进度（禁显 ACP Event / Session ID / Token / CoT / Shell / Tool JSON） | **PRD 16** + ADR-003:63                                                  | 不存在                                                                   |
| 工作台不显示 Agent 选择器                                                       | **PRD 14**                                                               | 工作台已有输入框                                                         |

**全做完 = SPEC 第一纵切的绝大部分。这一段不可能一口吃完，但也不该为了省事去偏离。**

**我的建议：范围一条不砍，拆成三个里程碑按序交付，每个里程碑本身都是真实且不偏离的**（不是三个方案里挑一个，是同一件事的三次可验收切分）：

| 里程碑            | 内容                                                                                                                                      | 跑起来能看到什么                                                                                            | 依赖 Pack 激活？                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **M1 真链路读通** | `packages/agent-host` 最小实现（SPEC 7 全生命周期，但只用到读）+ codex runtime + loopback 在 Electron 里启动 + `agent_runs` 三张表 + 六态 | 真 Codex 通过真 ACP 连上真 workbench-mcp，读到**你这台机器上真实学校的** `school_context` / `state_current` | 否（`standards_get` 除外，它会 fail-closed） |
| **M2 真链路写通** | `evidence_register` + `diagnosis_propose` 两个写面 tool（SPEC 22/23/26 要求成对）+ 写 scope + 错误映射                                    | Agent 登记真依据 → 结构化提交判断 → 校验器裁决。**Pack 未激活时终点是 fail-closed，激活后是真候选**         | 终点取决于它                                 |
| **M3 产品面**     | PRD 15 设置选默认助手 + PRD 16 高层进度 UI + 工作台触发                                                                                   | 你从工作台打一句话，看着它跑完，判断进 HumanReview                                                          | 是                                           |

M1 是**唯一能在你还没审完准则时就完整验收**的一段，而且它扛的是整轮最大的技术风险（ACP 真能不能驱动 Codex、MCP 注入会不会被静默过滤）。M2 建成后可以先用 fail-closed 验收，等你结论一到立刻变成真候选，不需要返工。

**你若要求一次派完 M1+M2+M3，我照办**，只是验收会集中在最后、失败面更大。**范围由你定。**

---

## 4. 明确不做（本轮任何里程碑都不碰）

- `knowledge/` 与两份 `pack.json` 零改动；不激活任何 Pack；不预填任何 sign-off
- 不实现 `feishu_ensure_ready` 及飞书授权全套（SPEC 31–43，另一轮）
- 不实现 `教师实践` 页面（PRD 29/30）
- 不碰 `diagnosis_accept` / `diagnosis_reject` / `state_commit` / `stage_activate`——SPEC 第 25 章明令 MCP 不得暴露
- 不改 `golden.ts`、不改 `engines`
- 不做打包签名与自动更新

---

## 5. 待你拍板的决策

侦察报告那 7 条我按本版重排，加上我新发现的 1 条。**因为不再用替身，其中 7 条已从「不卡」变成「卡」。**

---

**决策 1 ── 范围**（见第 3 节）

**推荐：M1 → M2 → M3 按序派工，每个里程碑主会话独立验收后再派下一个。**

**你的选择：M1 先行 ／ M1+M2 ／ 一次全做 ／ 其他 →**

---

**决策 2 ── 谁提供 `AssessmentInput`**（我新发现的，见发现 E；**最重要的一条**）

| 选项                                                                  | 与 SPEC 24.1「可验证」的关系                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a. Workbench 从 SQLite 组装 Input，Agent 只提交 Candidate**（推荐） | ✅ Provenance 由 Workbench 保证，Agent 编不出假 Evidence。代价：新写一个 InputBuilder，且 `diagnosis_propose` 的 tool 形状是「candidate + 引用」而非「input + candidate」 |
| b. Agent 提交 Input + Candidate，服务端逐条核对 Input 在 DB 里有真行  | ⚠️ 等价效果，但校验逻辑更重，且要求 `evidence_register` 先落库。多一次往返                                                                                                |
| c. Agent 提交 Input + Candidate，照现在这样不核对                     | ❌ **实质偏离 SPEC 24.1**，Agent 可凭空造证据且全部校验通过                                                                                                               |

**推荐 a**，理由：SPEC 24.1 把「提供可验证上下文」的责任写给了 `AssessmentInput` 这个**边界**，而不是写给 Agent；由 Workbench 组装才符合「Agent 不能修改正式状态」（SPEC 25）的同源精神。

**你的选择 →**

---

**决策 3 ── `fs/*` 和 `terminal/*` 给不给 Agent**（侦察 11）

ACP client 侧有 `fs/read_text_file`、`fs/write_text_file`、`terminal/create|output|release|wait_for_exit|kill`。给了就在 MCP 之外开第二条访问路径，与 SPEC 第 13 章「Workbench MCP 是 Agent 访问 Workbench Domain 的唯一正式接口」直接张力。

但 **SPEC 第 27 章要求 Agent 通过 shell 调 `lark-cli`**（「不增加 Feishu MCP Wrapper」）——那正需要 terminal 能力。

**推荐：M1/M2 阶段 `fs/*` 与 `terminal/*` 都不广播**（ACP 允许 client 不广播），并把「不广播」固化成契约测试；到飞书那一轮再单独开 `terminal/*`，且 `fs/*` 永久不给。

**你的选择 →**

---

**决策 4 ── `session/new` 的 `cwd` 给什么**（侦察 12）

ACP 规范里 `cwd` 必填。Workbench 是 local-first 桌面应用，没有「项目目录」概念。给用户数据目录 = Agent 能摸到 SQLite（违反 SPEC 第 5 章 Renderer/进程边界的同源精神）。

**推荐：每个 Agent Run 一个一次性空目录，run 结束即删，且明确不含 Workbench 数据目录。** 决策 3 若采纳（`fs/*` 不广播），这个目录实际不会被读写，只是满足协议必填。

**你的选择 →**

---

**决策 5 ── 写面 tool 的错误返回粒度：34 个 `ASSESSMENT_*` 码原样返还是折叠**（侦察 13）

原样返 → 模型可自纠，收敛快；但把校验器内部结构暴露给 Agent。
折叠 → 信息面小，更贴 SPEC 24「不能用额外布尔位或宽松 DTO 绕过 validation gate」的精神；但模型可能反复撞墙。

**推荐：原样返结构化 `errors[]`，但同时记录自纠轮数。** 理由：这些码本来就是稳定契约的一部分，且 fail-closed 的强制力在服务端不在信息面；自纠轮数会成为下一轮调提示词的直接依据。**若你更保守，选折叠我也照办**——那样 M2 的验收要加一条「模型撞墙几次仍不收敛」的观测。

**你的选择 →**

---

**决策 6 ── methodology runtime 失败时 loopback 还启不启**（侦察 14）

现在 methodology 是**故意允许失败、静默降级**的（`index.ts:90-97` 有明确设计注释），但 `WorkbenchReadCapabilityService` 把 registry 当构造参数强依赖。

**推荐：启。** methodology 挂了就让 `standards_get` 单独 fail-closed，其余 6 个读 tool 照常工作。理由：把「方法论内容读不到」升级成「整个 Agent 功能不可用」是过度耦合，且与既有的静默降级设计意图冲突。

**你的选择 →**

---

**决策 7 ── `evidence_register` 的 contentHash 去重契约**（侦察 15；SPEC 第 22 章要求「去重」但没写怎么算）

需要定：inlineText 要不要规范化（空白 / 换行 / Unicode）、uri 要不要规范化（大小写 / 尾斜杠 / query）、同一 school 内去重还是全局、命中重复是报错还是返回既有 Evidence ID。

**推荐：同一 school 内去重；hash 输入 = `sourceType + 规范化 uri + 规范化 inlineText`；命中重复返回既有 ID 而非报错**（Agent 重复登记同一份材料是正常行为，不该当错误）。规范化规则写进迁移注释与测试。

**你的选择 →**

---

**决策 8 ── codex-acp 怎么引入**（侦察 16）

| 选项                              | 代价                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| 仓库 devDependency + pin 精确版本 | 可复现、可打包；把一个 10 天发 8 版的第三方包写进依赖，需配升级契约测试 |
| 全局预装，discovery 时探测        | 不进仓库；顾问要手动装，且 SPEC 62 的 discovery 要能处理「没装」        |
| 运行时 `npx -y`                   | 不可复现、要网络；**真实产品不可接受**                                  |

**推荐：仓库 devDependency + pin 精确版本（`1.4.0`，不用 caret）+ 一条升级契约测试。** 理由：SPEC 62 明确要求兼容性判定走 contract test 而非硬编码版本，pin + contract test 正好是这句话的落地形态；`npx -y` 在真实产品里不成立。

**你的选择 →**

---

**同时请确认（不是决策，是事实同步）**

**决策 9 ── DSH 推不推后**（侦察 10）：SPEC 第 8 章把 DSH 与 Codex 并列为 V1 首批。DSH 的 ACP 能力站在第三方 `@openma/deepseek-harness-acp@0.4.9`（约 8 star / 47 commit，本机 DSH 本体也未装）；Codex 侧是 `@agentclientprotocol/codex-acp@1.4.0`（ACP 组织自维护，10 天 8 版，正好锁 codex 0.147.0）。**推荐本轮只做 Codex，DSH 作为第二 runtime 推后**——不违反 SPEC（SPEC 说「进 V1 必须满足 ACP+MCP」，没说必须同时上线），但改变落地顺序，需要你确认。**你的选择 →**

---

## 6. 交付物（按 M1 写；M2 / M3 待决策 1 后补）

真实产品代码，进仓库，走正常验收。

| #   | 交付物                                                                                                                             | 关键约束                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/agent-host`（新建，SPEC 65 已给名字）                                                                                    | 只负责 ACP，**不放任何学校业务逻辑**（SPEC 7）。用 `@agentclientprotocol/sdk` 的 `client()` API（**旧 `ClientSideConnection` 已 deprecated，写之前必须实读类型定义，侦察报告承认没读过**）                                                                                                                                                                                  |
| 2   | ACP 生命周期：discovery → spawn → initialize → capability negotiation → session → prompt → status → permission → cancel → teardown | SPEC 7 逐项。`session/update` **对未知事件类型必须 fail-open（忽略并继续）**——否则 codex-acp 每次发版都可能打挂 Workbench，直接关系 SPEC 64「Codex 独立升级」能否成立                                                                                                                                                                                                       |
| 3   | `runtime_profiles` / `agent_sessions` / `agent_runs` 三张表 + 前向迁移                                                             | 六态 `queued/running/needs_input/completed/failed/cancelled`（SPEC 61）。**SQLite Schema 不增加新状态**（SPEC 39）；`needs_input` 的具体原因不进 DB enum                                                                                                                                                                                                                    |
| 4   | Runtime 兼容性判定 `Verified / Compatible / Unsupported`                                                                           | 判据 = `ACP initialize` + required capability + contract test，**不依赖硬编码版本**（SPEC 62）                                                                                                                                                                                                                                                                              |
| 5   | loopback 在 Electron 主进程启动 + `before-quit` 关闭                                                                               | 需先给 `apps/desktop/package.json` 补两个 workspace 依赖；`methodology-runtime.ts:73-84` 现在把 registry 与 repository 关在闭包里，要扩展返回类型（**不许在 index.ts 再造一份，会重复 `syncRegistry`**）                                                                                                                                                                    |
| 6   | MCP 子进程路径解析（开发态 + 打包态）                                                                                              | `electron-vite dev` **不构建 workbench-mcp**，开发态会找不到 `dist/stdio.js`；打包后 asar 内外路径要有回退（可参照既有 `resolveMethodologyPaths()`）                                                                                                                                                                                                                        |
| 7   | MCP 注入可见性验证                                                                                                                 | `session/new` 之后**必须主动验证 tool 列表可见**。`shouldDeduplicateMcpConflicts()` 默认开启（`CodexAcpClient.ts:1252-1255`），顾问 `~/.codex/config.toml` 里若有同名 server，我们注入的会被**静默过滤、零报错**，表现为「Agent 看不到 tool」。server 名必须选一个不可能撞车的；**不许用 `DISABLE_MCP_CONFIG_FILTERING=true` 逃生**（那会让 Codex 深合并两套不兼容 schema） |
| 8   | Agent Bootstrap 注入                                                                                                               | 按 SPEC 第 26 章原文注入，**不许自行改写措辞**                                                                                                                                                                                                                                                                                                                              |
| 9   | 测试                                                                                                                               | 新增单测 + 至少一条 e2e。**e2e 不得依赖真实 Codex 调用**（不可复现、要网络、花钱）——真实 runtime 的验证走手动验收并留记录                                                                                                                                                                                                                                                   |
| 10  | `docs/development/AI_RUNTIME_M1_REPORT.md`                                                                                         | 结论 + 实际跑通的证据 + 未验证项显式标注                                                                                                                                                                                                                                                                                                                                    |

---

## 7. 纪律条款（写进派工简报）

- 实现与预期不符时**不许硬凑，停下报告**
- **不许引入替身**：不许 mock MCP server、不许 stub ACP、不许为了跑通造假 Agent。测试里的 fake 只能出现在单测，且不得成为「跑通」的证据
- **不许走 ACP 以下的通道**：`codex exec`、`codex app-server`、`-c mcp_servers.*` 直塞 config 一律禁止（SPEC 12「不开发第二套 Codex SDK 路径」）
- **不许触碰 Codex 授权面**：不读不写 `~/.codex/auth.json`、不改 `~/.codex/config.toml`、不设 `CODEX_API_KEY` / `OPENAI_API_KEY`、不做登录流程。凭据不通如实报「起不来」并停下
- **不许绕过 assessment 契约**：不得新建第二套宽松 DTO，不得加布尔位跳过 `validateAssessmentCandidate`（SPEC 24）
- **不许暴露 SPEC 25 禁止的能力**：`diagnosis_accept` / `diagnosis_reject` / `state_commit` / `stage_activate`。建议把禁止清单做成**显式 negative 常量 + 测试**，而不是靠「没实现」在挡
- 台账 / 报告里**不写没验证过的数字**；未验证项显式标注
- **不许写会让 git 判为二进制的文件**（上一轮真踩过：测试 helper 里写入裸 NUL 字节，diff 不可见）
- 不改 `engines`（Node 26 的 Unsupported engine WARN 是既有现象）
- `knowledge/` 与两份 `pack.json` 零改动
- 历史迁移不许重写，只许前向追加
- 本地 commit，**不 push**

## 8. 验收（主会话独立复跑，worker 自报数字不采信）

```
pnpm typecheck / lint / format / test / build / test:e2e
```

基线：test 47 files / 174 tests，e2e 8 passed。**新增测试只许往上加，既有数字不许下降。**

另查：审 diff 范围与关键 hunk；`git status` 无意外改动；`knowledge/` 零改动；无二进制 / NUL 文件；迁移 journal 只追加、迁移 SQL 无 `INSERT`；SPEC 25 禁止清单有测试兜底；关键事实断言抽验 ≥ 8 条。

真实 runtime 的验收（手动，主会话亲自做，不采信 worker 截图）：起 `pnpm dev` → 触发一次 Agent Run → 确认 Codex 真的看到并调用了 workbench tool → 确认 `agent_runs` 落了六态中的正确态。

---

## 9. 派工方式

Agent tool，显式 `model: "opus"`。简报写进 scratchpad 文件后 `cat` 进 prompt，自包含：背景、第 5 节你的答案、必须交付、明确不做、不可破坏的不变式、纪律条款、验收命令、答卷格式。

**这份任务书的前提当假设查，不要当事实用。** 上一会话两次抽验都推翻了任务书里的前提；本轮我已推翻侦察报告三处并新发现两条（第 2 节）。worker 若发现第 2 节任何一条不成立，**停下报告，不许绕过**。
