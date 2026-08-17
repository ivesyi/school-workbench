# AI Runtime 接入 · 循环台账

**类型：状态台账（loop 的唯一真源）。不是任务书，不是交接记录。**

配套使用：

- 任务书（范围与决策依据）：`docs/development/AI_RUNTIME_INTEGRATION_BRIEF.md`
- 只读侦察（背景事实）：`docs/development/AI_RUNTIME_SCOUT_REPORT.md`
- 上一轮交接：`docs/development/HANDOFF_2026-08-17.md`

> **台账里的「状态」列必须由真实证据支撑**（git log / 复跑数字 / 实读文件）。
> 任何一轮 loop 都不得凭记忆或凭 worker 自报更新状态列。
> 台账与仓库现实冲突时，**以仓库现实为准**，并当轮修正台账。

---

## 0. 最终目标（完成定义）

把真 AI 按 SPEC 冻结的链路接进来，做到**顾问能在产品里看到真实运行形态**：

```text
Agent Host ── ACP ──> codex-acp ──> Codex
                                      │ MCP stdio（session/new 注入）
                                      ↓
                          school-workbench-mcp（真包）
                                      │ HTTP loopback + 能力令牌
                                      ↓
                          WorkbenchLoopbackReadPlane ──> SQLite
```

**没有替身、没有绕行、没有第二套通路。**

全部三个里程碑通过 = 目标达成 = loop 停止。

---

## 1. 里程碑与状态

| 里程碑                | 内容                                                                                                                                        | 状态                                                                    | 证据                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M0 方法论审核反转** | 默认已审核；顾问标「需要修订」即降回 review 且重启不回滚                                                                                    | **✅ 已完成并合并**                                                     | commit `d33ab47`，已 `--no-ff` 合入 main（零冲突）；主会话复跑 45 files/175 tests、e2e 8 passed；真 app 连开两次验证否决不被 `syncRegistry` 推翻                                                                                           |
| **M1 真链路读通**     | `packages/agent-host` + ACP 生命周期 + 三张表六态 + runtime 兼容性判定 + loopback 在 Electron 里启动 + MCP 注入可见性验证 + Agent Bootstrap | **✅ 已完成（含 B1/B2/B3 修复）**                                       | commit `1e68818` + 修复 `f811881`；合并后主会话复跑 **57 files / 269 tests、e2e 11 passed**；**主会话真 Codex 独立验证共 5 次**，含强制冷启动复现 B3 并确认已修；`standards_get` 在 Pack active 后真正返回内容（真 AI 拿到「实践可见性」） |
| **M2 真链路写通**     | `evidence_register` + `diagnosis_propose` 两个写面 tool（SPEC 22/23/26 要求成对）+ 写 scope + 错误映射 + Workbench 侧组装 `AssessmentInput` | **派工中**（worker `af419e57f9277f43b`，简报 `scratchpad/m2-brief.md`） | 简报第 2 节含必须先解决的核心设计问题：ObservationFact / Claim 的来源                                                                                                                                                                      |
| **M3 产品面**         | PRD 15 设置选默认助手 + PRD 16 高层进度 UI + 工作台触发                                                                                     | **未开始**                                                              | —                                                                                                                                                                                                                                          |

### 各里程碑的验收线（不许修改）

