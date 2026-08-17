import type {
  AgentProgressPhase,
  AgentRunView,
  AssistantSettingsView,
} from '@school-workbench/shared'

/**
 * The four steps PRD 16 allows on screen, word for word.
 *
 * Nothing else is ever shown while an assistant works: no commands, no tool
 * payloads, no identifiers, and none of the assistant's own prose.
 */
const PROGRESS_LABELS: Readonly<Record<AgentProgressPhase, string>> = Object.freeze({
  understanding: '正在理解学校现在的情况……',
  gathering: '正在寻找相关材料……',
  comparing: '正在比较最近变化……',
  drafting: '正在整理需要你确认的判断……',
})

export function progressLabel(phase: AgentProgressPhase): string {
  return PROGRESS_LABELS[phase]
}

/**
 * Whether this sentence should go to an assistant first.
 *
 * Two things have to be true: the consultant chose one, and it can actually
 * start on this computer. Asking every time would be exactly the selector
 * PRD 14 rules out.
 */
export function shouldAskAssistant(settings: AssistantSettingsView | null): boolean {
  if (!settings || settings.selected === 'none') return false
  return settings.options.some(
    (option) => option.key === settings.selected && option.availability === 'ready',
  )
}

/**
 * What to tell the consultant when the assistant finished without a judgement.
 *
 * Every branch ends the same way in practice: the workbench records what was
 * said anyway, so nothing is lost. These sentences explain the difference
 * without naming a single piece of machinery.
 */
export function assistantNote(run: AgentRunView): string {
  switch (run.outcome) {
    case 'needs_more_evidence':
      return 'AI 助手看过这所学校的情况，觉得现在的依据还不足以下判断。我先把你说的这条记下来了。'
    case 'no_new_judgment':
      return 'AI 助手看过这所学校的情况，这次没有形成需要你确认的新判断。我先把你说的这条记下来了。'
    case 'failed':
      return assistantFailureNote(run.failureCode)
    case 'proposal_ready':
      return ''
  }
}

/**
 * Plain sentences for the ways an assistant can fail to start or finish.
 *
 * The underlying message is written for whoever maintains the workbench and can
 * contain paths and identifiers, so it never reaches the screen; only these do.
 */
export function assistantFailureNote(failureCode: string | null): string {
  switch (failureCode) {
    case 'RUNTIME_NOT_FOUND':
    case 'WORKBENCH_MCP_NOT_FOUND':
      return 'AI 助手在这台电脑上还没准备好。我先把你说的这条记下来了，你可以照常继续。'
    case 'RUNTIME_UNSUPPORTED':
      return 'AI 助手的版本和工作台对不上。我先把你说的这条记下来了，你可以照常继续。'
    case 'WORKBENCH_MCP_TOOLS_INVISIBLE':
    case 'WORKBENCH_MCP_STARTUP_FAILED':
      return 'AI 助手这次没能连上这所学校的资料。我先把你说的这条记下来了，可以过一会儿再试。'
    default:
      return 'AI 助手这次没能完成。我先把你说的这条记下来了，可以过一会儿再试。'
  }
}
