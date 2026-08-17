import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientContext,
  type InitializeResponse,
  type NewSessionRequest,
  type PromptResponse,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import { observeInboundMessages, type AcpRuntimeLauncher } from './acp-runtime'
import { agentBootstrapText } from './bootstrap'
import { AgentHostError, type AgentRunStatus } from './contracts'
import { buildWorkbenchMcpDescriptor, type WorkbenchMcpDescriptorInput } from './mcp-descriptor'
import { verifyWorkbenchMcpTools } from './mcp-visibility'
import {
  decidePermission,
  isWorkbenchToolCall,
  workbenchToolName,
  type PermissionOptionLike,
} from './permission-policy'
import { AgentRunLifecycle } from './run-status'
import { readSessionNotification, SessionUpdateObserver } from './session-updates'
import { createSessionWorkspace, type SessionWorkspace } from './session-workspace'
import {
  assessRuntimeCompatibility,
  type ContractTestOutcome,
  type RuntimeCompatibilityAssessment,
} from './runtime-compatibility'

/**
 * ACP client capabilities advertised by the workbench.
 *
 * D2 / SPEC 13: `fs` and `terminal` are deliberately absent. Advertising them
 * would open a second route from the agent into the consultant's machine beside
 * MCP, and SPEC 13 makes the workbench MCP server the *only* formal interface
 * to workbench domain capability. ACP permits a client to advertise neither, so
 * the host advertises neither and registers no handler for those methods.
 */
export const workbenchClientCapabilities = Object.freeze({})

export type AgentHostRunRequest = Readonly<{
  schoolId: string
  agentRunId: string
  /** What the consultant actually said. Injected after the SPEC 26 bootstrap. */
  consultantMessage: string
  /** Everything needed to describe the workbench MCP server to the agent. */
  mcp: Omit<WorkbenchMcpDescriptorInput, 'schoolId' | 'agentRunId'>
  /** Directory the throwaway session workspace is created under. */
  workspaceRoot?: string
  /** Directories the session workspace must never overlap (workbench user data). */
  forbiddenWorkspaceRoots: readonly string[]
  signal?: AbortSignal
}>

export type AgentRunFailure = Readonly<{ code: string; message: string }>

export type AgentRunOutcome = Readonly<{
  status: AgentRunStatus
  statusHistory: readonly AgentRunStatus[]
  compatibility: RuntimeCompatibilityAssessment
  acpSessionId: string | null
  stopReason: string | null
  text: string
  /** `session/update` kinds this build did not understand. Ignored, not fatal. */
  unrecognisedUpdateTags: readonly string[]
  /** Titles of tool calls the agent reported. Never includes MCP startup diagnostics. */
  toolCallTitles: readonly string[]
  /** True when the agent demonstrably called a workbench MCP tool during this run. */
  usedWorkbenchTools: boolean
  /**
   * True when the runtime reported that the workbench MCP server failed to
   * start. Recorded even when direct evidence contradicted it, so a
   * misreported startup stays visible instead of disappearing.
   */
  mcpStartupReportedFailure: boolean
  workspaceCwd: string | null
  failure: AgentRunFailure | null
}>

