# AI Runtime M3 — 产品面（顾问自己能跑起来）

> **⚠️ 2026-08-18 主会话更正（本文以下内容有一部分已经作废，保留作历史记录）**
>
> 顾问当日拍板：**Agent 是产品必需能力，不存在「不使用 AI 也能完整工作」的产品模式**。因此本报告第 1 节整节（「确定性引擎与真 Agent 怎么共存」「助手优先，工作台兜底」「默认关闭」）**已被推翻并从代码里删除**：
>
> - `BaselineAssessmentEngine`、`createProposalChain`、`JudgmentRepository.saveProposalChain`、`judgments:submit-situation` 全部删除；
> - `DEFAULT_ASSISTANT` 改为 `codex`，助手选项里不再有「暂不使用 AI 助手」；
> - 助手不可用 / 失败 / 弃权时，工作台**不再**替它整理一条待确认判断——分别是「不能开始新的分析」「保留原文 + 重试」「目前依据不足，暂不形成判断」。
>
> 第 4 节的验收数字也已被更高的一轮取代（Node 24.19.0 下 70 files / 375 tests、e2e 16 passed）。第 8 节「没有用真 Codex 从界面走一遍」已由主会话补齐，证据见 `AI_RUNTIME_LOOP_LEDGER.md` §11。
>
> 仍然成立的部分：第 2 节文件清单（作为当时的改动记录）、6.1 偏好存哪、6.2 进度不落库、6.3 不过滤助手原文而是根本不传、6.4 助手提案走既有审核 UI。6.5「兜底为什么放在 renderer」随兜底一起作废。

**日期：2026-08-18**
**基线提交：`e82ae03`**
**范围：PRD 15 设置选默认助手 + PRD 14 工作台触发 + PRD 16 高层进度 + PRD 17 判断确认 + 起步指南**

---

## 1. 核心产品问题：确定性引擎与真 Agent 怎么共存

### 1.1 先看清两条路各是什么

`BaselineAssessmentEngine.analyze()`（`judgment-service.ts:24-47`）是一个**模板**：标题固定「一个新的情况」，claim 是 `当前有迹象表明：<原文>`，`provisionalJudgment` **就是顾问自己那句话**。它不分析，它**结构化地记录**。

真 Agent 则读学校正式状态、取版本化准则、登记依据、提交有准则编号的判断。

所以这不是同一件事的两种实现，而是**两种深度**：一个是「把你说的话记成待确认判断」，一个是「基于这所学校的资料和方法论形成判断」。

### 1.2 选择：助手优先，工作台兜底，一句话只产生一条待确认判断

```text
顾问说一句话
      │
      ├─ 选了助手且这台电脑上能启动 ──> 交给助手（显示高层进度）
      │        │
      │        ├─ 助手给出判断 ──> 显示这条判断，结束
      │        └─ 没给出 / 失败 ──┐
      │                            │
      └─ 没选助手 ─────────────────┴──> 工作台自己记录这句话，显示待确认判断
```

**理由**：

1. **PRD 的心智模型本来就是这样**。PRD 14 只有一个输入框和一个按钮；PRD 16 专门规定 Agent 干活时显示什么；PRD 17 规定跑完呈现一条判断。确定性引擎在 PRD 里根本没有出现——它是 Agent 还不存在时搭的脚手架。
2. **不做选择题**。PRD 14「默认不显示 Agent 选择器」、PRD 52「能直接完成的不让用户选择」。顾问只按一个「提交情况」，走哪条路由设置里那个一次性选择决定。
3. **一句话只产生一条待确认判断**。两条路是**顺序**而非并行的：助手给出判断就不再走工作台，否则才走。绝不会一句话冒出两条待确认判断。
4. **顾问的话永远不丢**。助手没形成判断、或者压根没跑成，工作台仍然把这句话记成待确认判断——「说情况」是 PRD 4.1 的核心动作，不能因为 AI 不给力就丢掉。
5. **失败不卡死**。助手侧有 5 分钟上限，超时即中止并走兜底；助手抛异常也走兜底。界面上永远不会停在一个转不完的圈里。

### 1.3 默认关闭，第一次在设置里选

`DEFAULT_ASSISTANT = 'none'`。

