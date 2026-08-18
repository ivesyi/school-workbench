import type { AgentRunView } from '@school-workbench/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAgentIpcHandlers } from './agent-ipc'

const runView: AgentRunView = {
  runId: 'run-1',
  status: 'completed',
  outcome: 'proposal_ready',
  proposal: null,
  abstention: null,
  usedWorkbenchTools: true,
  unrecognisedUpdateKinds: [],
  runtimeCompatibility: 'verified',
  failureCode: null,
  failureMessage: null,
}

describe('agent IPC handlers', () => {
  it('validates input and forwards the run', async () => {
    const runner = vi.fn().mockResolvedValue(runView)
    const handlers = createAgentIpcHandlers(() => runner)

    await expect(
      handlers.run({ schoolId: 'school-1', message: '今天的中层会议里……' }),
    ).resolves.toEqual(runView)
    expect(runner).toHaveBeenCalledWith({ schoolId: 'school-1', message: '今天的中层会议里……' })
  })

  it('rejects malformed input before anything is spawned', async () => {
    const runner = vi.fn()
    const handlers = createAgentIpcHandlers(() => runner)

    await expect(handlers.run({ schoolId: '', message: 'hi' })).rejects.toThrow()
    await expect(handlers.run({ schoolId: 'school-1' })).rejects.toThrow()
    await expect(handlers.run({ schoolId: 'school-1', message: '' })).rejects.toThrow()
    await expect(
      handlers.run({ schoolId: 'school-1', message: 'x', extra: true }),
    ).rejects.toThrow()
    expect(runner).not.toHaveBeenCalled()
  })

  it('refuses to start an agent when the read plane never came up', async () => {
    const handlers = createAgentIpcHandlers(() => null)
    await expect(handlers.run({ schoolId: 'school-1', message: 'hi' })).rejects.toThrow(
      /read plane is not available/u,
    )
  })

  it('never lets a capability token or endpoint cross the IPC boundary', async () => {
    // ADR-003 keeps infrastructure names off the product surface, and a token
    // must never leave the main process.
    const handlers = createAgentIpcHandlers(() => async () => ({
      ...runView,
      // A runner that tried to smuggle extra fields is rejected by the schema.
      endpoint: 'http://127.0.0.1:1/internal/v1',
      token: 'a'.repeat(43),
    }))
    await expect(handlers.run({ schoolId: 'school-1', message: 'hi' })).rejects.toThrow()
  })
})
