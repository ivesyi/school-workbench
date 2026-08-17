/**
 * Frozen contracts for the Agent Host.
 *
 * SPEC 7 keeps this package on the ACP boundary only: no school domain logic
 * lives here. Everything in this file is protocol or lifecycle vocabulary.
 */

/**
 * SPEC 61 / SPEC 39. The Agent Run state set is frozen at six values and the
 * database schema must not gain a seventh. `needs_input` alone covers every
 * kind of wait (Feishu authorization, the agent asking the consultant for more
 * information, any other future human action); the concrete reason is Experience
 * Layer state and never becomes a database enum value.
 */
export const agentRunStatuses = [
  'queued',
  'running',
  'needs_input',
  'completed',
  'failed',
  'cancelled',
] as const

export type AgentRunStatus = (typeof agentRunStatuses)[number]

/** SPEC 62. Runtime compatibility is a three-state judgement, never a version match. */
export const runtimeCompatibilityStates = ['verified', 'compatible', 'unsupported'] as const

export type RuntimeCompatibility = (typeof runtimeCompatibilityStates)[number]

/**
 * SPEC 18. The workbench MCP read tools this slice expects to be visible to the
 * agent. Kept as a literal list so a contract test can compare it against what
 * the real MCP server advertises.
 */
export const workbenchReadToolNames = [
  'school_context',
  'stage_current',
  'state_current',
  'state_history',
  'evidence_list',
  'diagnosis_list',
  'standards_get',
] as const

export type WorkbenchReadToolName = (typeof workbenchReadToolNames)[number]

/**
 * SPEC 25. These must never be reachable by an agent. They are declared as an
 * explicit negative list rather than being "protected" by not existing yet, so
 * that a contract test fails the moment one of them shows up on the MCP surface.
 */
export const forbiddenAgentToolNames = [
  'diagnosis_accept',
  'diagnosis_reject',
  'state_commit',
  'stage_activate',
] as const

export type ForbiddenAgentToolName = (typeof forbiddenAgentToolNames)[number]

/**
 * SPEC 17. Write scopes are out of scope for the read slice; only these six may
 * be attached to a capability token here.
 */
export const readOnlyCapabilityScopes = [
  'school.read',
  'stage.read',
  'state.read',
  'evidence.read',
  'diagnosis.read',
  'standards.read',
] as const

export type ReadOnlyCapabilityScope = (typeof readOnlyCapabilityScopes)[number]

/**
 * ACP client methods this host deliberately does not implement.
 *
 * D2: `fs/*` and `terminal/*` are a second route from the agent into the
 * consultant's machine, parallel to MCP, which contradicts SPEC 13's "MCP is the
 * only formal interface". ACP allows a client to simply not advertise them, so
 * the host advertises neither the capability nor a handler.
 */
export const withheldClientMethods = [
  'fs/read_text_file',
  'fs/write_text_file',
  'terminal/create',
  'terminal/output',
  'terminal/release',
  'terminal/wait_for_exit',
  'terminal/kill',
] as const

export type WithheldClientMethod = (typeof withheldClientMethods)[number]

export const agentHostErrorCodes = [
  'RUNTIME_NOT_FOUND',
  'RUNTIME_UNSUPPORTED',
  'RUNTIME_SPAWN_FAILED',
  'WORKBENCH_MCP_NOT_FOUND',
  'WORKBENCH_MCP_TOOLS_INVISIBLE',
  'WORKBENCH_MCP_STARTUP_FAILED',
  'SESSION_WORKSPACE_INVALID',
  'MCP_DESCRIPTOR_INVALID',
  'RUN_TRANSITION_INVALID',
] as const

export type AgentHostErrorCode = (typeof agentHostErrorCodes)[number]

export class AgentHostError extends Error {
  constructor(
    readonly code: AgentHostErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentHostError'
  }
}
