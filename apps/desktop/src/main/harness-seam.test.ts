import {
  harnessKeys,
  harnessResultFromAcpOutcome,
  workbenchMcpServerName,
  type AgentRunOutcome,
} from '@school-workbench/agent-host'
import { assistantChoiceSchema } from '@school-workbench/shared'
import { describe, expect, it } from 'vitest'
import { runtimeProfiles } from './agent-runtime'
import { ASSISTANT_LABELS } from './settings-ipc'

/**
 * The Harness seam, checked from the one place that can see both sides.
 *
 * `packages/agent-host` sits below the shared contracts and must not import
 * them (SPEC 7), so the list of assistants exists twice: once as the driver
 * keys the host knows, once as the choices the product stores. Two lists that
 * are supposed to be the same list is the classic way a preference ends up
 * naming a driver that does not exist. This app depends on both, so it is where
 * they are held to each other.
 */
describe('the assistants the workbench knows about', () => {
  it('names the same set on both sides of the Harness seam', () => {
    expect([...harnessKeys].sort()).toEqual([...assistantChoiceSchema.options].sort())
  })

  it('has a runtime profile and a consultant-facing label for every one of them', () => {
    for (const key of assistantChoiceSchema.options) {
      expect(runtimeProfiles[key]?.key, key).toBe(key)
      expect(ASSISTANT_LABELS[key], key).toBeTruthy()
    }
  })

  it('never puts an implementation name in front of the consultant', () => {
    const labels = Object.values(ASSISTANT_LABELS).join('\n')
    for (const word of [
      'pi',
      'harness',
      'provider',
      'agent-core',
      'ACP',
      'MCP',
      'OpenAI',
      'SDK',
      'loop',
    ]) {
      expect(labels, word).not.toContain(word)
    }
  })
})

function acpOutcome(overrides: Partial<AgentRunOutcome> = {}): AgentRunOutcome {
  return {
    status: 'completed',
    statusHistory: ['queued', 'running', 'completed'],
    compatibility: {
      compatibility: 'verified',
      protocolVersion: 1,
      agentName: 'codex-acp',
      agentVersion: '1.4.0',
      missingCapabilities: [],
      contractTest: 'passed',
      detail: 'fine',
    },
    acpSessionId: 'acp-session-1',
    stopReason: 'end_turn',
    text: '看完了。',
    unrecognisedUpdateTags: ['some_new_kind'],
    toolCallTitles: [
      `mcp.${workbenchMcpServerName}.school_context`,
      'read file',
      `mcp__${workbenchMcpServerName}__diagnosis_propose`,
    ],
    usedWorkbenchTools: true,
    mcpStartupReportedFailure: false,
    workspaceCwd: '/tmp/run-1',
    failure: null,
    ...overrides,
  }
}

describe('the Codex path seen through the Harness seam', () => {
  it('projects an ACP outcome without losing anything the workbench records', () => {
    const result = harnessResultFromAcpOutcome(acpOutcome())

    expect(result.status).toBe('completed')
    expect(result.statusHistory).toEqual(['queued', 'running', 'completed'])
    expect(result.text).toBe('看完了。')
    expect(result.usedWorkbenchTools).toBe(true)
    expect(result.unrecognisedRuntimeSignals).toEqual(['some_new_kind'])
    expect(result.session).toEqual({
      externalSessionId: 'acp-session-1',
      cwd: '/tmp/run-1',
      compatibility: 'verified',
      protocolVersion: 1,
      agentName: 'codex-acp',
      agentVersion: '1.4.0',
    })
  })

  it('reduces namespaced tool call titles to the bare names every harness reports', () => {
    const result = harnessResultFromAcpOutcome(acpOutcome())
    // The unrelated `read file` call is not a workbench tool and is dropped,
    // exactly as the progress line already drops it.
    expect(result.workbenchToolCalls).toEqual(['school_context', 'diagnosis_propose'])
  })

  it('carries a failure across unchanged', () => {
    const result = harnessResultFromAcpOutcome(
      acpOutcome({
        status: 'failed',
        failure: { code: 'WORKBENCH_MCP_STARTUP_FAILED', message: 'server did not start' },
      }),
    )
    expect(result.failure).toEqual({
      code: 'WORKBENCH_MCP_STARTUP_FAILED',
      message: 'server did not start',
    })
  })
})
