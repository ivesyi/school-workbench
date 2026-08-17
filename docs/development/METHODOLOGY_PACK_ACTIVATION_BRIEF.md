# 下一纵切任务书：Methodology Pack 审核与激活

**类型：前瞻性任务书（不是已完成台账）**
**目标读者：接手这轮实现的新会话 / 新贡献者**
**写于：2026-08-17，基于提交 `4119e7c`（`feat(mcp): establish scoped read plane`）**

本文件自包含。开工前只需再读 `AGENTS.md`、`docs/product/PRD.md` 第 5 / 44 / 46 章、`docs/architecture/SPEC.md` 第 72 / 73 章，以及 `docs/development/METHODOLOGY_REGISTRY_FOUNDATION_STATUS.md`。

---

## 1. 为什么是这一轮

仓库已经落了 8 轮。产品链路（说情况 → 判断 → 阶段 → 状态 → 变化）跑通，但三块最重要的能力面**建好了却接不上**：

- `packages/assessment` 的质量门禁不在 live flow 上；
- `GroundedDiagnosisService`（协议校验后落库）不在 live flow 上；
- `packages/workbench-read-plane` / `workbench-mcp` 的 7 个只读 Tool 没有被 Electron 启动。

它们共同卡在同一个前置条件上：**仓库里两个 Methodology Pack 仍是 `status = review`，从未激活**。

- `standards_get` 要求 file Registry 与 SQLite projection 双方都是 `active`，否则返回 `no_active_pack`；
- `GroundedDiagnosisService` 要求 criterion 引用能在**已持久化的 active pack** 中精确解析。

因此激活是当前唯一不被阻塞、且解锁后续全部工作的关键路径项。它同时是一个**认识论关口**：Pack 激活意味着顾问正式承认「这份机器翻译版方法论可以约束真实判断」，不能由代码自动完成。

---

## 2. 开工前必须知道的既有事实（已核实，不要重新推断）

### 2.1 本机环境

- 仓库**没有 `node_modules`**，本机 PATH 上**没有 `pnpm`，也没有 corepack**。第一件事是把工具链装好（`npm i -g pnpm@11` 或启用 corepack），否则任何验证命令都跑不了。
- 本机 Node 为 26.3.1，产品基线是 Node 24（`.node-version` / `package.json#engines`）。沿用现有做法：本机可用 26 引导，不改基线。
- 因为上一条，`4119e7c` 之后**没有人独立复跑过测试**。开工第一步先跑一遍全绿基线，再动代码。

### 2.2 Pack 现状

两个 Pack 都在 `knowledge/methodology/<key>/`，各含 `PACK.md`（人工审核基线，Markdown）与 `pack.json`（工程翻译，运行时输入）。

- `schooling-by-design-v1`：7 constructs / 5 criteria / 0 behaviorAnchors，`status = review`，`version = 1`
- `data-wise-v3`：8 constructs / 5 criteria / 0 behaviorAnchors，`status = review`，`version = 3`

**审核体量很小：一共 10 条 criterion。** 这不是一个需要分批处理的大工程。

### 2.3 已知的翻译质量问题（顾问审核时一定会撞上，提前写明以免被当成新发现）

- 全部 10 条 criterion 的 `description` 与 `title` **完全相同**（例如 `"结果清晰度"` / `"结果清晰度"`），等于没有描述。
- 全部 10 条 criterion 的 `dimensionKey` 均为 `null`。后果：`standards_get` 的 `dimensionKeys` 过滤器对现有 Pack **完全无效**，只能用 `practiceType` 或 `criterionRefs` 过滤。
- `behaviorAnchors` 两个 Pack 都为空数组（这是上一轮**刻意**的：没有凭空发明行为锚点，不是遗漏）。
- `evidenceGuidance` 中的 `counterexampleChecks` / `collectionPrinciples` / `adjustmentConditions` 普遍为空数组，只有 `supportingIndicators` / `counterIndicators` / `insufficientEvidence` 有内容。

**这意味着「审核后判定不合格、要求补翻译」是一个完全合法、甚至可能是正确的结局。** 见第 6 节纪律条款。

### 2.4 生命周期与写入路径（已实现，复用，不要重写）

- 生命周期是**一步一跳**：`draft → review → active → retired`。回滚、跳级、retired 复活都会被拒绝。
- `canonicalContentHash` **排除自身与 `status`**，所以状态推进不产生虚假的内容修订。
- 唯一写入路径是 `SqliteMethodologyRepository.syncRegistry(registry)`：同 key+version+hash 且持久化投影一致时，允许推进恰好一个生命周期状态；内容变了则拒绝。
- 文件侧入口是 `loadMethodologyRegistry(methodologyRoot, sourceManifestPath)`，它会用 `references/SOURCE_MANIFEST.md` 校验 source fingerprint。源 PDF 是本地 gitignore 文件，**加载不需要 PDF，只需要 manifest**。
- `references/` 下的原始 PDF 永远不得进入构建产物，`packages/methodology/src/packaging-boundary.test.ts` 守着这条线。

### 2.5 Electron 当前接线

`apps/desktop/src/main/index.ts` 只装配了 4 个 Service：School / Judgment / Stage / State。**methodology 相关的仓储、Registry 加载、`syncRegistry` 在运行时一次都没被调用过。** 也就是说 `methodology_packs` 表在真实用户库里目前是空的。

---

## 3. 第一件事：一个必须先定的设计决策

**问题：激活状态最终归谁所有？**

约束是硬的：`standards_get` 要求 file Registry 与 SQLite projection **双方都是 active**；而打包后的 Electron 里，`knowledge/methodology/*/pack.json` 是只读的构建产物，运行时按不下一个能改写它的「启用」按钮。

两条自洽的路线：

