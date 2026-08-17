# School Workbench Project Handoff

- **交接日期：** 2026-08-17
- **交接基线：** `main` / `4119e7cbeee67fcf1fa6c78989dc4e2a1c0cd2a3`
- **远端状态：** 基线提交与 `origin/main` 一致；形成本文前工作区干净
- **总体判断：** 本地核心业务闭环与只读 MCP 基础已经建立；真实 Agent Workbench 尚未贯通。

本文是新 Agent 的单一接管入口。各 `*_STATUS.md` 记录单个纵切完成时的边界，其中部分 “Still Deferred” 已被后续提交实现，判断当前状态时以本文、当前代码和 Git 历史为准。

## 1. 产品与架构不可破坏的边界

- 产品是单用户、Local-first 的 Electron 桌面工作台，不是管理后台、CRM、LMS 或通用 Agent IDE。
- UX 保持 Quiet Workbench：顾问只感知“说情况 → 做判断 → 看变化”，不得把 Evidence、Claim、Snapshot 等数据模型做成主导航或技术表单。
- Workbench 拥有正式状态，Agent 只负责推理，顾问拥有最终判断权；ACP 管理 Agent，MCP 只暴露受控能力。
- Renderer 只能使用 typed IPC；Renderer、Agent 与 MCP 子进程都不得直接访问 SQLite。
- `DiagnosisProposal` immutable。接受、修改、驳回、要求补证写入 `HumanReview`；只有接受或修改产生 `AcceptedJudgment`。
- Agent 不得通过 MCP 接受诊断、激活阶段或提交状态。正式判断和状态变更始终需要人类确认。
- Ontology 是可机器校验的领域语义，不是通用规则引擎；Concept 存在不等于必须新增数据库表。
- Methodology 提供规范和评估约束；Evidence 约束判断；RAG 将来只负责检索，不能直接评分或替代 Assessment Contract。
- 不引入学校当前阶段/快照冗余指针；当前状态由不可变历史记录推导。

权威基线：

- 产品与 UX：`docs/product/PRD.md`
- 架构与协议：`docs/architecture/SPEC.md`
- 数据模型：`docs/data/DATABASE_SCHEMA.md`
- ADR：`docs/architecture/ADR-001-electron-desktop.md` 至 `ADR-003-ui-system.md`
- 认识论：`knowledge/epistemic/EPISTEMIC_MODEL.md`
- 仓库协作规则：根目录 `AGENTS.md`

## 2. 当前仓库结构

```text
apps/desktop                 Electron Main / Preload / React Renderer
packages/shared              typed IPC DTO 与 Zod contract
packages/domain              Domain entity、factory、repository port
packages/application         Application service 与可替换本地 engine
packages/db                  Drizzle schema、migration、SQLite adapter
packages/ontology            Ontology loader 与引用校验
packages/methodology         Methodology pack contract/loader/registry
packages/assessment          strict Assessment Contract + Golden Harness
packages/experience          Quiet Workbench tokens/components
packages/workbench-read-plane DTO、授权、服务与 loopback Internal Local API
packages/workbench-mcp       官方 MCP v2 stdio 子进程
knowledge/                   版本化 ontology / methodology 内容
references/                  原始资料索引；本地 PDF 不得进入 Git 或构建产物
tests/e2e                    Electron 纵切与重启持久化测试
docs/development             各纵切状态与本交接文档
```

## 3. 已完成并验证的能力

| 里程碑                         | 关键提交                        | 当前能力                                                                                                        |
| ------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Foundation                     | `db15c4e` 及后续修正            | Electron + React + SQLite、创建学校、typed IPC、重启持久化                                                      |
| Ontology / Epistemic 校准      | `7cc5aaa`                       | `ontic / normative / epistemic / methodology` 四层；Claim、HumanReview、AcceptedJudgment、Assessment 等语义归位 |
| 本地认识链纵切                 | `bf7e2c8` 及审核动作修正        | 自然语言输入 → Evidence → ObservationFact → Claim → Proposal → HumanReview → AcceptedJudgment                   |
| 阶段纵切                       | `e5e4f0d`、`1ac185c`、`d26f0d4` | 基于正式判断形成阶段建议；顾问调整/确认；五个 StageTargets 原子确认                                             |
| 学校状态                       | `5aea142`、`47c3556`            | Baseline Snapshot #1、下一状态、五维差异、不可变历史与重启恢复                                                  |
| Methodology Registry           | `eb906f9`、`453a1c4`            | Schooling by Design v1、Data Wise v3 结构化 Pack、hash/fingerprint/lifecycle/SQLite 投影                        |
| Assessment Quality Gate        | `a8b8273`、`eb29b38`            | strict input/candidate、claim scope、counter-evidence、Golden cases、fail-closed validator                      |
| Grounded Diagnosis Persistence | `0afbb6b`                       | 校验后 immutable Proposal 持久化、规范化 FK provenance、stale/cross-school/atomicity 校验                       |
| MCP Read Plane                 | `4119e7c`                       | 作用域 token、loopback API、官方 MCP v2 stdio、7 个只读工具                                                     |

