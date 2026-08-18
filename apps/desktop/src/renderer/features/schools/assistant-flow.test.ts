import type { AgentRunView, AssistantSettingsView } from '@school-workbench/shared'
import { describe, expect, it } from 'vitest'
import {
  assistantFailureNote,
  assistantNote,
  canStartAnalysis,
  progressLabel,
  unavailableReason,
} from './assistant-flow'

function settings(
  availability: 'ready' | 'unavailable' = 'ready',
  detail: string | null = null,
): AssistantSettingsView {
  return {
    selected: 'codex',
    options: [{ key: 'codex', label: 'Codex', availability, detail }],
  }
}

function run(overrides: Partial<AgentRunView>): AgentRunView {
  return {
    runId: 'run-1',
    status: 'completed',
    outcome: 'no_new_judgment',
    proposal: null,
    abstention: null,
    usedWorkbenchTools: true,
    unrecognisedUpdateKinds: [],
    runtimeCompatibility: 'verified',
    failureCode: null,
    failureMessage: null,
    ...overrides,
  }
}

/** Everything PRD 16 and ADR-003 keep off the screen. */
const FORBIDDEN_WORDS = [
  'ACP',
  'MCP',
  'token',
  'Token',
  'session',
  'Session',
  'stdio',
  'loopback',
  'scope',
  'schema',
  'shell',
  'Shell',
  'JSON',
  'Codex 运行时',
  'Skill descriptions',
  'agent_run',
  'diagnosis_propose',
  'evidence_register',
]

describe('what the consultant sees while an assistant works', () => {
  it('uses PRD 16 wording, unchanged', () => {
    expect(progressLabel('understanding')).toBe('正在理解学校现在的情况……')
    expect(progressLabel('gathering')).toBe('正在寻找相关材料……')
    expect(progressLabel('comparing')).toBe('正在比较最近变化……')
    expect(progressLabel('drafting')).toBe('正在整理需要你确认的判断……')
  })

  it('never names a piece of machinery', () => {
    const everything = [
      progressLabel('understanding'),
      progressLabel('gathering'),
      progressLabel('comparing'),
      progressLabel('drafting'),
      assistantNote(run({ outcome: 'needs_more_evidence' })),
      assistantNote(run({ outcome: 'no_new_judgment' })),
      assistantNote(run({ outcome: 'failed', status: 'failed' })),
      assistantFailureNote('RUNTIME_NOT_FOUND'),
      assistantFailureNote('WORKBENCH_MCP_STARTUP_FAILED'),
      assistantFailureNote('WORKBENCH_MCP_TOOLS_INVISIBLE'),
      assistantFailureNote('RUNTIME_UNSUPPORTED'),
      assistantFailureNote('AGENT_RUN_FAILED'),
      assistantFailureNote(null),
      unavailableReason(settings('unavailable')) ?? '',
    ].join('\n')

    for (const word of FORBIDDEN_WORDS) {
      expect(everything, word).not.toContain(word)
    }
  })

  it('offers a retry when a run failed, and never claims to have written anything down', () => {
    for (const code of [
      'RUNTIME_NOT_FOUND',
      'RUNTIME_UNSUPPORTED',
      'WORKBENCH_MCP_STARTUP_FAILED',
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      'AGENT_RUN_FAILED',
      null,
    ]) {
      const note = assistantFailureNote(code)
      expect(note, String(code)).toContain('重试')
      expect(note, String(code)).toContain('你写的内容还在')
      // Nothing was recorded on the assistant's behalf, so nothing may say it was.
      expect(note, String(code)).not.toContain('记下来了')
      expect(note, String(code)).not.toContain('判断')
    }
  })

  it('says nothing extra when there is a judgement to look at', () => {
    expect(assistantNote(run({ outcome: 'proposal_ready' }))).toBe('')
  })

  it('reports an abstention as an abstention, not as a judgement or a failure', () => {
    const abstained = assistantNote(run({ outcome: 'needs_more_evidence' }))
    expect(abstained).toContain('目前依据不足，暂不形成判断')
    expect(abstained).not.toContain('记下来了')
    expect(assistantNote(run({ outcome: 'no_new_judgment' }))).not.toContain('依据不足')
  })
})

describe('whether new analysis can start at all', () => {
  it('needs an assistant that can actually start on this computer', () => {
    expect(canStartAnalysis(settings())).toBe(true)
    expect(canStartAnalysis(settings('unavailable'))).toBe(false)
    expect(canStartAnalysis(null)).toBe(false)
  })

  it('stays quiet until the settings have been read', () => {
    // Otherwise a perfectly working machine is accused of missing something for
    // the fraction of a second before the answer arrives.
    expect(unavailableReason(null)).toBeNull()
    expect(unavailableReason(settings())).toBeNull()
  })

  it('explains in plain words why analysis is unavailable', () => {
    expect(unavailableReason(settings('unavailable', '这台电脑上还没有装好 Codex。'))).toBe(
      '这台电脑上还没有装好 Codex。',
    )
    expect(unavailableReason(settings('unavailable'))).toContain('不能开始新的分析')
  })
})
