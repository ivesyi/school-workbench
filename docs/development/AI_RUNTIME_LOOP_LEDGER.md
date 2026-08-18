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

| 里程碑                | 内容                                                                                                                                        | 状态                                 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 方法论审核反转** | 默认已审核；顾问标「需要修订」即降回 review 且重启不回滚                                                                                    | **✅ 已完成并合并**                  | commit `d33ab47`，已 `--no-ff` 合入 main（零冲突）；主会话复跑 45 files/175 tests、e2e 8 passed；真 app 连开两次验证否决不被 `syncRegistry` 推翻                                                                                                                                                                                                                                                                           |
| **M1 真链路读通**     | `packages/agent-host` + ACP 生命周期 + 三张表六态 + runtime 兼容性判定 + loopback 在 Electron 里启动 + MCP 注入可见性验证 + Agent Bootstrap | **✅ 已完成（含 B1/B2/B3 修复）**    | commit `1e68818` + 修复 `f811881`；合并后主会话复跑 **57 files / 269 tests、e2e 11 passed**；**主会话真 Codex 独立验证共 5 次**，含强制冷启动复现 B3 并确认已修；`standards_get` 在 Pack active 后真正返回内容（真 AI 拿到「实践可见性」）                                                                                                                                                                                 |
| **M2 真链路写通**     | `evidence_register` + `diagnosis_propose` 两个写面 tool（SPEC 22/23/26 要求成对）+ 写 scope + 错误映射 + Workbench 侧组装 `AssessmentInput` | **✅ 已完成**                        | commit `8114f2a`；主会话复跑 **60 files / 300 tests、e2e 12 passed**；**主会话真 Codex 完整走通一轮**：读状态→取准则→主动找反证→登记依据→提交判断，落库 evidence/facts×3/claims×2/proposal(`proposed`)，引用真实准则 `data-wise@3 DW.C2.PRACTICE_VISIBILITY`，自纠 0 轮；Agent 提案**未**变成正式判断；**否决权端到端验证**：界面标「需要修订」→ Codex 拿到 `no_active_pack/persisted_not_active` 后停手、不换准则、不提交 |
| **M3 产品面**         | PRD 15 设置选默认助手 + PRD 16 高层进度 UI + 工作台触发 + PRD 17 判断确认 + PRD 18 判断详情 + `HOW_TO_RUN.md`                               | **✅ 已完成（含伪 Agent 兜底清除）** | 主会话在 Node 24.19.0 + pnpm 11.19.0 下复跑 **70 files / 375 tests、e2e 16 passed**、typecheck/lint/format/build 全绿；**真 Codex 从界面完整走通一遍**（详见 §11）：读学校 → 登记 3 份既有材料 + 7 条 Fact + 2 条 Claim（含 counter stance）→ 自纠 1 轮 → 提交引用 `data-wise@3 DW.C2.PRACTICE_VISIBILITY` 的 `proposed` Proposal → 进 HumanReview → 顾问点「认同」前 `accepted_judgments` 只有 2 条种子、点完变 3 条      |

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

**M3 额外**：手动走一遍「工作台打一句话 → 看到高层进度 → 判断进 HumanReview」。**Agent 合理弃权时不许用兜底伪造通过**——补真材料重跑，或如实记为受阻。

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
- **2026-08-18** M3 主会话验收 + **伪 Agent 兜底清除**（顾问指令：Agent 是产品必需能力，不存在「不用 AI 也能完整工作」的模式）。删除 `BaselineAssessmentEngine` / `createProposalChain` / `JudgmentRepository.saveProposalChain` / `judgments:submit-situation` 整条非严格链路；助手选项去掉「暂不使用」，默认 Codex，旧存 `none` 安全回落；助手不可用 → 输入框禁用 + 「现在还不能开始新的分析」，失败 → 保留原文 + 「重试」，弃权 → 「目前依据不足，暂不形成判断」+ 下一步观察，三者都**不再产生任何判断**；审核详情补齐 PRD 18 全部条目 + 依据出处 + 阶段目标 + 版本化准则；「我想改一下」现在同时保存顾问反馈与最终文本。新增架构测试锁死「只有 `GroundedDiagnosisService` 能创建 Proposal」。复跑 70 files/375 tests、e2e 16 passed（Node 24.19.0）。**真 Codex 端到端验收通过**（§11）。
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

