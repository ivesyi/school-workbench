import { describe, expect, it } from 'vitest'
import { agentRunStatuses } from './contracts'
import {
  AgentRunLifecycle,
  assertTransition,
  canTransition,
  isAgentRunStatus,
  isTerminalAgentRunStatus,
} from './run-status'

describe('agent run states', () => {
  it('freezes exactly the six SPEC 61 states and nothing else', () => {
    expect([...agentRunStatuses]).toEqual([
      'queued',
      'running',
      'needs_input',
      'completed',
      'failed',
      'cancelled',
    ])
    expect(isAgentRunStatus('needs_input')).toBe(true)
    // SPEC 39: the reason a run waits never becomes its own status.
    expect(isAgentRunStatus('needs_feishu_authorization')).toBe(false)
    expect(isAgentRunStatus('waiting_for_consultant')).toBe(false)
  })

  it('treats completed, failed and cancelled as terminal', () => {
    expect(agentRunStatuses.filter((status) => isTerminalAgentRunStatus(status))).toEqual([
      'completed',
      'failed',
      'cancelled',
    ])
  })

  it('allows a run to pause for a human action and resume', () => {
    expect(canTransition('running', 'needs_input')).toBe(true)
    expect(canTransition('needs_input', 'running')).toBe(true)
    expect(canTransition('needs_input', 'completed')).toBe(true)
  })

  it('refuses to move out of a terminal state or to skip queued', () => {
    expect(canTransition('completed', 'running')).toBe(false)
    expect(canTransition('cancelled', 'running')).toBe(false)
    expect(canTransition('failed', 'completed')).toBe(false)
    expect(canTransition('queued', 'needs_input')).toBe(false)
    expect(canTransition('queued', 'completed')).toBe(false)
    expect(() => assertTransition('completed', 'failed')).toThrowError(/cannot move/)
  })
})

describe('agent run lifecycle', () => {
  it('records the whole path a normal run takes', () => {
    const seen: string[] = []
    const lifecycle = new AgentRunLifecycle((status) => seen.push(status))

    lifecycle.transition('running')
    lifecycle.transition('needs_input')
    lifecycle.transition('running')
    lifecycle.transition('completed')

    expect(lifecycle.status).toBe('completed')
    expect(lifecycle.history).toEqual(['queued', 'running', 'needs_input', 'running', 'completed'])
    expect(seen).toEqual(['running', 'needs_input', 'running', 'completed'])
    expect(lifecycle.isTerminal).toBe(true)
  })

  it('keeps the first terminal outcome when teardown settles again', () => {
    const lifecycle = new AgentRunLifecycle()
    lifecycle.transition('running')
    lifecycle.transition('cancelled')

    expect(lifecycle.settle('failed')).toBe('cancelled')
    expect(lifecycle.history).toEqual(['queued', 'running', 'cancelled'])
  })

  it('rejects an illegal transition instead of silently rewriting history', () => {
    const lifecycle = new AgentRunLifecycle()
    expect(() => lifecycle.transition('completed')).toThrowError(/cannot move from queued/)
    expect(lifecycle.status).toBe('queued')
  })
})