**通用**（每个里程碑都要过）：

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm build && pnpm test:e2e
```

基线：`pnpm test` = **47 files / 174 tests**、`pnpm test:e2e` = **8 passed**（M0 合并后基线变为 **45 files / 175 tests**、e2e **8 passed**）。
**新增测试只许往上加，既有数字不许无理由下降**；下降必须逐条说明并经主会话认可。

另加：审 diff 范围与关键 hunk｜`git status` 无意外改动｜`knowledge/` 零改动（M0 除外）｜**查有无被 git 判为二进制的文件**｜迁移 journal 只追加、迁移 SQL 无 `INSERT`｜SPEC 25 禁止清单有测试兜底｜抽验答卷关键事实断言 **≥ 8 条**。

**M1 额外**：主会话**手动**起 `pnpm dev`，用 worker 给出的步骤验一次真实 Codex（确认它真的看到并调用了 workbench tool、`agent_runs` 落了正确的态）。**worker 自报不采信。**

**M2 额外**：Pack 已 active 时能产出真候选；顾问否决 Pack 后同一条链路必须 fail-closed。

**M3 额外**：手动走一遍「工作台打一句话 → 看到高层进度 → 判断进 HumanReview」。

---

## 2. 已锁定决策（顾问已拍板，loop 不得重开讨论、不得自行改动）

| #   | 决策                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **产品边界止于 ACP**。Codex 的登录/凭据/`config.toml`/内部 session 一律不管、不存、不建 UI（SPEC 12、64）                                                                     |
| L2  | **谁提供 `AssessmentInput`：Workbench 从 SQLite 组装，Agent 只提交 Candidate**（SPEC 24.1「可验证」）                                                                         |
| L3  | **`fs/*` 与 `terminal/*` 在 M1/M2 一律不广播**，并有契约测试锁死；飞书那一轮再单独议 `terminal/*`，`fs/*` 永久不给                                                            |
| L4  | **`session/new` 的 `cwd` = 每 run 一次性空目录，run 结束即删**，绝不是 Workbench 用户数据目录                                                                                 |
| L5  | **写面错误原样返结构化 `errors[]`**（34 个 `ASSESSMENT_*` 码），同时记录自纠轮数                                                                                              |
| L6  | **methodology runtime 失败时 loopback 照常启动**，让 `standards_get` 单独 fail-closed                                                                                         |
| L7  | **`evidence_register` 去重**：同一 school 内；hash 输入 = `sourceType + 规范化 uri + 规范化 inlineText`；命中重复返回既有 ID 而非报错                                         |
| L8  | **codex-acp / ACP SDK pin 精确版本**（`codex-acp@1.4.0`、`@agentclientprotocol/sdk@1.3.0`），**严禁 `npx -y` 运行时拉取**，配升级契约测试                                     |
| L9  | **本轮只做 Codex，DeepSeek Harness 推后**                                                                                                                                     |
| L10 | **方法论默认已审核**（Zero-Maintenance）：Pack 出厂即 `active`，顾问零操作                                                                                                    |
| L11 | **允许 `active → review`**：顾问标「需要修订」→ 降回 review → 下游 fail-closed；改回则恢复                                                                                    |
| L12 | **运行时状态只写 DB，绝不改写 `knowledge/` 下的 `pack.json`**                                                                                                                 |
| L13 | **漂移规则**：上次是 `changes_requested` 的，内容漂移后仍保持 review；从未调整过或上次 `approved` 的，默认 active。**内容变化能让一次「同意」失效，但不能让一次「否决」失效** |

---

## 3. 每轮固定动作

1. **读本台账** → 再读 `git log --oneline -5` 与 `git status --short` → **以仓库现实校正台账**
2. 按第 4 节的状态机决定这一轮干什么
3. 收尾时**更新本台账的状态列与第 5 节工作日志**（只写已验证的事实）

---

## 4. 状态机（每轮只走一条分支）

| 条件                                                             | 动作                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有 worker 正在跑                                                 | **什么都不做**，本轮 noop，等下一轮。**不许并发派同一个里程碑**                                                                                                                             |
| 有 worker 因 API 错误（529 / overloaded / terminated early）中断 | **SendMessage 让它续跑**，不重开新 worker。续跑消息里必须告诉它：被服务端打断不是它的错、当前未提交文件清单、以及打断期间发生的、会影响它基线的变化                                         |
| 有 worker 交了答卷、尚未验收                                     | **在主会话独立验收**（第 1 节验收线全套）。通过 → 本地 commit + 更新台账；不通过 → 把问题写成追加指令 `SendMessage` 发回**原 worker**，不重开新 worker                                      |
| M0 已验收但未合并，且主树无 worker 在跑                          | 合并 worktree 分支。**已知冲突点只有 `pnpm-lock.yaml`**（M0 移除了 `esbuild`，M1 新增 ACP 依赖）→ 合并后重跑 `pnpm install` 再复跑全套验收                                                  |
| 当前里程碑已通过，下一个未开始                                   | 写派工简报到 scratchpad → 派 **opus** worker（Agent tool，显式 `model: "opus"`）。简报必须自包含：背景、第 2 节相关决策、必须交付、明确不做、不可破坏的不变式、纪律条款、验收命令、答卷格式 |
| 三个里程碑全部通过                                               | **停止 loop**，向顾问汇报总结                                                                                                                                                               |
| 撞到第 6 节「只有人能决定」的事项                                | **停止 loop**，把问题摆给顾问，**不许自己猜、不许挑一个默认值继续**                                                                                                                         |

---

## 5. 工作日志（每轮追加，只写已验证事实）

- **2026-08-17** M0 派工（隔离 worktree，opus）→ 交答卷 → 主会话独立验收通过。复跑 45 files/175 tests、e2e 8 passed；`pack.json` 仅 `status` 一行变更；无二进制文件；`drizzle/` 零改动；`review.ts` 纯新增零删除行；`syncRegistry` 已按最新 sign-off 推导状态；`getLatestSignOff` 排序为 `signedAt DESC, id DESC`；自建独立 GUI 探针连开两次真 app，确认否决重启后仍在、页面零内部状态名泄漏。**遗留观感问题两处**（不阻塞）：单选按钮用系统默认蓝未走 primary token；`description == title` 在界面上表现为重复一行。
- **2026-08-17** M1 派工（主工作树，opus）→ 因 API 529 中断 → SendMessage 续跑 → 交答卷（commit `1e68818`）→ 主会话独立验收。复跑 59 files/261 tests、e2e 10 passed；无二进制；`_journal.json` +7−0 纯追加；迁移 SQL 无 INSERT/DROP/ALTER、不触碰 `evidence`/`observation_facts`；MCP server 名无空白；`runtime-compatibility.ts` 无版本字面量；SPEC 25 禁止清单为显式常量；依赖精确 pin 且放置正确；`dev` 脚本已先构建 workbench-mcp。**worker 顶回我简报两处失实前提，均核实成立**（`DATABASE_SCHEMA.md` §11 无字段定义；SPEC 26 在 779 行而非 762-800）。**主会话真 Codex 独立验证 2 次**，链路全程真实打通。

---

## 8. M1 待修缺陷（主会话独立验收发现，worker 未报）

| #   | 缺陷                                                                                                                                                 | 证据                                                                                                                                                                        | 影响                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `session-workspace.ts` 的 `assertIsolated(root, ...)` 对**临时根目录**做重叠校验，导致 userData 只要落在 `os.tmpdir()` 之下，所有 agent run 一律被拒 | 主会话用 `SWB_E2E_USER_DATA_DIR`=mkdtemp(tmpdir) 复现；换到 tmpdir 之外立刻通过                                                                                             | **本仓库全部 e2e 的 userData 都是 `mkdtemp(tmpdir())`**，因此 agent run 路径在整个 e2e 体系里不可达。生产路径（`~/Library/Application Support/…`）不受影响。真正需要的那道校验（对已创建的 `cwd`）已存在且正确 |
| B2  | `tests/e2e/agent-read-plane-startup.spec.ts` 的「no runtime installed」用例**为错误的原因通过**                                                      | 它断言 `failureCode==='AGENT_RUNTIME_UNAVAILABLE'`，而 B1 的守卫先行产出同一个码                                                                                            | 即使 runtime 发现完全正常该用例也会绿，给出虚假信心                                                                                                                                                            |
| B3  | 冷启动时 `WORKBENCH_MCP_STARTUP_FAILED` 误报：run 实际成功（`usedWorkbenchTools=true`、真读到数据）却被记为 `failed`                                 | 主会话第 1 次真 Codex 运行：`status=failed` + `failureCode=WORKBENCH_MCP_STARTUP_FAILED` + `usedWorkbenchTools=true` 同时成立；第 2 次热启动 `completed`/`failureCode=null` | 同一条记录自相矛盾；顾问会看到「失败」但 Agent 其实已经读过数据。worker 曾如实标注该现象「未定量」，主会话现已复现并定性为**误报**，非单纯抖动                                                                 |

**B1/B2/B3 已于 `f811881` 修复并经主会话复验通过**（含强制 `pkill -f "codex app-server"` 冷启动复现：修复前 `failed`，修复后 `completed` / `failureCode=null`，且误报如实记入 stderr 而非静默吞掉）。worker 在修复中自查出两处比主会话报告更深的根因：①被拒的工作区异常会穿透本应永不抛的 `AgentHost.run`；②codex-acp 合成的启动报告被计入 `toolCallTitles`，导致**一次启动失败会把自己算成「server 被用过」的证据**，判据自我满足。

**附带观察（非缺陷，归 M3）**：Agent 返回的 `message` 里混进了 Codex 自己的运行时提示（"Skill descriptions were shortened to fit the skills context budget…"）。PRD 16 要求不向顾问暴露 runtime 噪声，M3 做进度/消息 UI 时需要过滤。

---

## 9. 待顾问决定：方法论接地没有护栏（主会话 2026-08-18 实测发现）

**现象**（真 Codex，合并后实测）：问「Data Wise 里关于『实践可见性』的判断标准要求看什么证据」，Agent **完全没有调用 `standards_get`**，而是上公网抓了 Harvard Data Wise 官网与 ERIC，给出一个听起来很专业的答案，run 记为 `completed`（`usedWorkbenchTools: false`）。

**对照实验**：同一环境下明确要求「使用 standards_get，只用工具返回的内容，不要上网」，则 `usedWorkbenchTools: true`，且正确返回 `data-wise@3` 中 `dimensionKeys=structure` 的准则名「实践可见性」（即 `DW.C2.PRACTICE_VISIBILITY`，与库中映射一致）。

**结论：功能正确，行为无护栏。** 没有任何机制让 Agent 优先用版本化 Pack 而不是公开网络。

**与 SPEC 的关系**：

- SPEC 第 0 章「Methodology Grounds Assessment」：「书籍原文与 RAG 不能直接产生正式评分」
- SPEC 第 26 章冻结的 Agent Bootstrap **只规定了学校状态的来源**（`school_context` / `state_current`），**对方法论/标准的来源一个字都没写**
- Codex 的 web 检索是它自己的内部工具，**不是 ACP client capability，我们无法通过不广播来关闭**（这与 `fs/*`、`terminal/*` 的处理方式不同）

**风险边界（已核实）**：M2 的正式路径仍然 fail-closed —— `validateAssessmentCandidate` 要求 `criterionMappings` 与 `methodologyContext` 精确同键，公网来源的判断成不了正式 Diagnosis。**但对话面不设防**，而 PRD 要求把「依据」呈现给顾问；若依据实际来自公网，就是一次接地泄漏。

**为什么这条必须由顾问决定**（对应第 6 节第 1、3 类）：可行的修法都会碰冻结件或既定边界——

1. 扩写 SPEC 第 26 章 Bootstrap，明确「方法论只能来自 `standards_get`，不得使用外部检索」→ **改 SPEC**
2. 在 M2 的写面 tool 描述里加同等约束 → 不改 SPEC，但只覆盖正式路径，对话面仍不设防
3. 接受现状，仅靠正式路径 fail-closed 兜底 → 需要顾问明确认可这个残余风险

**loop 撞到此条应停机等人，不得自行选择。**

---

## 6. 只有人能决定（撞到就停 loop，不许代答）

1. 需要修改 `docs/architecture/SPEC.md`、`docs/product/PRD.md` 或任何 ADR
2. 需要改动 `knowledge/` 下方法论的**实质内容**（正文/证据要点/维度映射），或需要升 Pack 版本
3. 需要放松第 1 节的验收线、第 2 节的已锁定决策，或任何「不可破坏的不变式」
4. 需要 `git push`、开 PR、部署，或任何对外产生影响的动作
5. 同一里程碑**连续 2 次验收不通过**
6. 发现 SPEC 与 PRD 互相冲突，或发现已锁定决策之间互相冲突
7. 需要引入新的第三方运行时/协议/框架（第 2 节 L8 已定的两个除外）

---

## 7. 反漂移条款（loop 最容易出错的地方）

- **不许为了让循环收敛而缩小范围。** 范围只能由顾问缩，不能由 loop 缩
- **不许改验收线、判分线、基线数字来让结果变绿**
- **不许把「测试通过」当成「功能跑通」**：M1/M2/M3 各自的手动验证是独立要求
- **不许用替身充当跑通证据**（mock MCP server、stub ACP、假 Agent）。测试里的 fake 只能存在于测试
- **worker 自报数字不复跑不采信**
- **任务书/简报/台账的前提当假设查，不当事实用**。本项目已多次出现前提被推翻，抓到前提失实是加分项
- **不许 push**
- 本机 Node 26 vs 仓库 `engines` 24.x 的 `Unsupported engine` WARN 是**既有现象**，不要修

---

## 10. 「顾问起床即可运行」的交付定义（loop 的真正终点）

本轮 loop 的终点**不是「三个里程碑代码写完」，而是「顾问早上打开电脑就能自己跑起来，不需要任何人在旁边解释」**。

### 10.1 完成判据（全部满足才算完）

1. `pnpm dev` 起来后，顾问**在界面上**能选默认 AI 助手（PRD 15）
2. 顾问在工作台**打一句话**就能触发真 Agent（PRD 14，默认不显示 Agent 选择器）
3. Agent 干活时顾问能看到**高层进度**（PRD 16），且**不出现** Shell / Tool JSON / Token / 思维链 / ACP Event / Session ID，也不出现 Codex 自己的运行时提示（例如 "Skill descriptions were shortened…"）
4. 跑完能看到一条**判断**，带支持与相反依据，可以「认同 / 我想改一下 / 不认同」（PRD 17）
5. 上述 1–4 **由 loop 自己用真 Codex 完整走通一遍并留下证据**，不是「测试通过所以应该能用」
6. 仓库里有一份 `docs/development/HOW_TO_RUN.md`，**白话写给顾问看**：怎么起、点哪里、会看到什么、出问题了怎么办。**不许写 ACP / MCP / loopback / scope 这类词**

### 10.2 如果中途卡住

**产品必须停在「能跑」的状态**，不许留下一个起不来的应用。

若因第 6 节的「只有人能决定」而停机，仍要：

- 把当前**确实能用**的部分写进 `HOW_TO_RUN.md`
- 在本节末尾追加一段「顾问起床后需要先定什么」，一句话说清卡在哪、为什么只能由人定

### 10.3 当前进度快照（loop 每轮更新）

- M0 ✅ 已合并 · M1 ✅ 已完成 · M2 派工中 · M3 未开始
- **今天顾问还不能自己跑**：产品里没有 AI 入口，所有验证都是主会话用脚本驱动的
- `HOW_TO_RUN.md` **尚不存在**
