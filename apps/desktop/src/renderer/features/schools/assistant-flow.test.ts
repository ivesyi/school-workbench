import type { AgentRunView, AssistantSettingsView } from '@school-workbench/shared'
import { describe, expect, it } from 'vitest'
import {
  assistantFailureNote,
  assistantNote,
  progressLabel,
  shouldAskAssistant,
} from './assistant-flow'

function settings(
  selected: AssistantSettingsView['selected'],
  availability: 'ready' | 'unavailable' = 'ready',
): AssistantSettingsView {
  return {
    selected,
    options: [
      { key: 'codex', label: 'Codex', availability, detail: null },
      { key: 'none', label: '暂不使用 AI 助手', availability: 'ready', detail: null },
    ],
  }
}

function run(overrides: Partial<AgentRunView>): AgentRunView {
  return {
    runId: 'run-1',
    status: 'completed',
    outcome: 'no_new_judgment',
    proposal: null,
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
    ].join('\n')

    for (const word of FORBIDDEN_WORDS) {
      expect(everything, word).not.toContain(word)
    }
  })

  it('always tells the consultant the sentence was kept', () => {
    // The assistant not producing a judgement must never mean the consultant's
    // words were thrown away.
    for (const outcome of ['needs_more_evidence', 'no_new_judgment', 'failed'] as const) {
      expect(
        assistantNote(run({ outcome, status: outcome === 'failed' ? 'failed' : 'completed' })),
      ).toContain('记下来了')
    }
  })

  it('says nothing extra when there is a judgement to look at', () => {
    expect(assistantNote(run({ outcome: 'proposal_ready' }))).toBe('')
  })

  it('distinguishes an abstention from having nothing to say', () => {
    expect(assistantNote(run({ outcome: 'needs_more_evidence' }))).toContain('依据还不足')
    expect(assistantNote(run({ outcome: 'no_new_judgment' }))).not.toContain('依据还不足')
  })
})

describe('deciding whether to ask an assistant', () => {
  it('asks only when one was chosen and can actually start', () => {
    expect(shouldAskAssistant(settings('codex'))).toBe(true)
    expect(shouldAskAssistant(settings('codex', 'unavailable'))).toBe(false)
    expect(shouldAskAssistant(settings('none'))).toBe(false)
    expect(shouldAskAssistant(null)).toBe(false)
  })

  it('never asks before the settings have been read', () => {
    // Otherwise the very first sentence after launch could go somewhere the
    // consultant never chose.
    expect(shouldAskAssistant(null)).toBe(false)
  })
})
