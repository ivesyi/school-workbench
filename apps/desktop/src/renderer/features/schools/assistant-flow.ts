import type {
  AgentProgressPhase,
  AgentRunView,
  AssistantOptionView,
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
 * Whether new analysis can be started at all right now.
 *
 * Analysis is the assistant's work, and the workbench has nothing that could do
 * it instead. So when the assistant cannot start on this computer, the answer
 * is not "do it another way" — it is "not yet". Everything already recorded
 * stays readable either way.
 */
export function canStartAnalysis(settings: AssistantSettingsView | null): boolean {
  if (!settings) return false
  return settings.options.some(
    (option) => option.key === settings.selected && option.availability === 'ready',
  )
}

/**
 * Why new analysis is unavailable, in the consultant's words.
 *
 * Returns null while the answer is still unknown, so the page can stay quiet
 * rather than accusing a perfectly working machine of missing something.
 */
export function unavailableReason(settings: AssistantSettingsView | null): string | null {
  if (!settings) return null
  if (canStartAnalysis(settings)) return null
  const chosen = settings.options.find((option) => option.key === settings.selected)
  return chosen?.detail ?? 'AI 助手在这台电脑上还没准备好，暂时不能开始新的分析。'
}

/**
 * The other assistants that could be tried right now.
 *
 * Peers, not fallbacks (PRD 15). Nothing in the product picks one of these,
 * ranks them, or moves to one after a failure — the list exists so a person can
 * choose. It is empty whenever there is nothing to choose between, and the
 * control that shows it disappears with it rather than offering a switch to
 * nowhere.
 */
export function switchableAssistants(
  settings: AssistantSettingsView | null,
): readonly AssistantOptionView[] {
  if (!settings) return []
  return settings.options.filter(
    (option) => option.key !== settings.selected && option.availability === 'ready',
  )
}

/**
 * What the consultant is told when a run ends without a judgement to confirm.
 *
 * Each of these is a different professional situation, and none of them is
 * covered up by the workbench inventing something to show instead.
 */
export function assistantNote(run: AgentRunView): string {
  switch (run.outcome) {
    case 'needs_more_evidence':
      return '目前依据不足，暂不形成判断。AI 助手看过这所学校已有的材料，认为还不足以支撑一条正式判断。'
    case 'no_new_judgment':
      return 'AI 助手看过这所学校的情况，这次没有形成需要你确认的新判断。'
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
 * Every one of them ends in the same place: try again. Nothing is written down
 * on the assistant's behalf.
 */
export function assistantFailureNote(failureCode: string | null): string {
  switch (failureCode) {
    case 'RUNTIME_NOT_FOUND':
    case 'WORKBENCH_MCP_NOT_FOUND':
      return 'AI 助手在这台电脑上还没准备好，这次没能开始。你写的内容还在，装好之后可以直接重试。'
    case 'RUNTIME_UNSUPPORTED':
      return 'AI 助手的版本和工作台对不上，这次没能开始。你写的内容还在，更新之后可以直接重试。'
    case 'WORKBENCH_MCP_TOOLS_INVISIBLE':
      return 'AI 助手没有拿到学校资料接口，因此这次没有开始分析。你写的内容还在，可以稍后重试。'
    case 'WORKBENCH_MCP_STARTUP_FAILED':
      return 'AI 助手这次没有成功开始分析。你写的内容还在，可以稍后再点击重试。'
    default:
      return 'AI 助手这次没能完成。你写的内容还在，可以过一会儿再重试。'
  }
}