当前 UI 已能人工演示：创建学校；在自然语言入口提交观察；查看低置信度提案依据；执行认同、修改、不认同或补证；形成正式判断；确认阶段；建立基线状态；加入新判断并确认下一状态；重启后恢复正式判断、阶段、状态和差异。

最近一次完整本地验证针对 `4119e7c`，使用 Node 24 + pnpm 11：

```text
pnpm install --frozen-lockfile       通过
Drizzle migration/schema drift      无漂移
pnpm format                          通过
pnpm lint                            通过
pnpm typecheck                       通过
pnpm test                            38 files / 131 tests 通过
pnpm build                           通过
pnpm test:e2e                        6/6 通过
```

当前机器默认是 Node `26.7.0`、pnpm `11.19.0`；冻结目标仍是 Node 24 / pnpm 11，CI 与发布判断必须以 Node 24 为准。

## 4. 当前 MCP Read Plane 的精确边界

已暴露且只有以下工具：

```text
school_context   -> school.read
stage_current    -> stage.read
state_current    -> state.read
state_history    -> state.read
evidence_list    -> evidence.read
diagnosis_list   -> diagnosis.read
standards_get    -> standards.read
```

Internal Local API 只绑定 `127.0.0.1` 随机端口。短期 capability token 保存在内存中，绑定 `agentRunId + schoolId + exact scopes`，默认 5 分钟、最大 15 分钟，支持 revoke；服务重启自然失效。MCP 子进程不打开数据库，只通过 loopback API 读取。

重要：目前只有 bootstrap factory。Electron 不会启动 read plane，也没有 Agent Host 消费它。仓库内两个真实 Methodology Pack 均保持 `review`，所以产品态 `standards_get` 会返回 `no_active_pack`；测试中的 active pack 是隔离 fixture，不代表顾问已经批准方法包。

## 5. 下一位 Agent 必须先处理的三个审查缺口

`4119e7c` 的自动化测试通过，但尚未完成语义验收。以下问题未修复，也尚未发送给此前远程开发 Agent。

### P0 — `standards_get` 不可发现

现实现和当前 SPEC 要求 Agent 同时提供 `packKey + version`，且没有 catalog 工具。Agent 若只知道学校阶段、维度或实践类型，无法发现未来新增或激活的方法包；这会迫使 prompt 或 Agent 预先硬编码版本。

建议修复：

- `packKey` 与 `version` 改为可选的成对 exact selector；只提供其中一个应 fail closed。
- 无 selector 时，在所有 file Registry 与 SQLite 投影均为 `active` 且 hash/fingerprint/projection 精确一致的 Pack 中执行有界语义查询。
- 仍必须提供 `dimensionKeys / practiceType / criterionRefs` 至少一个，不允许整包泄漏。
- 返回统一的 `packs[]`，每项携带 pack/version/hash provenance 与最小相关 criteria/constructs/anchors/guidance/guardrails/locators。
- 未知 selector、歧义 criterion、漂移、review/retired 状态必须 fail closed；补 service、SQLite、stdio integration tests，并同步 SPEC/status 文档。

如果新 Agent认为 exact-only 是刻意产品选择，必须先显式解决“Agent 如何发现 active pack/version”，不能仅以当前 SPEC 已被改成 required 作为完成依据。

### P0 — State read provenance 校验不完整

`packages/db/src/sqlite-read-plane-repository.ts#loadState` 当前只检查 `stage_id` 非空：

- 未验证该 Stage 属于 Snapshot 的同一 School；
- 未验证 `previous_snapshot_id` 属于同一 School；
- 未验证前序 Snapshot 的 sequence 恰为当前 `sequence - 1`；
- `is_baseline` 对任何非 `1` 的值都静默映射为 `false`。

应在返回 formal state 前 fail closed，并增加至少这些 corruption tests：跨学校 Stage、跨学校 previous Snapshot、断裂/错误 sequence、非法 baseline 值。建议同时明确并验证：sequence 1 必须 baseline 且无 previous；sequence > 1 必须非 baseline 且链接精确前序。不要依赖 SQLite FK 代替 school-scope 语义校验。

### P1 — Electron 主进程错误打包 Fastify

`packages/db/src/sqlite-read-plane-repository.ts` 从 `@school-workbench/workbench-read-plane` 根 barrel 导入纯 contract。根 barrel 同时导出 `loopback.ts`，导致 Electron main bundle 包含 Fastify / light-my-request。

当前证据：

```text
apps/desktop/out/main/index.js = 1,734,436 bytes
构建产物可检出 fastify 代码
```