- M0 ✅ 已合并 · M1 ✅ · M2 ✅ · M3 ✅（真 Codex 验收通过）
- 产品里的 AI 不再是「入口」，而是**唯一**的分析通路：工作台打一句话交给 Codex，跑的时候有高层进度，跑完的判断带完整依据与出处进审核卡片，顾问点头才算数
- `HOW_TO_RUN.md` 已按新事实改写（不再声称「不用 AI 也能完整使用」，不再声称数据绝不离开本机）
- **10.1 判据 1–6 全部满足**，判据 5 的真 Codex 证据见 §11
- **从零起步已通**：新建学校可以说一句话 → Agent 用 `stage_propose` 提议首个阶段 → 顾问确认 → 开始真实分析（§12.1）

---

## 11. M3 真 Codex 验收记录（主会话，2026-08-18）

**怎么跑的**：`pnpm build` 后用真 Electron（临时 userData）起，全程走界面。学校历史（2 条已确认判断 + 3 份既有材料 / 5 条 Fact）**直接写进 SQLite**——原因见 §12：产品现在没有别的办法造出这个起点。阶段是在真界面上点「基本对」确认的。

**看到的**：

| 环节           | 证据                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置           | 「默认 AI 助手 · Codex」已选中，页面上没有「暂不使用」                                                                                                   |
| 触发           | 输入框打一段话 → 「提交情况」                                                                                                                            |
| 进度           | 界面出现「正在理解学校现在的情况……」，全程无 Shell / Tool JSON / Token / 思维链 / Session ID / Codex 自己的运行时提示                                    |
| Agent 读       | `agent_runs.status = completed`，`agent_sessions` 记 `codex-acp@1.4.0`、`compatibility = verified`、protocol 1                                           |
| Agent 找反证   | 2 条 Claim 共 9 条 `claim_facts`，其中 2 条 stance = `counter`                                                                                           |
| Agent 写       | `evidence` 3 条 `registered_by = agent`、`observation_facts` 7 条、`claims` 2 条，全部带 `agent_run_id`                                                  |
| 严格校验       | `self_correction_rounds = 1`——第一版候选被 `ASSESSMENT_*` 拒了一次，Agent 自纠后才通过。**契约确实在挡**                                                 |
| 判断落库       | `diagnosis_proposals` 1 条 `status = proposed`，`diagnosis_criteria` = `data-wise@3 / DW.C2.PRACTICE_VISIBILITY`，`diagnosis_stage_targets` 3 条         |
| 进 HumanReview | 卡片显示「依据 3 条 · 有 2 条相反迹象」；展开后 PRD 18 的八个栏目齐全，另有建议行动、验证方式、以及出处（学校 / 阶段 / 三条阶段目标 / 准则名 + 第 3 版） |
| 顾问权         | 点「认同」**之前** `accepted_judgments` = 2（只有种子），点完 = 3                                                                                        |

耗时：一轮 3 分 44 秒（05:28:49 → 05:32:33）。

**没验到的一条**：四句进度文案里，只肉眼确认了第一句真的出现在界面上；这一轮的完整推进序列没有被记录下来（脚本收集了但输出被截断）。**已于同日补跑，见 §11.1。**

**观感小瑕疵**（不阻塞）：准则那一行渲染成「实践可见性（Data Wise … 第 3 版）：实践可见性」——Pack 里 `title` 与 `description` 同文，是 M0 就记过的老问题。

---

## 11.1 补验：四句进度文案的真实推进序列（主会话，2026-08-18，顾问批准补跑）

第二次真 Codex 运行，只为把 §11 缺的那条补上。全套原始证据落盘在
`docs/development/evidence/2026-08-18-m3-progress/`（含该目录的 `README.md`）。

**怎么抓的**：在 renderer 里挂第二个 `agent.onProgress` 订阅者，记主进程**实际广播**的事件；同时每 400ms 读一次页面可见文本，
只在那一行变化时记一条，记的是**顾问真正看到的**。两路都实时 append 到文件，不再依赖终端输出。工具调用侧则从 Codex 自己的
session rollout 日志按 ACP session id 取回全量，再用 `nextProgressPhase` 重放判定。

