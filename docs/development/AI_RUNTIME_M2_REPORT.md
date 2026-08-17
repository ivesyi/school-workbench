# AI Runtime M2 — 真链路写方向接通

**日期：2026-08-18**
**基线提交：`bbc8c37`**
**范围：`evidence_register` + `diagnosis_propose` 两个写面 MCP tool、写 scope、错误透传、Workbench 侧 `AssessmentInput` 组装**

---

## 1. 核心设计问题：ObservationFact 与 Claim 从哪来

### 1.1 约束

- `validateAssessmentCandidate(rawInput, rawCandidate, registry)` 需要完整的 `AssessmentInput`；`AssessmentCandidate` 只引用其中的稳定 ID
- 决策 L2：`AssessmentInput` 由 Workbench 从 SQLite 组装，Agent 只提交 Candidate
- SPEC 18 冻结 10 个 tool，不许有第 11 个
- `validateAssessmentCandidate` 一行不许动，不许第二套宽松 DTO

### 1.2 为什么「Claim 只能选已有的」不成立

`validator.ts:274-299` 要求 `supportingFactRefs` 里的每条事实，都必须以 `supporting` 立场挂在**被选中的某条 Claim** 上；`validator.ts:386` 进一步要求 `proposed` 状态下这样的事实至少有一条。

所以如果 Claim 只能从库里既有的里选，那么 `evidence_register` 新登记的事实**永远无法被引用为支持事实**——它们没有任何 Claim 挂靠。`evidence_register` 会退化成一个写完就用不上的动作。**Claim 必须能在写路径上产生。**

而 `claims.created_by` / `claims.agent_run_id`（`schema.ts:64-65`）、`observation_facts.extracted_by` / `agent_run_id`、`evidence.registered_by` / `agent_run_id` 这三组归属列同时存在，说明 schema 从一开始就预期 Evidence / ObservationFact / Claim **三者都可能由 Agent 产生**。问题只是「由哪个 tool 携带」。

### 1.3 方案：`evidence_register` 登记整条依据链

```text
evidence_register  ← 一份材料 + 从它读出的 ObservationFact + 这些事实支持/反对的 Claim
diagnosis_propose  ← 就是冻结的 AssessmentCandidate 本身，别的什么都不带
```

- **Evidence**：SPEC 22 的四件事（校验学校 / 去重 / 建立来源 / 生成 ID）
- **ObservationFact**：SPEC 74 把 `Observation Fact extraction` 紧接在 `Evidence acquisition` 之后，`observation_facts.extracted_by` 就是为「Agent 提取」准备的
- **Claim**：SPEC 74 的 `Supporting / counter evidence search` 一步产出的正是「哪条事实支持/反对哪条断言」。Claim 的事实可以引用**本次登记的**（`factRef`）也可以引用**之前已登记的**（`factId`），所以跨材料的 Claim 照样成立

`diagnosis_propose` 的载荷是 `{ schoolId?, type, title, candidate }`，其中 `candidate` 的 schema **由 `assessmentCandidateSchema.omit({ school: true })` 派生**，不是另写一份。school 由能力令牌决定，Agent 无从选择。

### 1.4 为什么 Claim 放在 register 而不是 propose

如果 Claim 在 `diagnosis_propose` 里落库，只有两种走法，都不可接受：

- 先写 Claim 再校验 → 候选被拒时留下孤儿 Claim，而 L5 明确预期 Agent 会自纠重试，于是每轮重试都多一组重复 Claim
- 把 Claim 写入 `saveGroundedProposal` 的事务 → 要改动那道「重读 SQLite 逐字段比对」的持久化闸门本身

放在 register 两个问题都不存在：**候选被拒时写路径一个字节都不写**，Agent 改完候选直接重投，不产生任何重复行。这一点有回归测试（`sqlite-write-plane-repository.test.ts`「returns the protocol findings unchanged and counts the round」末尾断言 `claims` 计数仍为 1、`diagnosis_proposals` 计数为 0）。

### 1.5 为什么没有突破任何约束

