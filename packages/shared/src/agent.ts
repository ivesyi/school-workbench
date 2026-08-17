import { z } from 'zod'

/**
 * Agent Run contract crossing the IPC boundary.
 *
 * There is no consultant-facing agent UI in this slice (PRD 15/16 are later),
 * so this surface exists to drive and observe a real Agent Run, not to render
 * one. It deliberately carries no endpoint, capability token, filesystem path
 * or ACP session id: ADR-003 keeps infrastructure names out of the product
 * surface, and a token must never leave the main process.
 */
export const agentRunStatusSchema = z.enum([
  'queued',
  'running',
  'needs_input',
  'completed',
  'failed',
  'cancelled',
])

export const runtimeCompatibilitySchema = z.enum(['verified', 'compatible', 'unsupported'])

export const runAgentInputSchema = z
  .object({
    schoolId: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(4_000),
  })
  .strict()

export const agentRunViewSchema = z
  .object({
    runId: z.string().min(1),
    status: agentRunStatusSchema,
    /** What the agent said, if anything. */
    message: z.string(),
    /** True when the agent actually reached the workbench MCP read tools. */
    usedWorkbenchTools: z.boolean(),
    /** `session/update` kinds this build did not understand. Ignored, reported. */
    unrecognisedUpdateKinds: z.array(z.string().min(1)),
    runtimeCompatibility: runtimeCompatibilitySchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()

export const agentIpcChannels = {
  run: 'agent:run',
} as const

/**
 * Preload-only bridge.
 *
 * This is deliberately *not* part of `WorkbenchApi`: the renderer has no agent
 * surface in this slice, and adding one to the renderer contract would invite a
 * UI that PRD 15/16 place in a later slice. The bridge exists so the main
 * process path can be driven end to end.
 */
export type AgentBridge = {
  agent: {
    run(input: RunAgentInput): Promise<AgentRunView>
  }
}

export type AgentRunStatusValue = z.infer<typeof agentRunStatusSchema>
export type RuntimeCompatibilityValue = z.infer<typeof runtimeCompatibilitySchema>
export type RunAgentInput = z.infer<typeof runAgentInputSchema>
export type AgentRunView = z.infer<typeof agentRunViewSchema>