**序列原文**（`progress-timeline.log`）：

```text
submit at 2026-08-18T06:04:28.846Z
SCREEN 2026-08-18T06:04:28.883Z  正在理解学校现在的情况……
IPC    2026-08-18T06:04:28.887Z  phase=understanding
SCREEN 2026-08-18T06:04:46.471Z  正在比较最近变化……
IPC    2026-08-18T06:04:46.238Z  phase=comparing
SCREEN 2026-08-18T06:05:41.801Z  正在整理需要你确认的判断……
IPC    2026-08-18T06:05:41.680Z  phase=drafting
SCREEN 2026-08-18T06:09:25.742Z  (进度条已消失)
```

**三条待验项的结论**：

| 待验项               | 结论                   | 证据                                                                                                                                                                                                                 |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 四句按序出现         | **否——这轮只出现三句** | `gathering`（正在寻找相关材料……）被跳过：Codex 首批工作台调用 `state_current` + `school_context` 同批到达，`state_current` 先把阶段推到 `comparing`；8 秒后才调 `evidence_list` / `diagnosis_list`，被「只前进」挡掉 |
| 只前进不后退         | **是**                 | `school_context`、`stage_current`、`evidence_list`/`diagnosis_list`、47 次 `standards_get`、`diagnosis_propose` 全部在更晚时刻到达，文案一次未回退。逐行判定见 `agent-tool-calls.log`                                |
| 只认工作台自己的工具 | **是**                 | 87 次工具调用中 21 次非工作台（Codex 自有 `exec` 19 + `wait` 1 + **Codex 内建 MCP server 的 `codex.list_mcp_resources` 1**），零进度事件。最后这条是真 MCP 调用，被 server 名锚定挡住，最有说服力                    |

**这条要改口径**：PRD 16 列的是**允许显示的四句话**，不是保证依次走一遍的四拍。`HOW_TO_RUN.md` 里那段四行文案已相应改成
「按它实际在做的事显示其中几句」，不再暗示四句都会出现。台账 §10.1 判据 3 仍然满足（顾问确实看到高层进度，且全程无技术噪声）。

**这一轮同时复现了 §11 的全链路**（不是同一份数据，可作独立第二样本）：`agent_runs.status = completed`、
`self_correction_rounds = 1`、Agent 登记 3 份材料 / 7 条 Fact / 11 条 `claim_facts`（其中 4 条 `counter`）、
提交的 Proposal 引用 **`schooling-by-design@1 / SBD.C4.SYSTEM_ALIGNMENT`**（与上轮的 `data-wise@3` 不同，说明准则不是写死的）、
顾问点「认同」前 `accepted_judgments` = 2、点完 = 3。耗时 4 分 57 秒。

**顺带记下、不阻塞**：`standards_get` 在 06:06:34–06:07:24 被连调 47 次且全部返回错误，之后才成功两次；`diagnosis_propose`
被契约拒过一次。功能正确但 Agent 在参数上摸索代价不小，工具描述值得后续看一眼。

---

## 12. 新增待顾问决定：新建学校起不了步（主会话 2026-08-18 发现）

**现象**：删掉确定性兜底之后，一所**全新**学校永远拿不到第一条判断。

**链条**（都已实读核实）：

1. `SqliteWritePlaneRepository.buildAssessmentInput` 在没有 active Stage 时直接 `READ_STALE` fail-closed；有 Stage 但没有 confirmed Target 同样 fail-closed。
2. `validateAssessmentCandidate` 对 `proposed` 候选强制 `ASSESSMENT_PROPOSED_STAGE_TARGET_REQUIRED`。
3. active Stage 只能由 `StageService.getWorkspace` 从**已确认判断**推出建议、再由顾问确认而来；`BaselineStageRecommendationEngine` 在判断数为 0 时直接抛错。

→ 没有判断就没有阶段，没有阶段就产不出判断。

**为什么必须由顾问定**（撞第 6 节第 1、6 类）：