| 约束                 | 为什么成立                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| SPEC 18 十个 tool    | 仍是 9 个（`feishu_ensure_ready` 属飞书那轮）。有测试断言 `capabilityNames` 长度为 9 且不含 `feishu_ensure_ready`                   |
| L2                   | `buildAssessmentInput(schoolId)` 全部读自 SQLite + 文件 registry，Agent 一个字段都不提供。有测试证明两校数据互不串门                |
| SPEC 24 无第二套 DTO | propose 的 candidate schema 是 `assessmentCandidateSchema` **派生**的；有测试逐键比对，只少一个 `school`                            |
| SPEC 24.1「可验证」  | Input 的每一行都是持久化行，`assertPersistedInput`（`sqlite-grounded-diagnosis-repository.ts:107-242`）在保存事务里重读并逐字段比对 |
| 事实/解释分离        | register 的 fact 载荷没有 `kind` 字段，`kind: 'observation_fact'` 由 Workbench 打上；解释只存在于 candidate 的 `interpretations`    |
| SPEC 25              | 四个禁止能力做成显式 negative 常量 + 路由不可达 + 无 scope，三处都有测试                                                            |

### 1.6 `methodologyContext` 从哪来

= **所有 `active` Pack 的全部准则**（当前两包各 5 条，共 10 条），直接从文件 registry 读。

顾问把某个 Pack 标成「需要修订」→ 它不再 active → 它的准则不进 context → 引用它的候选被 `ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT` 挡掉。**这就是顾问否决权在写路径上的落点**，有专门测试。

这一条也正面回答了台账第 9 节记的那个现象：Agent 从公网抄来的判断没有本库的准则编号可引，`criterionMappings` 必然落空——**不靠提示词围堵，靠出口校验**。

---

## 2. 改动文件清单

**新增**

| 文件                                                                         | 内容                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workbench-read-plane/src/write-contracts.ts`                       | 写能力名/scope、SPEC 25 negative 常量、两个 tool 的输入 schema（propose 的派生自冻结 candidate）、`WritePlaneRepository` 端口、`GroundedDiagnosisGateway` 结构化接口 |
| `packages/workbench-read-plane/src/write-service.ts`                         | `WorkbenchWriteCapabilityService`：解析、school 作用域、协议错误原样透传、自纠轮数计数                                                                               |
| `packages/db/src/sqlite-write-plane-repository.ts`                           | L7 规范化与 contentHash、单事务登记依据链、`buildAssessmentInput`                                                                                                    |
| `packages/db/drizzle/0009_agent_write_plane.sql` + `meta/0009_snapshot.json` | `evidence(school_id, content_hash)` 唯一索引；`agent_runs.self_correction_rounds`                                                                                    |
| `packages/workbench-read-plane/src/write-plane.test.ts`                      | scope/SPEC 25/派生 schema/loopback 路由与错误形状                                                                                                                    |
| `packages/db/src/sqlite-write-plane-repository.test.ts`                      | 去重规范化、依据链落库、Input 组装与跨校隔离、协议拒绝、Pack 撤回 fail-closed                                                                                        |
| `packages/db/src/write-plane-mcp.integration.test.ts`                        | 真 MCP server × 真 stdio × 真 loopback × 真 SQLite 的写路径                                                                                                          |
| `docs/development/AI_RUNTIME_M2_REPORT.md`                                   | 本文                                                                                                                                                                 |

**修改**

| 文件                                                                                                  | 改了什么                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workbench-read-plane/src/contracts.ts`                                                      | 写能力名/写 scope/禁止清单/合并的 `capabilityScope` 与类型守卫                                                                                       |
| `packages/workbench-read-plane/src/auth.ts`                                                           | `READ_SCOPE_SET` → `ISSUABLE_SCOPE_SET`（SPEC 17 的八个）；类型由 `ReadScope` 放宽为 `CapabilityScope`。**三重绑定、SHA-256 摘要、TTL 上限一律未动** |
| `packages/workbench-read-plane/src/loopback.ts`                                                       | 写路由、422 状态、错误信封增加可选 `errors[]`、写平面缺席时干净拒绝                                                                                  |
| `packages/workbench-mcp/src/stdio.ts`                                                                 | 注册两个写 tool（非 readOnly annotations）、`LocalApiError` 携带 `details`、错误结果带 `errors[]`                                                    |
| `packages/db/src/schema.ts`                                                                           | `evidence` 增加 school+contentHash 唯一索引                                                                                                          |
| `packages/db/src/agent-runtime-schema.ts`                                                             | `agent_runs.self_correction_rounds`                                                                                                                  |
| `packages/db/src/sqlite-agent-runtime-repository.ts`                                                  | `setSelfCorrectionRounds`                                                                                                                            |
| `packages/domain/src/grounded-diagnosis.ts`、`packages/application/src/grounded-diagnosis-service.ts` | 把 `agentRunId` 传到 `diagnosis_proposals`（该列早已存在，写平面是第一个能填的调用方）                                                               |
| `apps/desktop/src/main/read-plane-runtime.ts`                                                         | 组装写服务与 `GroundedDiagnosisService`，与读平面共用同一个延迟方法论 seam                                                                           |
| `apps/desktop/src/main/agent-runtime.ts`、`index.ts`                                                  | 令牌改发 SPEC 17 全八个 scope；run 结束记录自纠轮数                                                                                                  |
| `packages/agent-host/src/contracts.ts`、`mcp-visibility.ts`                                           | 期望的 tool 面从 7 扩到 9（见第 6 节说明）                                                                                                           |
| 既有测试 3 处                                                                                         | 跟随 9 个 tool 的新面与新增列                                                                                                                        |