export type AgentHostOptions = Readonly<{
  clientName?: string
  /**
   * Verifies that the workbench MCP descriptor really exposes the frozen read
   * tools. Defaults to actually running the server over stdio.
   */
  verifyTools?: typeof verifyWorkbenchMcpTools
  onStatus?: (status: AgentRunStatus) => void
  onDiagnostic?: (message: string) => void
  /**
   * Called with the bare workbench tool name each time the agent uses one.
   *
   * This is the only honest source for a progress indicator: it follows what
   * the agent actually did rather than a timer. Tool calls routed through any
   * other MCP server never reach it, so nothing from outside the workbench can
   * end up described to the consultant.
   */
  onWorkbenchToolCall?: (tool: string) => void
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPermissionOptions(params: unknown): PermissionOptionLike[] {
  if (!isRecord(params) || !Array.isArray(params['options'])) return []
  return params['options'].flatMap((option) =>
    isRecord(option) && typeof option['optionId'] === 'string' && typeof option['kind'] === 'string'
      ? [{ optionId: option['optionId'], kind: option['kind'] }]
      : [],
  )
}

function readToolCallTitle(params: unknown): string | null {
  if (!isRecord(params)) return null
  const toolCall = params['toolCall']
  if (!isRecord(toolCall)) return null
  return typeof toolCall['title'] === 'string' ? toolCall['title'] : null
}

/**
 * Maps an ACP stop reason onto the frozen Agent Run states (SPEC 61).
 *
 * Only an explicit cancellation is `cancelled`. Every other terminal stop
 * reason means the turn genuinely ended, including `refusal`: the agent
 * declining is an outcome, not an infrastructure failure. Unknown future stop
 * reasons are treated as a completed turn rather than a failure, for the same
 * reason unknown session updates are ignored — a newer runtime must not be able
 * to turn a finished turn into an error.
 */
export function statusForStopReason(stopReason: string | null): 'completed' | 'cancelled' {
  return stopReason === 'cancelled' ? 'cancelled' : 'completed'
}

/**
 * SPEC 7 Agent Host.
 *
 * Runtime discovery → Spawn → ACP initialize → Capability negotiation →
 * Session → Prompt → Status → Permission → Cancel → Teardown.
 *
 * No school domain logic lives here. The host receives an already-issued
 * capability token and an already-resolved MCP descriptor, and hands back the
 * protocol-level outcome.
 */
export class AgentHost {
  constructor(
    private readonly launcher: AcpRuntimeLauncher,
    private readonly options: AgentHostOptions = {},
  ) {}

  async run(request: AgentHostRunRequest): Promise<AgentRunOutcome> {
    const lifecycle = new AgentRunLifecycle(this.options.onStatus)
    const updates = new SessionUpdateObserver()
    let compatibility: RuntimeCompatibilityAssessment = assessRuntimeCompatibility({
      requestedProtocolVersion: PROTOCOL_VERSION,
      initializeResponse: null,
      contractTest: 'skipped',
    })
    let acpSessionId: string | null = null
    let stopReason: string | null = null
    let failure: AgentRunFailure | null = null
    let mcpStartupReportedFailure = false

    let workspace: SessionWorkspace | null = null
    let workspaceCwd: string | null = null

    try {
      // D3: one throwaway empty directory per Agent Run, never the workbench
      // user data directory, removed again during teardown. Created inside the
      // try so a rejected workspace is reported as a failed run like any other
      // problem, instead of escaping this method.
      const created = await createSessionWorkspace({
        ...(request.workspaceRoot === undefined ? {} : { root: request.workspaceRoot }),
        forbiddenRoots: request.forbiddenWorkspaceRoots,
      })
      workspace = created
      workspaceCwd = created.cwd

      const descriptor = buildWorkbenchMcpDescriptor({
        ...request.mcp,
        schoolId: request.schoolId,
        agentRunId: request.agentRunId,
      })

      // Contract test leg of SPEC 62: the descriptor really serves the frozen
      // read tools, and none of the SPEC 25 write tools.
      let contractTest: ContractTestOutcome = 'skipped'
      const verify = this.options.verifyTools ?? verifyWorkbenchMcpTools
      try {
        await verify(descriptor)
        contractTest = 'passed'
      } catch (error) {
        contractTest = 'failed'
        throw error
      }

      const connection = await this.launcher.launch()
      try {
        const clientApp = client({ name: this.options.clientName ?? 'school-workbench' })
          // `session/update` is registered with a permissive parser so the host
          // never rejects a payload shape; unknown kinds are ignored, not fatal.
          .onNotification(
            methods.client.session.update,
            (params: unknown) => params,
            () => undefined,
          )
          .onRequest(
            methods.client.session.requestPermission,
            async (context): Promise<RequestPermissionResponse> => {
              // Status: a permission request is exactly the "waiting on a human
              // action" case SPEC 39 folds into `needs_input`. The reason stays
              // out of the database.
              if (lifecycle.status === 'running') lifecycle.transition('needs_input')
              const decision = decidePermission({
                toolCallTitle: readToolCallTitle(context.params),
                options: readPermissionOptions(context.params),
              })
              if (lifecycle.status === 'needs_input') lifecycle.transition('running')
              this.options.onDiagnostic?.(`agent permission request: ${decision.reason}`)
              return decision.outcome === 'selected'
                ? { outcome: { outcome: 'selected', optionId: decision.optionId } }
                : { outcome: { outcome: 'cancelled' } }
            },
          )

        const observed = observeInboundMessages(connection.stream, (message) => {
          if (!isRecord(message)) return
          if (message['method'] !== methods.client.session.update) return
          const notification = readSessionNotification(message['params'])
          if (!notification) return
          const seen = updates.observe(notification.update)
          if (seen.kind !== 'tool_call') return
          const tool = workbenchToolName(seen.toolCall.title)
          if (tool) this.options.onWorkbenchToolCall?.(tool)
        })

        const outcome = await clientApp.connectWith(observed, async (context: ClientContext) => {
          // ACP initialize.
          const initializeResponse: InitializeResponse = await context.request(
            methods.agent.initialize,
            {
              protocolVersion: PROTOCOL_VERSION,
              clientCapabilities: workbenchClientCapabilities,
              clientInfo: { name: 'School Workbench', version: '0.1.0' },
            },
          )

          // Capability negotiation (SPEC 62). No hard-coded version comparison.
          compatibility = assessRuntimeCompatibility({
            requestedProtocolVersion: PROTOCOL_VERSION,
            initializeResponse,
            contractTest,
          })
          if (compatibility.compatibility === 'unsupported') {
            throw new AgentHostError('RUNTIME_UNSUPPORTED', compatibility.detail)
          }

          // Session.
          const sessionRequest: NewSessionRequest = {
            cwd: created.cwd,
            mcpServers: [{ ...descriptor, args: [...descriptor.args], env: [...descriptor.env] }],
          }
          const session = await context.buildSession(sessionRequest).start()
          acpSessionId = session.sessionId

          try {
            // Cancel: an aborted run sends `session/cancel` and lets the agent
            // finish the turn with `stopReason: "cancelled"`.
            const onAbort = () => {
              void context
                .notify(methods.agent.session.cancel, { sessionId: session.sessionId })
                .catch(() => undefined)
            }
            request.signal?.addEventListener('abort', onAbort, { once: true })

            // Prompt: SPEC 26 bootstrap first, verbatim, then the consultant's text.
            lifecycle.transition('running')
            let promptResponse: PromptResponse
            try {
              promptResponse = await session.prompt([
                { type: 'text', text: agentBootstrapText },
                { type: 'text', text: request.consultantMessage },
              ])
            } finally {
              request.signal?.removeEventListener('abort', onAbort)
            }

            // codex-acp reports a server that failed or was cancelled at
            // startup as a synthetic failed tool call. That report is a claim
            // about one fact: whether the server became ready.
            //
            // A tool call routed through that same server is a direct
            // observation of the very same fact, and it is stronger evidence
            // than the report: the report can time out while the server is
            // still coming up (observed on a cold start), but a tool result
            // cannot arrive from a server that never started.
            //
            // So the report fails the run unless the run itself contradicts
            // it. This cannot swallow a genuine startup failure: a server that
            // truly did not start serves no tools, so there is nothing to
            // contradict it with, and the run still fails hard. The
            // contradiction is recorded either way.
            if (updates.failedMcpStartups.includes(descriptor.name)) {
              mcpStartupReportedFailure = true
              if (!updates.toolCallTitles.some(isWorkbenchToolCall)) {
                throw new AgentHostError(
                  'WORKBENCH_MCP_STARTUP_FAILED',
                  `The agent runtime reported that MCP server ${descriptor.name} failed to start`,
                )
              }
              this.options.onDiagnostic?.(
                `agent runtime misreported MCP startup for ${descriptor.name}: the server served tool calls in this run`,
              )
            }

            return promptResponse
          } finally {
            session.dispose()
            // Best effort: `session/close` is an optional agent capability, so
            // a runtime that does not implement it must not fail the teardown.
            await context
              .request(methods.agent.session.close, { sessionId: session.sessionId })
              .catch(() => undefined)
          }
        })

        stopReason = typeof outcome.stopReason === 'string' ? outcome.stopReason : null
        lifecycle.settle(statusForStopReason(stopReason))
      } finally {
        // Teardown.
        await connection.close()
      }
    } catch (error) {
      const code = error instanceof AgentHostError ? error.code : 'AGENT_RUN_FAILED'
      const message = error instanceof Error ? error.message : String(error)
      failure = Object.freeze({ code, message })
      lifecycle.settle('failed')
      this.options.onDiagnostic?.(`agent run failed: ${code}`)
    } finally {
      await workspace?.dispose()
    }

    return Object.freeze({
      status: lifecycle.status,
      statusHistory: lifecycle.history,
      compatibility,
      acpSessionId,
      stopReason,
      text: updates.text,
      unrecognisedUpdateTags: updates.unrecognisedTags,
      toolCallTitles: updates.toolCallTitles,
      usedWorkbenchTools: updates.toolCallTitles.some(isWorkbenchToolCall),
      mcpStartupReportedFailure,
      workspaceCwd,
      failure,
    })
  }
}