- PRD 11 写的是「如果学校没有当前阶段，**Agent** 根据已有情况提议」——按 PRD，阶段本来就该由 Agent 提；
- 但 SPEC 18 冻结的 Workbench MCP 工具清单里**没有**任何能让 Agent 提阶段的写面工具；
- 现在这套「工作台用正则分类已确认判断来推阶段」（`BaselineStageRecommendationEngine`）本身也是一处**伪 Agent 专业推理**，与本轮「工作台不冒充 Agent」的决策同源，只是不在本轮指定范围内。

三条可走的路，都碰冻结件：

1. 扩 SPEC 18 加一个阶段提议写面工具，把 PRD 11 落实 → **改 SPEC**；
2. 承认工作台可以在没有判断时给一个「起步阶段」，明确它是脚手架不是专业判断 → 改 PRD 12 的边界；
3. 接受现状：产品只服务「已经有历史数据」的学校，新建学校必须先由维护者灌入起点 → 需要顾问明确认可。

**之前的状态**：`HOW_TO_RUN.md` 的「建一所学校 → 说一条情况」这条路径，对**全新**学校是走不通的（写面 `buildAssessmentInput` 在没有 active Stage 时直接 `READ_STALE` fail-closed，Agent 连弃权都提交不了，界面上表现为「这次没有形成需要你确认的新判断」）。真 Codex 验收（§11、§11.1）用的都是灌了历史的学校。指南当时同步了「卡的是阶段不是材料」的说明，但缺口本身未修。

### 12.1 已解决：Agent 提议起步阶段（2026-08-18）

顾问拍板：**从零开始测试，数据一律走前端**，不走「维护者灌 SQLite 起点」的路。因此采用上面的路 1 —— 把 PRD 11 落实为真实的写面工具：

- **SPEC 17/18/26 + 23.1**：允许列表加入 `stage.propose`；工具清单加入 `stage_propose`；bootstrap 注入「如果学校还没有当前阶段：使用 stage_propose 提议一个，供顾问确认」；新增 §23.1 定义工具契约（只建立提议、不激活）。
- **写面**：`stage_propose`（`packages/workbench-read-plane` 的 `stage.propose` scope + `WorkbenchWriteCapabilityService.stagePropose`），仅当学校**没有** `planned`/`active` Stage 时写入 `stages.status = planned` + 五条 `stage_targets.status = draft`，不落 `stage_judgments` 关联；激活仍只在顾问点「基本对」后发生（SPEC 25 不变）。
- **领域**：`createAgentStageProposal` 允许零判断关联（全新学校没有已确认判断）；`adjustStageRecommendation` 同步允许零判断，让「调整一下」在从零流程可用；`SqliteStageRepository.assertScope` 放开空 `judgmentIds`。
- **界面**：没有当前阶段的学校**允许**提交一句话（PRD 11/51 的「一句话可以开始分析」）；跑完若 Agent 提议了阶段，工作台刷新出「这样理解基本对吗？」建议卡并提示先确认；有 `planned` 阶段待确认时暂不开始新分析。
- **验收**：`pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm test`（70 files / 385 tests）全绿；新增用例覆盖领域工厂、写面落库（planned + 5 draft targets + 零 judgment 关联、已有阶段时 `READ_STALE` 拒绝）、MCP 工具可见性与路由、渲染层从零流程。
- **仍留待顾问定**：`BaselineStageRecommendationEngine`（阶段建议）与 `DeterministicStateAssessmentEngine`（状态五维草稿）仍是工作台自己的确定性推理（§13）；PRD 19「系统建议改成……」（AI 按反馈重写判断）仍未实现。

---

## 14. Agent 宿主层加固 WS1（2026-08-18，基于 `a96666b`）

**动因**：另一台设备上 codex CLI 0.147.0 开始对模型后端发 `type:"namespace"` 工具 → 模型代理不认识 → 模型调用失败 → codex 取消还在启动的工作台 MCP server → 被误判为 `WORKBENCH_MCP_STARTUP_FAILED`。`a96666b` 已修文案与保留 startup report 原文；本轮补三件产品侧加固。

**架构前提（未变，本轮未触碰）**：多助手是平级选项，**不做降级/路由/主备/自动切换**；探测与版本信息只给人看，不驱动任何自动行为、不阻断；切换永远由人手动完成；Agent 是必需能力，fail-closed 不变。