---

## 3. 新增 / 修改的测试

| 测试                                                   | 覆盖                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write-plane.test.ts` · SPEC 17 capability scopes      | 恰好加两个写 scope；禁止 scope 不出现在任何映射里；令牌能发写 scope、仍拒绝清单外的                                                                                                          |
| `write-plane.test.ts` · SPEC 25 forbidden capabilities | 显式 negative 常量；四个名字不在任何能力列表、无 scope 映射；能力总数 9 且不含 `feishu_ensure_ready`                                                                                         |
| `write-plane.test.ts` · 派生 candidate                 | 与 `assessmentCandidateSchema` 逐键比对，只少 `school`；Agent 不能自带 school，不能塞多余字段                                                                                                |
| `write-plane.test.ts` · 写载荷键名                     | 载荷与 candidate 的所有键名都过得了 `findNumericScoringField` / `findHiddenReasoningField`                                                                                                   |
| `write-plane.test.ts` · 写服务                         | 协议错误原样透传且计数；school 来自令牌不来自载荷；非协议异常原样上抛不计数                                                                                                                  |
| `write-plane.test.ts` · loopback                       | 两个写路由可达；禁止能力 404；只读令牌打写路由 403 而读仍 200；拒绝返回 422 + 完整 `errors[]`；未接写平面时 500                                                                              |
| `sqlite-write-plane-repository.test.ts` · L7           | 规范化边界（换行/缩进/大小写/默认端口/尾斜杠视为同一份；sourceType/正文/query/fragment 不同即不同）                                                                                          |
| 同上 · `evidence_register`                             | 三类归属列都落 `agent` + runId；claim_facts 的 stance 与 sequence；重复登记返回既有 ID 且行数不增；跨校事实被拒且不留痕；载荷 schoolId 与令牌冲突被拒                                        |
| 同上 · Input 组装                                      | 只含本校行；只提供 active Pack 的准则；无 active Stage 时明确拒绝                                                                                                                            |
| 同上 · `diagnosis_propose`                             | 成功落 immutable proposal、`agent_run_id` 有值、未产生 human_review；拒绝时返回具体 code、计数、且不写任何行；Pack 撤回后同一条链 fail-closed；引用别校行被拒                                |
| `write-plane-mcp.integration.test.ts`                  | **真 MCP server 二进制 × 真 stdio × 真 loopback × 真能力令牌 × 真 SQLite**：登记依据链 → 提交候选 → 落 proposal；以及无依据的候选被拒时 `errors[]` 完整到达 Agent、库里零写入                |
| `agent-runtime-schema-migration.test.ts`（改）         | 新列在列表末尾（`ALTER TABLE ADD COLUMN` 的真实位置），且仍无 `reason` / `detail` 列                                                                                                         |
| `stdio.integration.test.ts`（改）                      | 9 个 tool；读 tool `readOnlyHint=true`、写 tool `false`；四个禁止名不在面上；**写 tool 描述不含打分类措辞**                                                                                  |
| `mcp-visibility.test.ts`（改）                         | M1 的注入前契约检查现在覆盖全部 9 个 tool                                                                                                                                                    |
| `tests/e2e/agent-read-plane-startup.spec.ts`（+1 例）  | 真 Electron：把学校推进到有 active Stage + confirmed 目标，再触发 run，断言走到 `AGENT_RUN_FAILED`——即令牌按八个 scope 发出、工作区通过、**9 个 tool 的契约检查对着 app 内真 loopback 通过** |

---

## 4. 验收数字

| 命令             | 基线（`bbc8c37`）    | 现在                                              |
| ---------------- | -------------------- | ------------------------------------------------- |
| `pnpm typecheck` | 通过                 | 通过                                              |
| `pnpm lint`      | 通过                 | 通过（No issues found）                           |
| `pnpm format`    | 通过                 | 通过（All matched files use Prettier code style） |
| `pnpm test`      | 57 files / 269 tests | **60 files / 300 tests**                          |
| `pnpm build`     | 通过                 | 通过                                              |
| `pnpm test:e2e`  | 11 passed            | **12 passed**                                     |

迁移卫生：`_journal.json` **+7 −0**（纯追加）；`0009` 只有一条 `ALTER TABLE ADD COLUMN` 与一条 `CREATE UNIQUE INDEX`，**无 `INSERT`**。`knowledge/` 零改动。无被 git 判为二进制的文件。

---

## 5. 关键设计决定与理由

### 5.1 contentHash 规范化规则（L7）

hash 输入 = `sourceType` + 规范化 uri + 规范化 inlineText，**school 不进 hash**（它在唯一索引里，两所学校可以持有同一份文档而不冲突）。

- **uri**：去首尾空白；能解析成 URL 时——协议与主机转小写（二者按定义大小写不敏感）、去掉冗余默认端口（`:80`/`:443`）、去掉路径末尾斜杠；**query 与 fragment 保留**（它们经常指向不同文档或文档里的不同位置）。不能解析成 URL 时只去空白并把连续空白压成一个空格
- **inlineText**：NFC 归一化 → 行尾统一为 `\n` → 连续空白压成一个空格 → 去首尾空白
- 只改 hash 输入，**存进库的原文一个字符都不动**

命中重复返回既有 Evidence ID 而不报错（L7 原文：Agent 重复登记同一份材料是正常行为）。同一次调用里的 ObservationFact 与 Claim 也做**内容级幂等**（fact 按 school+evidence+type+text+locator+directness，claim 按 school+predicateKey+statement），这不是新的领域规则，只是让「重复登记」这件被 L7 认可的事不会因为一层之下没做而制造重复行。

唯一索引落在 `evidence(school_id, content_hash)`。既有行的 `content_hash` 是 NULL，SQLite 视 NULL 互不相等，历史数据不受影响。

### 5.2 错误透传形状（L5）

```jsonc
// HTTP 422
{
  "ok": false,
  "error": { "code": "ASSESSMENT_PROTOCOL_REJECTED", "message": "..." },
  "errors": [
    {
      "code": "ASSESSMENT_PROPOSED_CRITERION_REQUIRED",
      "path": "$.candidate.criterionMappings",
      "message": "...",
    },
  ],
}
```

MCP 侧原样带到 tool 结果里（`errorResult` 增加 `errors` 字段）。**不折叠**：这是 Agent 唯一能据以自纠的信息，折成一句话就只能靠猜。

422 而不是 400：请求本身是良构的，是领域拒绝了它，且预期 Agent 会改完重投。

自纠轮数按 `agentRunId` 在写服务里计数，run 结束时由主进程写进 `agent_runs.self_correction_rounds`，然后释放计数器。

### 5.3 写 scope 放开之后靠什么挡

放开写 scope 之后「只读」不再由类型系统保证，所以 SPEC 25 的四个能力靠**三道各自独立的**闸门：

1. `forbiddenCapabilityNames` 显式 negative 常量，且断言它们不在 `capabilityNames` / `capabilityScope` 里
2. loopback 路由只认 `isReadCapabilityName || isWriteCapabilityName`，请求 `state_commit` 与请求一个从不存在的名字**返回完全相同的 404**
3. `forbiddenScopes`（SPEC 17 的不允许清单）不在 `capabilityScopes` 里，`CapabilityTokenStore.issue()` 直接拒发

另外 `packages/agent-host` 注入前的契约检查会在真实 MCP server 上 `tools/list`，发现任何禁止名就整轮失败。

### 5.4 写平面为什么是可选依赖

`createWorkbenchReadPlaneBootstrap` 的 `writeService` 是可选项。没接写平面的 workbench 会对写路由返回 500 并说明，而不是半答一半——比让路由「看起来存在但行为未定义」诚实。

### 5.5 不新增包依赖的做法

`packages/workbench-read-plane` 新增了对 `@school-workbench/assessment` 的依赖（要用冻结的 candidate schema 与错误 schema），但**没有**依赖 `@school-workbench/application`：`GroundedDiagnosisGateway` 是结构化接口，`GroundedDiagnosisService` 原样满足；协议拒绝按 `error.name === 'GroundedDiagnosisProtocolError'` + 用冻结的 `assessmentProtocolErrorSchema` 校验 `errors` 来识别，识别不了就原样上抛，绝不猜。

---

## 6. 对 M1 已验收代码的两处扩展（简报要求说明）

1. `packages/agent-host/src/contracts.ts` 增加 `workbenchWriteToolNames` / `workbenchToolNames`
2. `packages/agent-host/src/mcp-visibility.ts` 的注入前契约检查改为要求全部 9 个 tool

**为什么必须扩**：M1 的检查断言「7 个只读 tool 齐全」。写 tool 上线后若不扩，一个漏注册写 tool 的构建仍会通过检查，Agent 拿到一个残缺工具面才发现——这正是 M1 那道检查存在的意义。ACP 生命周期本身一行未动。

---

## 7. 主会话用真 Codex 验证的确切步骤

```bash
cd /Users/yihu/zero/WorkSpace/school-workbench
pnpm dev
```

窗口里：

1. 新建学校 → 提交一条情况 → 点「认同」→ 点「基本对」确认阶段。**这一步必须做**：没有 active Stage 与 confirmed 目标就无法接地（会返回 `no active Stage`）
2. DevTools（`Cmd+Opt+I`）Console：

```js
const schools = await window.workbench.schools.list()
const target = schools[0]
const outcome = await window.workbench.agent.run({
  schoolId: target.id,
  message: [
    '请先读这所学校的正式状态与当前阶段目标。',
    '然后用 standards_get 取 data-wise@3 里 structure 维度的准则。',
    '如果你形成了一条判断：先用 evidence_register 登记你真正用到的材料、',
    '从材料里读出的观察事实、以及这些事实支持的断言；',
    '再用 diagnosis_propose 提交，criterionMappings 只能引用 standards_get 返回的准则编号。',
  ].join(''),
})
console.log(outcome)
```

**预期**：`status: 'completed'`、`usedWorkbenchTools: true`、`failureCode: null`。

3. 核对落库：

```bash
DB="$HOME/Library/Application Support/school-workbench/school-workbench.sqlite"
sqlite3 "$DB" "
  SELECT id, status, self_correction_rounds FROM agent_runs ORDER BY created_at DESC LIMIT 1;
  SELECT id, source_type, registered_by, agent_run_id, substr(content_hash,1,12) FROM evidence WHERE registered_by='agent' ORDER BY created_at DESC LIMIT 3;
  SELECT id, extracted_by, agent_run_id FROM observation_facts WHERE extracted_by='agent' ORDER BY created_at DESC LIMIT 3;
  SELECT id, created_by, agent_run_id FROM claims WHERE created_by='agent' ORDER BY created_at DESC LIMIT 3;
  SELECT p.id, p.status, p.agent_run_id, p.title FROM diagnosis_proposals p WHERE p.agent_run_id IS NOT NULL ORDER BY p.created_at DESC LIMIT 3;
  SELECT mp.key, mc.stable_key FROM diagnosis_criteria dc
    JOIN methodology_criteria mc ON mc.id = dc.criterion_id
    JOIN methodology_packs mp ON mp.id = mc.pack_id
    ORDER BY dc.proposal_id DESC LIMIT 5;
  SELECT count(*) AS accepted_from_agent FROM accepted_judgments;
