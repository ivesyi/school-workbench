import {
  agentIpcChannels,
  agentRunViewSchema,
  runAgentInputSchema,
  type AgentRunView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

export type AgentIpcHandlers = {
  run(input: unknown): Promise<AgentRunView>
}

export type AgentRunner = (input: { schoolId: string; message: string }) => Promise<AgentRunView>

/**
 * IPC seam for driving one Agent Run.
 *
 * The agent runtime is only reachable when it is actually available: if the read
 * plane never started there is nothing to hand a capability token to, and the
 * caller is told so rather than being handed a half-wired agent.
 */
export function createAgentIpcHandlers(runner: () => AgentRunner | null): AgentIpcHandlers {
  return {
    async run(input) {
      const parsed = runAgentInputSchema.parse(input)
      const available = runner()
      if (!available) {
        throw new Error('The workbench read plane is not available, so no agent can be started')
      }
      return agentRunViewSchema.parse(await available(parsed))
    },
  }
}

export function registerAgentIpc(ipcMain: IpcMain, handlers: AgentIpcHandlers): void {
  ipcMain.handle(agentIpcChannels.run, (_event, input: unknown) => handlers.run(input))
}
