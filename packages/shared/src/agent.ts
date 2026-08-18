import { z } from 'zod'
import { judgmentReviewViewSchema } from './judgments'

/**
 * Agent Run contract crossing the IPC boundary.
 *
 * This is what the workbench UI is allowed to know about a run. It carries no
 * endpoint, capability token, filesystem path or session identifier: ADR-003
 * keeps infrastructure names off the product surface, and a token must never
 * leave the main process.
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
    /**
     * What the consultant typed. The cap matches what the workbench used to
     * accept for a situation report, so pasting a chunk of material still
     * works; the interface stops typing at the same number rather than letting
     * a long paste turn into an unexplained failure.
     */
    message: z.string().trim().min(1).max(20_000),
  })
  .strict()

/**
 * What the run produced, in product terms.
 *
 * The assistant's own prose never crosses this boundary. It arrives mixed with
 * the runtime's notices to itself ("Skill descriptions were shortened…"), and
 * PRD 16 keeps that class of noise away from the consultant entirely. What the
 * workbench keeps is the judgement the assistant submitted through the proper
 * channel, which is reviewable, and nothing else.
 */
export const agentRunOutcomeSchema = z.enum([
  'proposal_ready',
  'no_new_judgment',
  'needs_more_evidence',
  'failed',
])

export const agentRunViewSchema = z
  .object({
    runId: z.string().min(1),
    status: agentRunStatusSchema,
    outcome: agentRunOutcomeSchema,
    /** The judgement to review, when the assistant submitted one. */
    proposal: judgmentReviewViewSchema.nullable(),
    /**
     * What the assistant said it would still need, when it declined to judge.
     *
     * An abstention is a professional answer, not a failure: SPEC forbids
     * turning it into a judgement, and the workbench has no second path that
     * could produce one instead. So the only useful thing to show is what the
     * assistant is still missing.
     */
    abstention: z
      .object({
        unresolvedQuestions: z.array(z.string().min(1)),
        nextObservations: z.array(z.string().min(1)),
      })
      .strict()
      .nullable(),
    /** True when the agent actually reached the workbench MCP read tools. */
    usedWorkbenchTools: z.boolean(),
    /** `session/update` kinds this build did not understand. Ignored, reported. */
    unrecognisedUpdateKinds: z.array(z.string().min(1)),
    runtimeCompatibility: runtimeCompatibilitySchema,
    /**
     * Diagnostics for whoever is maintaining the workbench. Written by the
     * workbench itself, never by the assistant — and never rendered.
     */
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()

/**
 * The four steps PRD 16 allows the consultant to see. They are derived from the
 * workbench tools the assistant actually calls, so the wording follows real
 * activity rather than a timer, and they only ever move forward.
 */
export const agentProgressPhaseSchema = z.enum([
  'understanding',
  'gathering',
  'comparing',
  'drafting',
])

export const agentProgressEventSchema = z
  .object({
    schoolId: z.string().min(1),
    phase: agentProgressPhaseSchema,
  })
  .strict()

export const agentIpcChannels = {
  run: 'agent:run',
  progress: 'agent:progress',
} as const

export type AgentRunOutcomeValue = z.infer<typeof agentRunOutcomeSchema>
export type AgentProgressPhase = z.infer<typeof agentProgressPhaseSchema>
export type AgentProgressEvent = z.infer<typeof agentProgressEventSchema>
export type AgentRunStatusValue = z.infer<typeof agentRunStatusSchema>
export type RuntimeCompatibilityValue = z.infer<typeof runtimeCompatibilitySchema>
export type RunAgentInput = z.infer<typeof runAgentInputSchema>
export type AgentRunView = z.infer<typeof agentRunViewSchema>
