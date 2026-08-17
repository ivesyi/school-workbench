import { describe, expect, it } from 'vitest'
import { workbenchMcpServerName } from './mcp-descriptor'
import { decidePermission, isWorkbenchToolCall } from './permission-policy'

const options = [
  { optionId: 'a1', kind: 'allow_once' },
  { optionId: 'a2', kind: 'allow_always' },
  { optionId: 'r1', kind: 'reject_once' },
  { optionId: 'r2', kind: 'reject_always' },
]

describe('permission policy', () => {
  it('recognises workbench tool calls by server name, not by tool name', () => {
    expect(isWorkbenchToolCall(`mcp.${workbenchMcpServerName}.state_current`)).toBe(true)
    expect(isWorkbenchToolCall(`mcp__${workbenchMcpServerName}__state_current`)).toBe(true)
    expect(isWorkbenchToolCall('mcp.some-other-server.state_current')).toBe(false)
    expect(isWorkbenchToolCall('state_current')).toBe(false)
    expect(isWorkbenchToolCall(null)).toBe(false)
    expect(isWorkbenchToolCall(undefined)).toBe(false)
  })

  it('allows a workbench read tool once, never always', () => {
    expect(
      decidePermission({
        toolCallTitle: `mcp.${workbenchMcpServerName}.school_context`,
        options,
      }),
    ).toEqual({ outcome: 'selected', optionId: 'a1', reason: 'workbench_read_tool' })
  })

  it('rejects everything else once', () => {
    for (const title of ['shell', 'apply_patch', 'mcp.other.read_file', null]) {
      expect(decidePermission({ toolCallTitle: title, options })).toEqual({
        outcome: 'selected',
        optionId: 'r1',
        reason: 'rejected_by_policy',
      })
    }
  })

  it('rejects a workbench call that only offers a standing grant', () => {
    expect(
      decidePermission({
        toolCallTitle: `mcp.${workbenchMcpServerName}.school_context`,
        options: [
          { optionId: 'a2', kind: 'allow_always' },
          { optionId: 'r1', kind: 'reject_once' },
        ],
      }),
    ).toEqual({ outcome: 'selected', optionId: 'r1', reason: 'rejected_by_policy' })
  })

  it('cancels when the agent offered nothing this policy can take', () => {
    expect(decidePermission({ toolCallTitle: 'shell', options: [] })).toEqual({
      outcome: 'cancelled',
      reason: 'no_usable_option',
    })
    expect(
      decidePermission({
        toolCallTitle: 'shell',
        options: [{ optionId: 'a2', kind: 'allow_always' }],
      }),
    ).toEqual({ outcome: 'cancelled', reason: 'no_usable_option' })
  })
})
