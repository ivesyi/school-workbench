# M3 高层进度文案 — 真 Codex 运行证据（2026-08-18）

台账引用：`docs/development/AI_RUNTIME_LOOP_LEDGER.md` §11.1。

这一轮跑的是真 Electron + 真 Codex（`codex-acp@1.4.0`，ACP session `01a01378-aacf-7c52-81da-643f7231f6cf`），
目的只有一个：把上一轮没抓到的「四句进度文案推进序列」完整记下来。

## 文件

| 文件                      | 是什么                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress-timeline.log`   | 运行过程中实时追加的原始记录。`IPC` 行 = 主进程实际广播的进度事件（renderer 侧第二个订阅者收到的）；`SCREEN` 行 = 每 400ms 读页面可见文本、只在那一行变化时记一条 |
| `agent-tool-calls.log`    | 这一轮 Codex 调用过的**全部 87 次工具**（来自 Codex 自己的 session rollout 日志），每行末尾是按 `nextProgressPhase` 重放出来的判定                                |
| `page-after-run.txt`      | 跑完时整页可见文本                                                                                                                                                |
| `database-after-run.json` | 跑完时的 `agent_runs` / `agent_sessions` / Agent 写入的 Evidence·Fact·Claim / `diagnosis_criteria` / 顾问确认前的 `accepted_judgments` 计数                       |
| `main-process-stderr.log` | 主进程 stderr 全文（技术原因只出现在这里，界面上没有）                                                                                                            |

## 结论（三条待验项逐条）

**① 四句按序出现 —— 否，这一轮只出现三句。**

```
understanding  正在理解学校现在的情况……      06:04:28.887
comparing      正在比较最近变化……            06:04:46.238
drafting       正在整理需要你确认的判断……    06:05:41.680
```

`gathering`（正在寻找相关材料……）**被跳过**。原因在 `agent-tool-calls.log` 里看得很清楚：Codex 第一批工作台调用是
`state_current` + `school_context` 同批到达，`state_current` 先把阶段推到了 `comparing`；等它 8 秒后再调
`evidence_list` / `diagnosis_list`（都映射到 `gathering`）时，只前进不后退的规则就把这句挡掉了。

这是设计使然，不是故障：PRD 16 列的是**允许显示的四句话**，不是必须依次出现的四拍。但「四句会依次走一遍」这个印象是错的，
台账和交付说明里都不该再这么写。

**② 只前进不后退 —— 是，且有多处直接证据。**

`school_context`（understanding，与 state_current 同批）、`stage_current`（understanding，06:04:54）、
`evidence_list` / `diagnosis_list`（gathering，06:04:54 与 06:04:59）、`standards_get`（gathering，06:06:34 起共 47 次）、
`diagnosis_propose`（drafting，06:09:04）——全部在更晚的时间到达，文案一次都没有回退或重复跳动。

**③ 只认工作台自己的工具 —— 是。**

87 次工具调用里，21 次不属于工作台：Codex 自有的 `exec` 19 次、`wait` 1 次，以及 Codex 内建 MCP server 的
`codex.list_mcp_resources` 1 次（06:06:50）。**这 21 次一次都没有产生进度事件**。最后这条尤其关键——它是一次真正的
MCP 工具调用，只是 server 名不是工作台的，被 `workbenchToolName()` 的 server 名锚定挡在了外面。

## 顺带记下的两件事

- `standards_get` 在 06:06:34–06:07:24 之间被调了 47 次且全部返回错误，之后 06:08:18 两次才成功。写面
  `diagnosis_propose` 也被契约拒过一次（`self_correction_rounds = 1`）。功能上没问题（最终产出了引用
  `schooling-by-design@1 / SBD.C4.SYSTEM_ALIGNMENT` 的合法判断），但 Agent 在参数上摸索的代价不小，值得后续看一眼工具描述。
- 主进程 stderr 出现一行 `agent runtime misreported MCP startup ...: the server served tool calls in this run`
  —— 这正是 M1 修 B3 时留下的如实记录：启动自检误报了，但因为该 server 确实服务了工具调用，run 没有被错误地记成失败。