应改用 `@school-workbench/workbench-read-plane/contracts` 等纯 subpath，并增加可维护的 packaging boundary test，证明 Electron main 在 Agent Host 尚未显式接入 loopback server 时不含 Fastify/light-my-request。不要用一次性的体积阈值掩盖依赖边界问题。

## 6. 推荐后续关键路径

严格按纵切推进，避免一次性铺开基础设施：

1. **Read Plane hardening**：只修上面三个问题；全套测试、构建和 Electron E2E 通过后再继续。
2. **MCP Write Plane**：实现 `evidence_register` 与 `diagnosis_propose`。后者必须复用 `AssessmentInput / AssessmentCandidate → validateAssessmentCandidate → GroundedDiagnosisService`，不能引入第二套宽松 contract。不得暴露 human review、state commit 或 stage activation。
3. **Agent Host 最小纵切**：由 Workbench 启停 loopback、签发/撤销 scoped token、启动 MCP stdio 子进程、记录 AgentRun 生命周期，并用测试 Runtime 先贯通 UI 输入 → Agent candidate → validated Proposal → 现有 HumanReview UI。此阶段不接飞书和 RAG。
4. **Methodology 人工审核与激活**：为两份 machine-readable Pack 提供顾问可理解的审核路径；核对 stable IDs、措辞、evidence guidance、guardrails、locators、fingerprints 与 hashes 后才允许 `review → active`。不要在测试外偷偷激活。
5. **真实 ACP / Runtime**：在最小 Agent Host 协议稳定后接 Codex/DSH。模型输出永远先过 strict schema 和 quality gate；不保存隐藏思维链。
6. **飞书授权与材料入口**：业务操作继续使用官方 `lark-cli`；Workbench 只实现薄 `FeishuAuthCoordinator`。UX 冻结为默认浏览器优先、同屏二维码、授权后自动恢复原任务，不使用内嵌浏览器、不复制 URL/device code。
7. **文件/音频与教师实践纵切**：接真实 Evidence ingestion，并用 Data Wise 检查教师能否从材料中看见自身实践；仍需可追溯 Evidence → Fact → Claim。
8. **其他方法框架与检索**：Congruence、Role Standards 各自完成可审查结构化 Pack 后再接入。只有真实材料量与检索需求出现后才增加 FTS/vector/RAG；检索结果不能成为 Criterion 或 Evidence 本身。
9. **交付收口**：安全审计、错误恢复、性能、数据备份/迁移、macOS 打包签名、公证、升级策略和最终人工验收。

## 7. 明确尚未完成

- `evidence_register`、`diagnosis_propose` MCP write tools；
- Agent Host、AgentRun persistence、ACP、真实 Codex/DSH runtime；
- Electron 与 MCP read plane 的运行时装配；
- Methodology review/activation UX；
- 飞书 `lark-cli`、默认浏览器/二维码授权和任务自动恢复；
- 本地文件、音频、飞书材料 ingestion；
- 教师实践/Data Wise 实际评估纵切；
- Congruence 与 Role Standards structured packs；
- RAG/FTS/vector retrieval；
- 任意生产级模型准确率结论；
- 安装包、签名、公证、自动更新和最终交付审计。

不要把 Assessment Golden Harness 的协议正确性理解为教育判断准确率，也不要把当前 deterministic baseline engines 理解为真实 Agent 能力。

## 8. 新 Agent 的第一轮操作

```bash
git status --short
git rev-parse HEAD
git pull --ff-only origin main
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

先阅读：`AGENTS.md`、本文、PRD、SPEC、DATABASE_SCHEMA、ADR-001 至 ADR-003、`EPISTEMIC_MODEL.md` 和 `WORKBENCH_MCP_READ_PLANE_STATUS.md`。然后只实现第 5 节的 read-plane hardening；不要顺手新增 Agent Host、写工具、数据库实体或 Pack 激活。

每轮交付至少说明：commit SHA、改变的 frozen requirement/contract、schema 或 protocol 是否变化、自动化结果、Electron 人工验收路径、已知限制。涉及可见 UX 时提供截图。不要宣称未执行的浏览器或人工验收已经通过。

## 9. Git 与协作状态

- 交接前 `main == origin/main == 4119e7cbeee67fcf1fa6c78989dc4e2a1c0cd2a3`，工作区干净。
- 此前计划通过一个远程 ChatGPT 开发 Agent 交叉编排，但该流程现在暂停；最后一份 read-plane hardening 反馈因浏览器 bridge detached **没有成功发送**。
- 新 Agent 应以本地仓库、本文和权威文档为依据，不假设远程 Agent 已处理任何第 5 节问题。
- 仓库历史存在 `x`、`dummy` 等无意义提交，但当前不应为整理历史做 rebase/reset；继续用清晰的 Conventional Commit，保留既有历史。
