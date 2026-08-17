/**
 * SPEC 26 Agent Bootstrap.
 *
 * The wording is copied verbatim from `docs/architecture/SPEC.md` (chapter 26).
 * It is not paraphrased, shortened, translated or "improved" here: the SPEC
 * freezes the text, so any change belongs in the SPEC first.
 *
 * The block still mentions `diagnosis_propose` even though this slice only
 * exposes read tools. That is deliberate — the SPEC text is injected as written.
 */
const AGENT_BOOTSTRAP_LINES = [
  '你正在辅助学校变革陪跑顾问。',
  '',
  '正式学校状态来自 School Workbench MCP。',
  '',
  '不要把自己的 Session Memory 当作正式状态。',
  '',
  '如果需要当前学校情况：',
  '使用 school_context。',
  '',
  '如果需要学校正式状态：',
  '使用 state_current。',
  '',
  '如果形成新的专业判断：',
  '先登记真正使用的依据，',
  '再使用 diagnosis_propose。',
  '',
  '必须主动寻找相反证据。',
  '',
  '你没有权限替顾问确认最终判断。',
] as const

export const agentBootstrapText: string = AGENT_BOOTSTRAP_LINES.join('\n')

export const agentBootstrapLines: readonly string[] = Object.freeze([...AGENT_BOOTSTRAP_LINES])
