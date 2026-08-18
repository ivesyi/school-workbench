import { describe, expect, it } from 'vitest'
import {
  classifySessionUpdate,
  readSessionNotification,
  SessionUpdateObserver,
} from './session-updates'

describe('session update classification', () => {
  it('reads the kinds the workbench acts on', () => {
    expect(
      classifySessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      }),
    ).toEqual({ kind: 'agent_message', text: 'hello' })

    expect(
      classifySessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'mcp.example.state_current',
        status: 'pending',
      }),
    ).toEqual({
      kind: 'tool_call',
      toolCall: {
        toolCallId: 'call-1',
        title: 'mcp.example.state_current',
        status: 'pending',
        mcpStartupServerName: null,
        contentText: '',
      },
    })
  })

  it('ignores unknown update kinds instead of failing the run', () => {
    // SPEC 64: codex-acp must be able to ship new update kinds without the
    // workbench treating them as a protocol violation.
    const futureKinds = [
      'web_search',
      'image_generation',
      'subagent_started',
      'review_requested',
      'token_usage_v2',
      'something_nobody_has_invented_yet',
    ]
    for (const sessionUpdate of futureKinds) {
      expect(classifySessionUpdate({ sessionUpdate, payload: { anything: true } })).toEqual({
        kind: 'unrecognised',
        tag: sessionUpdate,
      })
    }
  })

  it('never throws on malformed input', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      'text',
      [],
      {},
      { sessionUpdate: 7 },
      { sessionUpdate: 'tool_call', toolCallId: 5, title: {}, status: [] },
      { sessionUpdate: 'agent_message_chunk', content: null },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } },
    ]
    for (const value of garbage) {
      expect(() => classifySessionUpdate(value)).not.toThrow()
    }
  })

  it('decodes the MCP startup failure codex-acp reports as a synthetic tool call', () => {
    const observed = classifySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_startup.school-workbench-internal-read-plane-3f9a1c',
      title: 'mcp__school-workbench-internal-read-plane-3f9a1c__startup',
      status: 'failed',
    })
    expect(observed.kind).toBe('tool_call')
    if (observed.kind !== 'tool_call') throw new Error('expected a tool call')
    expect(observed.toolCall.mcpStartupServerName).toBe(
      'school-workbench-internal-read-plane-3f9a1c',
    )
  })

  it('reads a notification envelope loosely', () => {
    expect(readSessionNotification({ sessionId: 's1', update: { sessionUpdate: 'plan' } })).toEqual(
      {
        sessionId: 's1',
        update: { sessionUpdate: 'plan' },
      },
    )
    expect(readSessionNotification({ update: 1 })).toEqual({ sessionId: null, update: 1 })
    expect(readSessionNotification({ sessionId: 's1' })).toBeNull()
    expect(readSessionNotification('nope')).toBeNull()
  })
})

describe('session update observer', () => {
  it('accumulates text, tool calls and unknown kinds without losing the turn', () => {
    const observer = new SessionUpdateObserver()

    observer.observe({ sessionUpdate: 'brand_new_kind' })
    observer.observe({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '这所学校' },
    })
    observer.observe({ sessionUpdate: 'brand_new_kind' })
    observer.observe({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1',
      title: 'mcp.workbench.school_context',
      status: 'completed',
    })
    observer.observe({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '现在的状态是……' },
    })
    observer.observe({ sessionUpdate: 'usage_update', used: { totalTokens: 1 } })

    expect(observer.text).toBe('这所学校现在的状态是……')
    expect(observer.unrecognisedTags).toEqual(['brand_new_kind'])
    expect(observer.toolCallTitles).toEqual(['mcp.workbench.school_context'])
    expect(observer.failedMcpStartups).toEqual([])
  })

  it('surfaces an MCP server the runtime says failed to start', () => {
    const observer = new SessionUpdateObserver()
    observer.observe({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_startup.some-server',
      title: 'mcp__some-server__startup',
      status: 'failed',
    })
    observer.observe({
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_startup.some-server',
      title: 'mcp__some-server__startup',
      status: 'failed',
    })
    expect(observer.failedMcpStartups).toEqual(['some-server'])
  })
})