### 14.1 三件交付

| 件  | 做了什么                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | **真就绪探测**：`packages/agent-host/src/connection-check.ts` 起一次真会话，发一条与学校无关的平凡 prompt，跑完给六态结论（`ok` / `model_backend_unreachable` / `workbench_tools_cancelled` / `workbench_tools_unavailable` / `timed_out` / `runtime_unavailable`）。默认 60s 上限，且**超时一定给答案**（先 `session/cancel`、再关传输、最后 race 到期直接返回），不指望运行时肯回来 |
| 1b  | **版本信息透明**：`packages/agent-host/src/runtime-versions.ts` 存已验证区间；`local-tool-status.ts` 读实际版本；设置页新增「版本信息」一栏，区间外只多一行「此版本未经产品验证。」                                                                                                                                                                                                   |
| 1c  | **失败现场切换按钮**：工作台失败卡片里列出**其他可用**助手，点选 → 走既有 `chooseAssistant` 持久化 → 带保留的原文重跑。只有一个可用助手时整块不渲染                                                                                                                                                                                                                                   |

### 14.2 探测为什么不会写库（结构性，不是承诺）

`apps/desktop/src/main/connection-check-runtime.ts` 的依赖里**没有** repository、没有 JudgmentService、没有任何来自产品的 schoolId：拿不到能写的东西就写不了。它只用内存态能力令牌（`readScopes`，只读），school/run id 是 `connection-check-<uuid>` 这种不属于任何学校的合成值，用完立刻 revoke。prompt 明确要求不要用工具。

测试兜底：`connection-check-runtime.test.ts` 开真 SQLite（`:memory:` + 真迁移）、灌一条 school、起真 loopback 读面，跑完比对**全部表的行数**，要求逐表相等。

### 14.3 已验证版本区间与验证流程

| 组件      | 已验证区间        | 怎么来的                                                                                                                                                                      |
| --------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| codex-acp | 1.4.0 – 1.4.0     | 决策 L8 在 `apps/desktop/package.json` 精确 pin；§11 / §11.1 真 Codex 验收记录里 `agent_sessions` 记的就是 `codex-acp@1.4.0`。有测试锁住「常量必须等于 manifest 里 pin 的值」 |
| codex CLI | 0.147.0 – 0.147.0 | **本机 2026-08-18 实测 `codex --version` = `codex-cli 0.147.0`**。§11 / §11.1 的真 Codex 验收当时**没有记录 codex CLI 版本号**，所以区间只从这次实测值起算，不追认历史        |

**验证一个新版本的流程**（区间只许这样长）：装上新版本 → 按 §1「M3 额外」手动走一遍真 Codex 端到端（工作台打一句话 → 高层进度 → 判断进 HumanReview → 顾问点认同）→ 通过后才把 `runtime-versions.ts` 的 `verifiedUntil` 抬到新版本，并在本表追加一行写清是哪一天、哪台机器、跑通了什么。**不许为了消掉「此版本未经产品验证」这行字去改常量。**

版本信息**不进入任何判定**：SPEC 62 的三态兼容性仍然只由 ACP 握手 + 契约测试得出，`runtime-compatibility.ts` 依旧零版本字面量，`runtime-versions.ts` 不被它引用。

### 14.4 本轮验证数字（主会话可复跑）

- `pnpm typecheck` 绿 · `pnpm lint` 绿 · `pnpm format` 绿
- `pnpm test`：**74 files / 447 tests**（基线 71 / 395）
- `pnpm build` 绿 · `pnpm test:e2e`：**16 passed**（基线 16）

### 14.5 未做 / 未验证（如实记）

- **没有用真 Codex 手动点过一次「运行连接测试」**。本轮全部证据来自自动化测试与内存态 ACP 对端；真机验收留给主会话。
- 1c 的切换控件在当前产品里**不会出现**（只有 Codex 一个助手），只有机制与测试就位。
- 探测未覆盖「Codex 已装但未登录」这一具体分类 —— 未登录会落进 `model_backend_unreachable`，文案里已把「还没登录」写成常见原因，但没有单独的分类。