PRD 15 明写「用户在**设置**中选择默认 AI 助手」，它把这当成一次真实的选择，而不是产品替人做的技术决定——因为它确实是：用助手意味着**每句话等半分钟到两分钟、并且花钱**。出厂就打开，等于顾问第一次打字就在毫不知情的情况下同时承担了这两件事。

选一次之后 PRD 14 生效：日常再也不问。

副作用（正面的）：全新安装第一次打开就是瞬间响应的，现有 12 条 e2e 也不会意外触发真 Codex。

---

## 2. 改动文件清单

**新增**

| 文件                                                                         | 内容                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/shared/src/preferences.ts`                                         | 助手选项/可用性/设置视图/IPC 通道；冻结的偏好键清单 |
| `packages/db/src/preferences-schema.ts` + `sqlite-preferences-repository.ts` | `app_preferences` 键值表与读写                      |
| `packages/db/drizzle/0010_app_preferences.sql` + `meta/0010_snapshot.json`   | 一条 `CREATE TABLE`，无 `INSERT`                    |
| `apps/desktop/src/main/settings-ipc.ts`                                      | 默认助手的读取/保存/可用性描述                      |
| `apps/desktop/src/renderer/features/schools/assistant-flow.ts`               | PRD 16 四句进度文案、是否该问助手、助手没成时说什么 |
| `docs/development/HOW_TO_RUN.md`                                             | 给顾问的起步指南                                    |
| 7 个测试文件 + 1 条 e2e                                                      | 见第 3 节                                           |

**修改**

| 文件                                                                   | 改了什么                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/shared/src/agent.ts`                                         | `AgentRunView` 去掉原始 `message`，改为 `outcome` + `proposal`；新增进度事件与 `agent:progress` 通道 |
| `packages/shared/src/judgments.ts`                                     | 审核视图增加 `counterFacts`（PRD 17「有 N 条相反迹象」）与 `source`                                  |
| `packages/shared/src/api.ts`                                           | `WorkbenchApi` 正式纳入 `settings` 与 `agent`（M2 的 `AgentBridge` 旁路随之删除）                    |
| `packages/domain/src/judgment.ts`                                      | `JudgmentRepository` 增加「取待确认提案链」「按 Agent Run 找提案」                                   |
| `packages/db/src/sqlite-judgment-repository.ts`                        | 实现上述两个查询；已被审核过的提案不再返回                                                           |
| `packages/application/src/judgment-service.ts`                         | `findAgentRunOutcome`：把助手提案渲染成**同一套**审核视图；区分「有判断 / 依据不足 / 什么都没有」    |
| `packages/agent-host/src/agent-host.ts`、`permission-policy.ts`        | 新增 `onWorkbenchToolCall` 钩子与 `workbenchToolName()`（见第 6 节说明）                             |
| `apps/desktop/src/main/agent-runtime.ts`                               | 进度阶段推导、5 分钟上限、取回助手提案、**不再把助手原文交出来**、`assistantReadiness()`             |
| `apps/desktop/src/main/index.ts`                                       | 接偏好仓储、设置 IPC、进度广播                                                                       |
| `apps/desktop/src/preload/index.ts`                                    | 暴露 `settings.*` 与 `agent.onProgress`（入站事件同样校验）                                          |
| `apps/desktop/src/renderer/features/settings/settings-page.tsx`        | 占位换成真的助手选择                                                                                 |
| `apps/desktop/src/renderer/features/schools/school-workspace-page.tsx` | 助手优先流程、进度条、相反依据、来源标注                                                             |
| 5 个既有测试                                                           | 跟随新的契约字段与 `WorkbenchApi`                                                                    |

---

## 3. 新增/修改的测试