"
```

**预期**：`evidence/observation_facts/claims` 有 `agent` + runId 的行；`diagnosis_proposals` 有一条 `proposed` 且 `agent_run_id` 非空；`diagnosis_criteria` 指向真实 Pack 准则；`accepted_judgments` **不因这次运行而增加**（只有顾问审核才能产生正式判断）。

### 顾问否决权必须复验（M2 额外验收线）

```bash
# 在设置 → 高级设置 → 方法论内容审核里，把 Data Wise 标成「需要修订」，然后重跑同一句话
```

**预期**：`diagnosis_propose` 返回 `ASSESSMENT_PROTOCOL_REJECTED`，`errors[]` 里含 `ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT`；`diagnosis_proposals` 不增加新行；`agent_runs.self_correction_rounds` > 0。改回「可以使用」后同一条链恢复。

### 如果 Agent 没调写 tool

看 `outcome.message`。常见是模型直接给了自然语言判断而没走结构化提交——这属于模型行为，不是接线问题。可以按台账第 9 节的结论理解：**对话面不设防，正式路径 fail-closed**。库里没有新的 `diagnosis_proposals` 行就说明闸门起作用了。

---

## 8. 我发现简报 / SPEC 里不成立的前提

1. **简报 4.4 说 `confidence` 是会被 fail-closed 的打分键——不成立。** `errors.ts:62-79` 的 `numericScoringKeys` 里**没有** `confidence`；恰恰相反，`confidence: z.enum(['low','medium','high'])` 是 `AssessmentCandidate` 的**必填字段**（`contracts.ts:168`）。真正会被拒的是 `score/scores/weight/weights/rating/ratings/rank/ranking/schoolrank/compositescore/overallscore/numericscore/numericalscore/aggregatelevel/overalllevel/compositelevel`，以及 `chainofthought/reasoningtrace/hiddenreasoning/scratchpad/privatereasoning`。若照简报去回避 `confidence`，反而会产出必然被拒的候选。
2. **简报 4.1 引的 `auth.ts:49, 101-103` 行号在 `bbc8c37` 上是 49（`READ_SCOPE_SET` 定义）与 98-103（唯一性与 scope 白名单两段）**，不是 101-103 单独一段。语义无误，位置略有出入。
3. **简报 4.3 说 `diagnosis_propose` 后端「已经全部就绪，主要是接线」——只对了一半。** 后端链条确实就绪，但它**没有任何组装 `AssessmentInput` 的东西**，而 `assertPersistedInput` 又要求 Input 里的 Claim / ClaimFact 已经持久化。也就是说，光接线不足以让这条链跑起来；必须先解决第 1 节那个问题（Claim 从哪来），否则 `evidence_register` 写出来的事实永远无法被引用。
4. **简报 2 节说 `GroundedDiagnosisService.create` 当前没有生产调用者——属实**（复核确认只有单测调用）。
5. **`packages/assessment/src/test-support.ts` 不在包的 `exports` 里**，只能被 assessment 自己的测试相对导入。我的测试因此自建了同类 registry 助手，没有改动 assessment 的导出面。

---

## 9. 未验证 / 我没做到的

- **没有跑过一次真实 Codex 的写路径**（按纪律，要花钱）。我做到的最远一步是第 3 节那个「真 MCP server × 真 stdio × 真 loopback × 真 SQLite」的集成测试——除 Codex 之外整条链都是真的。最后一步归主会话。
- **`self_correction_rounds` 只在进程内计数**，Electron 若在 run 中途崩溃则不会被写入（该 run 本身也会留在 `running`，这是 M1 已记录的既有限制）。
- **`buildAssessmentInput` 会读该校**全部** Evidence / Fact / Claim**，没有分页或上限。对 local-first 单机、单校数百行的规模没问题，但这是一条明确的伸缩性天花板。
- **库里若存在无法用 assessment 契约表达的历史行**（例如未知的 `source_type`），整个 Input 会 fail-closed。我让它带着行 ID 明确报错而不是静默丢弃，但这意味着一行坏数据会挡住该校全部提交。
- **`WorkbenchLoopbackReadPlane` 这个类名现在名不副实**（它同时承载写平面）。改名会波及 M1 已验收的多处代码，我判断不值得在本轮做，留作后续。
- **写 tool 的描述没有加「不要用公网检索」之类的措辞**——顾问已拍板「不靠提示词围堵，靠出口校验」，本轮照此执行。
- **`feishu_ensure_ready` 未做**（第十个 tool，属飞书那轮）；**未做任何 UI**（M3）。