---

## 15. 受控 harness WS2（2026-08-19，基于 `c10db94`）

**动因**（承 §14）：codex CLI 是顾问装的、自动升级、私有语法会漂移，宿主层三节链不受产品控制。§14 做的三件加固全是事后手段——让人更快看清坏在哪，不能让它不坏。本轮补的是结构上的另一条路：**受控 harness**，推理循环 = pin 在产品 lockfile 里、跑在工作台进程内的库。

**架构前提（未变，本轮未触碰）**：多助手平级，**不做降级 / 路由 / 主备 / 自动切换**；切换永远由人手动完成；strict 契约唯一通道不变；Agent 是必需能力，fail-closed 不变。默认助手仍是 Codex——它是唯一有真模型端到端验收记录的（§11）。

### 15.1 驱动选型：前提修正两条

任务书写的包名 `@mariozechner/pi-agent-core` **已停更**：该 scope 最后一版 0.73.1，2026-05-07 发布。项目搬到了 org，活的是 **`@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`**，同一个 repo（`earendil-works/pi`），最新 0.84.2 发于 2026-08-14。本轮按 earendil-works 这条线 pin。旁证：DeepSeek 自己的 `dsh-llm-pi-ai` 依赖的也是 `@earendil-works/pi-ai`。

第二条修正：`pi-ai` 把 `openai`、`@google/genai`、`@anthropic-ai/sdk`、`@aws-sdk/client-bedrock-runtime` 全部列为**硬依赖**（不是 optional）。实测 `npm install @earendil-works/pi-agent-core@0.84.2 @earendil-works/pi-ai@0.84.2` = **94 包 / 92MB**，并带两个 install script（`@google/genai`、`protobufjs`）。产品只走 OpenAI 兼容一条路，其余三个 SDK 从不加载；两个 install script 在 `pnpm-workspace.yaml` 的 `allowBuilds` 里**显式设为 false**。

### 15.2 六件交付

| 件  | 做了什么                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Harness 接口分层**：`packages/agent-host/src/harness/contracts.ts` 定义 `HarnessDriver`（输入=任务+能力令牌授予，输出=统一运行结果+失败分类+进度事件）。跨线的东西刻意极少；ACP 会话、子进程、provider SDK 全在驱动一侧 |
| 2   | **codex 路径已经在走这个接口**：`harness/acp-adapter.ts` 是**纯投影**，`AgentHost` 一行未动，产品现在真的从 `HarnessRunResult` 读结果。接口能容下 codex 从承诺变成在跑的事实                                              |
| 3   | **pi 进程内驱动** `packages/agent-host/src/harness-pi/`：`runAgentLoop` 组装最小循环，**只挂我们的十个领域工具**，pi 的 read/write/edit/bash/终端 UI 一个不挂                                                             |
| 4   | **工具注册走同一条治理通路**：十个工具由 `workbench-read-plane` 的同一批 zod 契约编译出参数 schema，调用走同一个 loopback + 同一个能力令牌 + 同样两个 scoping header。read plane 分辨不出两个助手                         |
| 5   | **模型渠道进设置页**：OpenAI 兼容 base URL + 模型名 + 密钥。密钥经 Electron `safeStorage` 加密后存偏好表，**从不回读到任何界面**；这台机器没有系统密钥保管服务时 `save()` 什么都不写并如实报告                            |
| 6   | **助手选择扩为两项**：`assistantChoiceSchema = ['codex','builtin']`；`builtin` ready 判定 = 驱动可装配（真建一次工具集，跑 SPEC 18/25 契约检查）+ 渠道配置齐全。连接测试对它跑同样的六态语义                              |

顾问看到的名字定为 **「工作台自带助手」**。理由：它描述的是**推理跑在哪**（产品自己进程内，不用另外装东西），这正好是顾问需要区分的那一点——另一个选项 Codex 要顾问自己装、自己登录。名字里不出现 pi / harness / provider / OpenAI 之类实现词，有测试锁住这条。

### 15.3 pi 白送了什么 / 我们自建了什么