| 测试                                    | 覆盖                                                                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant-flow.test.ts`                | PRD 16 四句文案逐字；**所有面向顾问的句子扫一遍禁用词**（ACP/MCP/token/Session/Skill descriptions/表名…）；每种「没给出判断」都告诉顾问话被记下了；抽象弃权与「无话可说」区分开；没读到设置前绝不问助手                                                                     |
| `settings-ipc.test.ts`                  | 默认关闭；只提供真实存在的助手；选择被记住；未知值被拒；坏数据回落默认；不可用时的说明**不含技术词**；不可用时仍能选「暂不使用」                                                                                                                                            |
| `agent-runtime.test.ts`                 | 进度按真实 tool 调用推进、**只前进不后退**、非工作台 tool 一律忽略；结果分类（有提案即使 run 结束状态不好也算数）；可用性判断的措辞不含包名                                                                                                                                 |
| `school-workspace-assistant.test.tsx`   | 选了助手→走助手→显示它的判断且**不再走确定性引擎**；显示「有 1 条相反迹象」与来源标注；仍然要人点「认同」；别校的进度事件不串台；助手无判断→兜底且话不丢；**助手失败时页面上不出现 `SWB_CODEX_ACP_ENTRY` / `node_modules` / `RUNTIME_NOT_FOUND` / runId**；IPC 抛异常也兜底 |
| `settings-assistant.test.tsx`           | 设置页能选能记住；不可用时说人话；**整页扫禁用词**；「都要你确认之后才会进入正式记录」在页面上                                                                                                                                                                              |
| `sqlite-preferences-repository.test.ts` | 未设置与已设置可区分；同键只有一行；**重启后仍在**；迁移只建表不塞数据                                                                                                                                                                                                      |
| `assistant-proposal-review.test.ts`     | 助手提案**经既有审核路径**变成正式判断；相反依据一路带到视图；未确认前 `accepted_judgments` 为空；审核过就从待确认里消失；弃权不给「认同」；跨校拿不到；没提交过的 run 返回「什么都没有」                                                                                   |
| `how-to-run.test.ts`                    | 指南里**不出现**任何工程术语（含 `\bnpm\b` 单独判定，因为 `pnpm dev` 必须出现）                                                                                                                                                                                             |
| `tests/e2e/assistant-settings.spec.ts`  | 真 Electron：默认关闭 → 选 Codex → **重启后仍是 Codex**；助手失败时页面出现人话说明、判断卡片照常出现、**整页扫禁用词**、点「认同」能落成正式判断                                                                                                                           |

---

## 4. 验收数字

| 命令             | 基线（`e82ae03`）    | 现在                                              |
| ---------------- | -------------------- | ------------------------------------------------- |
| `pnpm typecheck` | 通过                 | 通过（0 error）                                   |
| `pnpm lint`      | 通过                 | 通过（No issues found）                           |
| `pnpm format`    | 通过                 | 通过（All matched files use Prettier code style） |
| `pnpm test`      | 60 files / 300 tests | **68 files / 346 tests**                          |
| `pnpm build`     | 通过                 | 通过                                              |
| `pnpm test:e2e`  | 12 passed            | **14 passed**                                     |

迁移卫生：`_journal.json` **+7 −0** 纯追加；`0010` 只有一条 `CREATE TABLE`，无 `INSERT`。`knowledge/` 零改动。无被 git 判为二进制的文件。

---

## 5. 我自己起真应用肉眼确认了什么

两次真实启动（`pnpm build` 后用真 Electron 起，临时数据目录），截图在 scratchpad（**未提交仓库**，PNG 会被 git 判为二进制）：

`…/scratchpad/shots/`

| 截图                            | 我看到的                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `1-settings-before.png`         | 设置页出现「默认 AI 助手」，两个选项，下面写着「目前没有使用 AI 助手」                                                                       |
| `2-settings-after.png`          | 点 Codex 后单选变绿（走的是 primary 色，不是系统默认蓝）、选中项高亮、「目前没有使用 AI 助手」消失；整页无一个技术词；底部「你的判断说了算」 |
| `3-workbench-assistant-on.png`  | 工作台输入框下方提示「AI 助手会先看一遍这所学校的情况，可能需要一会儿。」                                                                    |
| `4-workbench-assistant-off.png` | 改回「暂不使用」后，同一位置变成「你可以在设置里让 AI 助手参与进来。」                                                                       |
| `5-judgment-card.png`           | 不用 AI 时，提交情况后判断卡片照常出现，四个按钮齐全                                                                                         |
| `6-progress.png`                | **助手运行中**：按钮变「正在整理…」，下方出现进度条「✨ 正在理解学校现在的情况……」                                                           |
| `7-fallback.png`                | 助手失败后：出现「AI 助手」提示条「AI 助手这次没能完成。我先把你说的这条记下来了，可以过一会儿再试。」，下面照常是可确认的判断卡片           |

第二次启动用了一个**真实存在但不是 Agent** 的入口点，所以 run 一路走到握手才失败——不花钱，但走的是完整的真实链路（真设置、真 IPC、真 Agent Host、真兜底）。

对第 7 张的页面文字做了整页扫描：`ACP / MCP / stdio / loopback / token / scope / SWB_ / node_modules / inert.js / Session / RUNTIME_NOT_FOUND / AGENT_RUN_FAILED` **一个都没有**；技术原因只出现在终端 stderr（`agent run failed: AGENT_RUN_FAILED`）。

**没有用真 Codex 跑过**——见第 8 节。

---

## 6. 关键设计决定与理由

### 6.1 偏好存哪：新建 `app_preferences`，不是 `runtime_profiles`

`runtime_profiles` 记的是**工作台知道怎么驱动哪些运行时**，那是发现出来的事实；把人的偏好塞进去，意味着以后每加一个运行时，那一行都要带着一个「是不是默认」的列，而「默认」在多行之间还得互斥。

`app_preferences(key, value, updated_at)` 是键值表：PRD 44/46 明显预期设置页会长，一个偏好一列意味着每加一个设置就要改一次表结构。

**防止它变成垃圾场**：键不是开放的。`preferenceKeys` 在 shared 里冻结，值由各自的 zod 契约校验（`assistantChoiceSchema`），主进程读到不认识的值直接回落默认。加一个偏好仍然是一次需要评审的显式编辑，只是不需要动表。

### 6.2 进度状态怎么表达而不做成第三副本

**它根本不落库。**

- 数据库里只有 `agent_runs.status` 的六态（SPEC 61），一个字没加
- 进度阶段是**从已经在观察的 tool 调用推导出来的**：Agent Host 已经在解析 `session/update` 里的 tool call，M3 只是把「这是工作台的哪个工具」这个已知信息通过回调交出来
- 阶段值只存在于两个地方：主进程 `runAgentOnce` 里的一个局部变量，和 renderer 的一个 React state。run 结束就没了

所以没有第三份持久状态，SPEC 39「具体原因不进数据库 enum」自然满足——**根本没有任何东西被写下来**。

两个额外约束：**只前进不后退**（助手中途回头再读一次学校，文案不会倒退），**只认工作台自己的工具**（`workbenchToolName()` 锚定 MCP 服务器名并排除启动诊断，所以助手自己上网搜、跑命令，都不会被翻译成任何一句进度）。

### 6.3 原始回复怎么过滤：不过滤，直接不要

助手的原文里混着运行时对自己说的话（"Skill descriptions were shortened…"）。做关键词过滤等于跟一个会变的噪声源赛跑。

所以 `AgentRunView` **删掉了 `message` 字段**：助手的散文根本不跨过 IPC 边界。产品面留下的是它**通过正规渠道提交的那条判断**——那是结构化的、有依据的、可审核的。

顾问看到的只有两类文字：那条判断（来自数据库里的提案行），以及工作台自己写的几句说明（`assistant-flow.ts` 里那几条，有测试扫禁用词）。

失败原因也一样：`failureMessage` 里可能有路径，它只进 stderr 给维护者看；界面上按 `failureCode` 映射成人话。有测试断言页面上不出现它。

### 6.4 助手提案走既有审核 UI，没有第二套

助手的提案和确定性引擎的提案落**同一张 `diagnosis_proposals` 表**，只是多了 `agent_run_id`。`JudgmentService.findAgentRunOutcome` 把它渲染成**同一个 `JudgmentReviewView`**，工作台用**同一个组件**渲染，确认走**同一个 `judgments.review`**。

差异只有两处，且都是产品语义而非技术：`source: 'assistant'` 让卡片多一行「这条是 AI 助手看过这所学校的情况后整理的，仍然要你确认才算数」，以及 `counterFacts` 让 PRD 17 的「有 N 条相反迹象」有内容可显示。

已经被审核过的提案不再从这条路返回——待确认区只放还没决定的东西。

### 6.5 兜底为什么放在 renderer

要不要退回工作台自己记录，是一个**体验决定**（PRD 4.1 的「说情况」不能因为 AI 不给力就失效），不是协议决定。放在 renderer 让 `agent:run` 保持只做一件事，也让这条策略能被组件测试直接盯住。真正的判断逻辑抽在 `assistant-flow.ts` 里，是纯函数，单独测。

---

## 7. 我发现简报/PRD 里不成立的前提

1. **简报 2.1 说占位在 `settings-page.tsx:24-33`——实际是 24-33 行没错，但它描述的「AI 助手 / 将在后续 Runtime 阶段接入 / 尚未启用」三段文字里，「尚未启用」在第 32 行、`CircleDashed` 在第 30 行**，行号本身对得上，无实质出入。（复核通过，仅记录已核。）
2. **简报 2.4 说「Agent 的提案落的是同一张 `diagnosis_proposals` 表，只是多了 `agent_run_id`」——属实**，但没提到一个关键差异：确定性引擎的审核视图是 `submitSituation` **当场在内存里构造**的（`toReviewView(chain)`），而助手的提案只在数据库里。要复用既有审核 UI，必须新增「从持久化提案重建审核视图」的查询——这不是接线，是新代码。已实现（`findPendingProposalReview`）。
3. **PRD 17 要求显示「有 1 条相反迹象」，但既有 `JudgmentReviewView` 里没有任何地方能装相反依据**（只有一个 `facts[]`）。确定性引擎从不产生相反事实，所以这个缺口一直没暴露；助手会产生。已加 `counterFacts`。
4. **`diagnosisProposalViewSchema.status` 是 `z.literal('proposed')`、`provisionalJudgment` 非空**，所以 `insufficient_evidence` 的助手提案**在类型上就无法进入审核视图**。这其实是对的（SPEC 禁止接受弃权），但意味着「助手说依据不够」必须走另一条表达路径，而不是塞进同一张卡片。已按「有判断 / 依据不足 / 什么都没有」三分处理。
5. **台账 §10.3 的两条快照当时是真的、现在已过时**（「今天顾问还不能自己跑」「`HOW_TO_RUN.md` 尚不存在」）。已按台账自身「每轮更新」的要求改写。

---

## 8. 未验证 / 我没做到的

- **没有用真 Codex 从界面走一遍**。前两轮简报都明令我不许花钱跑真 Codex，本轮简报没有重复这条禁令，但也把真 Codex 验收写在了「主会话会怎么验收」里（§8）。我判断不该自行改变这个惯例去花顾问的钱，所以只做到了「用一个真实但不是 Agent 的入口点走完整链路」。**因此以下四件事只有单元/组件级证据，没有真 Codex 证据**：
  - 四句进度文案随真实 tool 调用依次推进（我只肉眼确认了第一句「正在理解学校现在的情况……」真的出现在真应用里，因为它在 run 一开始就发出）
  - 助手真的产出一条判断并渲染进审核卡片（组件测试覆盖，真应用未验）
  - 真 Codex 一轮的耗时是否落在 5 分钟上限内（实测数据来自主会话的 13–107 秒，上限是据此设的，未在真 app 里触发过超时）
  - 助手判断被「认同」后落成正式判断（数据层测试覆盖了完整链路，UI 层未用真 Codex 验）
- **进度只有四个阶段，且只在工作台工具被调用时推进**。真 Codex 若长时间只做自己的事（思考、上网），界面会停在上一句不动。没有做「已经等了多久」之类的提示。
- **没有做取消按钮**。跑起来只能等，最长 5 分钟。Agent Host 支持取消（M1 就有），但把它接到界面上超出本单范围。
- **没有做 PRD 15 的「··· 本次改用其他 AI 助手」临时切换**——简报 2.1 明确说只有一个 runtime 时可以先不做。
- **`app_preferences` 目前只有一个键**。它是按「以后会长」设计的，但这个判断尚未被第二个偏好检验过。
- **助手不可用的判断只看这台电脑上有没有装好东西**，不看 Codex 有没有登录（登录状态属于 Codex 自己的授权面，产品边界止于 ACP）。所以「已就绪」但一登录就失败是可能的，此时走的是失败兜底，界面提示「AI 助手这次没能完成」，指南里也写了 `codex login`。
- **未做**：飞书、DeepSeek Harness、教师实践页面、打包签名与自动更新。