**方案 A（推荐）——应用内审核签署，激活是版本事实**

- 应用内提供**审核工作台**：完整展示待审 Pack 的 construct / criterion / evidence guidance / guardrail / source locator，顾问逐条给结论并可留未决意见。
- 审核结论作为 **sign-off 记录**落库（绑定 `pack key + version + canonicalContentHash + 审核时间 + 逐条结论`）。
- `review → active` 的文件翻转由一条仓库脚本完成（校验 sign-off 存在、hash 一致、只走一步），改动 `pack.json` 的 `status` 字段后提交进仓库；应用启动时 `syncRegistry` 把 DB 推进到 active。
- 代价：激活需要一次仓库提交。但本产品是**单用户 / 本地优先 / 顾问自用开发工具**，顾问与开发者是同一个人，这个代价可接受。
- 收益：保住「文件 + DB 双 active」不变式，保住「Pack 是版本化知识派生物」的定位，与打包只读现实不冲突。

**方案 B——生命周期归 DB 独占**

- 放松 read plane 的「file registry 必须 active」为「内容一致 + DB active」，激活变成纯运行时动作。
- 代价：触碰上一轮刚冻结的不变式，`workbench-read-plane` 与其测试都要改，且「文件里写着 review 的东西在运行时是 active」本身是个认知陷阱。

**要求：动手前先向用户确认走 A 还是 B，并把结论写进本轮台账。** 如果用户没有异议，按 A 实施。

---

## 4. 本轮范围

按方案 A 描述。若改走 B，范围需相应重写后再确认。

### 4.1 必须交付

1. **启动时接线**：Electron main 加载 file Registry（`knowledge/methodology` + `references/SOURCE_MANIFEST.md`），构造 `SqliteMethodologyRepository`，启动时调用一次 `syncRegistry`。要处理好：打包后这两个路径在哪、加载失败时应用**仍能正常使用**（方法论缺失不该让整个工作台起不来），失败以安静的降级状态呈现而非崩溃。
2. **审核工作台 UI**：入口在**设置页 / 高级设置**之下，**不得进入一级导航**（PRD 第 5.1、5.6、44、46 章）。展示每个 Pack 的可审内容全文与当前状态，支持逐条结论与未决意见。语言按 PRD 5.6：默认不出现 `canonicalContentHash`、`projection`、`syncRegistry` 这类技术词，必要时收进「高级」折叠区。
3. **Sign-off 持久化**：新表 + 前向 migration（沿用 `packages/db/drizzle/` 既有做法，同步更新 journal 与 snapshot）。Sign-off 绑定到确切的 `key + version + canonicalContentHash`；内容一变，旧 sign-off 自动失效而不是静默沿用。
4. **激活脚本**：`package.json` 加一条命令，校验通过后把 `pack.json` 的 `status` 从 `review` 翻到 `active`。必须校验：sign-off 存在且 hash 匹配、只推进一步、内容未变。校验不过就拒绝并说明原因。
5. **本轮台账**：`docs/development/METHODOLOGY_PACK_ACTIVATION_STATUS.md`，沿用既有台账文风——边界、不变式、**本轮未做**、**已知限制**三段齐全，并如实记录第 2.3 节那些翻译质量问题的最终处置。
6. **更新 README** 的 Implementation Status 段（把本轮从「尚未接入」挪到「已接入」，或如实记录审核未通过的结论）。

### 4.2 明确不做

Agent Host、ACP / DSH / Codex、MCP 写面（`evidence_register` / `diagnosis_propose`）、启动 loopback server、把 `GroundedDiagnosisService` 接进 live flow、替换 `BaselineAssessmentEngine`、RAG / FTS / 向量检索、飞书、本地文件与音频 Evidence、教师实践纵切、Congruence Pack、Role Standards Pack、给 Pack 补翻译内容（若审核判定需要补，**单独一轮**做）。

---

## 5. 不可破坏的不变式

- 五条架构边界不动：Workbench 拥有状态 / Agent 拥有推理 / 人拥有最终判断 / ACP 管 Agent / MCP 暴露能力。
- Renderer 只走 typed IPC，永不直连 SQLite；外部输入一律 Zod 校验。
- 生命周期一步一跳，禁止回滚、跳级、retired 复活；`canonicalContentHash` 排除 `status`。
- 已提交的 Diagnosis 永远引用当时的 Pack 版本，不随 Pack 更新漂移。
- 不引入分数、权重、成熟度总分、学校排名——方法论层同样禁止。
- 原始 PDF 不进构建产物；`packaging-boundary.test.ts` 必须继续通过。
- 历史迁移不重写，只加前向迁移。

---

## 6. 纪律条款

- **实现与预期不符时不许硬凑，停下报告。** 尤其是：若顾问审核后认为 10 条 criterion 的翻译质量不足以约束真实判断（`description` 退化、`dimensionKey` 全空），**正确结果是「不激活 + 记录待补清单」，不是为了解锁下游而放行**。激活本身不是本轮的成功标准，「审核过程可信、结论可审计」才是。
- 台账里不写没验证过的数字。测试通过与否以**实际复跑输出**为准。
- 不声称任何「专业正确性」。本轮建立的仍然只是协议、引用与流程的正确性。

---

## 7. 验收

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm test:e2e
```

七条全过才算完。另需：

- 新增的 sign-off 表有 migration + repository 测试，覆盖 hash 漂移导致 sign-off 失效的情况；
- 生命周期推进有测试，覆盖合法一步推进与非法回滚 / 跳级 / retired 复活；
- 启动接线有测试或 E2E 覆盖「方法论加载失败时应用仍可用」；
- UI 有 React Testing Library 测试，覆盖审核结论提交与状态呈现。

提交遵循 Conventional Commits，本地提交、**不 push**，由用户验收后决定。