**pi 白送（0 行自建）**：agent 循环本体（含流式 chunk 装配、工具调用调度与结果回灌、消息历史与 provider 报文双向转换、中断语义）；`streamFn` 这个天然的假模型注入口；**`fauxProvider` + `setResponses` 脚本化假模型**（假 LLM 测试设施白送一半）；OpenAI 兼容 provider（`createProvider` + `openAICompletionsApi()`，自定义端点约 10 行）；typebox 参数校验。

**我们自建**（`packages/agent-host` 新增 `harness/` 2 个 + `harness-pi/` 5 个源文件，非测试代码合计 1085 行）：Harness 接口与 codex 投影适配器；十个工作台工具的 pi 侧注册与 loopback 桥接（含错误载荷逐字回传）；SPEC 18/25 契约断言；模型渠道构造与 fail-closed 判定；运行结果 → Agent Run 状态/失败分类映射；轮次上限；连接测试的六态映射。产品侧另加机密存储、设置页渠道 UI、助手路由。

**手写最小 loop 的对比**（若不用 pi）：需自建流式装配、工具调度、报文转换、错误与中断语义、上下文压缩，粗估 800–1500 行且属于会**静默出错**的代码。本轮判断：不值得自己写，除非依赖体量成为部署硬约束。

### 15.4 本轮验证数字（主会话可复跑）

- `pnpm typecheck` 绿 · `pnpm lint` 绿 · `pnpm format` 绿
- `pnpm test`：**80 files / 503 tests**（基线 74 / 450）
- `pnpm build` 绿 · `pnpm test:e2e`：**16 passed**（基线 16）

新增测试覆盖（全部实跑通过）：

- **真 SQLite 端到端**（`apps/desktop/src/main/builtin-assistant-run.integration.test.ts`）：真迁移 + 真 loopback（真端口）+ 真能力令牌 + 真 assessment gate + 真方法论 pack + 真 pi 循环，脚本化模型走完「读学校 → 取准则 → 看历史 → 登记依据 → 提交判断」，`diagnosis_proposals` 落一条 `proposed`、`accepted_judgments` 为 0、四句进度文案按序推进；另含自纠一轮（被拒的候选写 0 行，`self_correction_rounds` = 1）
- **越权被拒**：只带 read scope 的令牌调 `evidence_register` → `AUTH_SCOPE_DENIED`，`evidence` 表零行；跨校令牌读不到本校；SPEC 25 四个禁用能力在工具集里不存在且 loopback 直接 404
- **工具面一致性**（`workbench-tool-parity.test.ts`）：起真的 MCP server 子进程列真的工具，逐项比对十个工具的名称、描述、参数 schema，全等
- **机密不落明文**（`model-channel-store.test.ts`）：存后全表值不含密钥原文、只有带前缀的密文；`readView()` 序列化后不含密钥；无密钥保管服务时一个字节都不写；存下来的值解不开时当作没有密钥（不回退读明文）
- **诚实失败**：无渠道配置 → `MODEL_CHANNEL_NOT_CONFIGURED`，不碰学校数据、不问任何模型
- **连接测试**：`builtin` 路径跑完全表行数逐表相等（与 §14.2 对 codex 的同一断言）；文案指向「填模型连接」而不是「装 Codex」
- **pin 一致性**：`pinnedBuiltinHarnessVersion` 必须等于两份 manifest 里的 exact pin（禁 `^`/`~`）
- **codex 零回归**：既有全部测试未改语义地通过

### 15.5 未做 / 未验证（如实记）

- **真模型端到端没有跑过。** 用户尚未配置火山方舟渠道，本轮全部证据来自脚本化模型。设置页的版本行因此标着「此版本未经产品验证」，**这行字只能靠真跑一次消掉，不许改常量**。验收步骤见 ADR-004 草稿第 7 节。
- **没有用真 app 手点过一次**：设置页填渠道 → 保存 → 选「工作台自带助手」→ 运行连接测试 → 从工作台打一句话。机制与自动化测试就位，真机验收留给主会话。
- **参数预校验会做类型强转**：pi 在调工具前用 typebox 校验并强转（`"5"` → `5`，可空字段的 `null` 被删）。codex 路径没有这一层。强转后仍要过 loopback 的同一批 zod，因此不构成完整性漏洞，但两个助手对模型格式毛刺的容忍度确实不同。
- **`workbench_tools_cancelled` 这一态在 builtin 路径上永远落不到**（没有 MCP 子进程可被取消），连接测试如实报告，不假装覆盖六态。
- **工具描述文案在 `harness-pi/workbench-tools.ts` 里重述了一遍**（`workbench-mcp` 是进程入口，import 会起 server）。parity 测试锁住不漂移；更干净的终局是下沉到 `workbench-read-plane/contracts`，那要动本轮边界外的包。
- **92MB 依赖未做瘦身**。若打包体积成问题，选项是自写 OpenAI 兼容 provider 顶掉 `pi-ai`（`pi-agent-core` 硬依赖它，不能简单删）。

### 15.6 dsh 作为备选驱动：本轮实测留档

改向前按 dsh 版任务书做过一轮只读实测（未落入仓库，工作树在改向时已确认干净）。这些事实留档，将来若要把 dsh 加成第三个驱动不用重做：

- **核心确实可以薄嵌**。`@deepseek-ai/dsh-agent-loop` 只 inject 五个服务（`agents` / `sessions` / `llm` / `tools` / `systemPrompt`）。只装这五个包实测 **20 个包 / 3.0MB**，全部第一方（外加 cosmokit、standard-schema），零原生依赖、零 install script；web UI、bash/fs/pwsh 工具、telemetry 全都不必挂载。实测跑通了带工具调用的完整循环。
- **官方没有 MCP 客户端插件**（`dsh-tool-mcp` 确认 404），工具需要自己桥接——与 pi 的情况相同。
- **两个坑**：Cordis 的服务注册比 `ctx.fiber.await()` 晚一个 tick，组装必须循环等待服务就位；`session-telemetry-otel` 默认 `DISABLED` 但仍挂载，最小组装里直接不挂它更干净。
- **不选它的理由不是「不行」**，是成熟度（0.1.0-rc.7，开源 5 天）与嵌入形态（要手工装配一整个 IoC 容器，而 pi 的循环是一个可以直接调用的纯函数）。

### 15.7 codex 路径适配 Harness 接口的路线

本轮已完成第一步（纯投影适配器，`AgentHost` 未改）。若将来要走完：

1. **把 `AgentHost` 包成 `CodexHarnessDriver implements HarnessDriver`**：构造函数吃 launcher + 路径解析，`run(task, observers)` 内部做现在 `runCodexAssistant` 做的事，末尾仍走 `harnessResultFromAcpOutcome`。纯搬运，无行为变化。
2. **把 `runAgentOnce` 里的 `assistant === 'builtin' ? … : …` 换成驱动注册表查表**。此时新增第三个驱动（如 dsh）不需要动组合根的控制流。
3. **连接测试同样收进接口**（加一个可选的 `probeConnection`），把 `connection-check-runtime.ts` 里的两条分支收敛成一条。
4. 不要做的事：把 `mcpStartupReportedFailure` 这类某个 ACP bridge 特有的诊断提升进接口。它是特定实现对特定子进程的断言，`AgentHost` 已经据此做完决定并折进 `failure`。

---

## 13. 本轮明确没做（顾问已列，不得顺手扩范围）

飞书授权与 lark-cli｜文件 / 音频 ingestion｜教师实践纵切｜DeepSeek Harness｜Congruence 与 Role Standards Pack｜RAG / 向量库｜打包、签名、公证、自动更新。

另外三项**发现但未做**，留给顾问排期：

- `counterEvidenceSearch.summary` 不落库：契约强制 Agent 声明并给出可审引用，但那段说明文本没有列可存，因此审核界面只能显示已登记的相反 Fact，显示不了「它到底查了什么」。补这条要加一次 forward migration。
- PRD 19 的「系统建议改成……」（AI 按顾问反馈重写判断）**未实现**。现在是顾问自己写「哪里不准确」+ 自己写最终文本，两者与原判断一起存下来。别把它当成 PRD 19 已完成。
- `BaselineStageRecommendationEngine`（阶段建议）与 `DeterministicStateAssessmentEngine`（学校状态五维草稿）仍是工作台自己的确定性推理，见 §12。
