import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ClientContext,
  type InitializeResponse,
  type NewSessionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import {
  observeInboundMessages,
  type AcpRuntimeConnection,
  type AcpRuntimeLauncher,
} from './acp-runtime'
import { AgentHostError } from './contracts'
import {
  buildWorkbenchMcpDescriptor,
  workbenchMcpServerName,
  type WorkbenchMcpDescriptorInput,
} from './mcp-descriptor'
import { verifyWorkbenchMcpTools } from './mcp-visibility'
import { isWorkbenchToolCall } from './permission-policy'
import { readSessionNotification, SessionUpdateObserver } from './session-updates'
import { createSessionWorkspace, type SessionWorkspace } from './session-workspace'

/**
 * A connection test: does the assistant, on this computer, actually get as far
 * as answering?
 *
 * `local-tool-status.ts` answers a different and much weaker question — whether
 * the two command-line tools can be found on disk. Installed software says
 * nothing about whether the model behind it can be reached, and the failure
 * this exists for lives exactly there: a runtime that starts perfectly, sends
 * the model something the account's backend rejects, and then tears down the
 * still-starting workbench tool server on the way out. Nothing short of really
 * running a turn can see that.
 *
 * Two rules make this safe to offer as a button:
 *
 *  - **No school data leaves the workbench.** The prompt below is the entire
 *    input; it mentions no school, no consultant text and no judgement.
 *  - **Nothing is written down.** The probe creates no Agent Run, no session
 *    row and no domain row: it is deliberately not given anything that could.
 *    It asks the assistant not to use tools, and a tool it did call would be
 *    read-only anyway — the probe holds read scopes only.
 *
 * The result is shown to a person and nothing else. It never routes, gates,
 * downgrades or retries anything: multiple assistants are peers and switching
 * between them is a human decision (PRD 15).
 */

/** How long a probe may take before the workbench stops waiting. */
export const DEFAULT_CONNECTION_CHECK_TIMEOUT_MS = 60_000

/**
 * The whole probe input.
 *
 * Deliberately not the SPEC 26 bootstrap: that text tells the assistant to go
 * and read a school, and there is no school here. Nothing in this string is
 * business data.
 */
export const connectionCheckPromptText =
  '这是一次连接测试，与任何学校无关。请只回复两个字：可以。不要使用任何工具，也不要提问。'

/**
 * How a probe ended.
 *
 * Every value is derived from something the runtime actually did, never from a
 * version string or a guess. `workbench_tools_cancelled` is its own value
 * rather than a kind of failure because it is the signature of the incident
 * this check was built for: the runtime cancelled a tool server that was still
 * starting, which is a symptom of the turn collapsing, not of bad wiring.
 */
export const connectionCheckOutcomes = [
  'ok',
  'runtime_unavailable',
  'workbench_tools_unavailable',
  'workbench_tools_cancelled',
  'model_backend_unreachable',
  'timed_out',
] as const

export type ConnectionCheckOutcome = (typeof connectionCheckOutcomes)[number]

export type McpStartupReportKind = 'not_reported' | 'cancelled' | 'failed'

export type AssistantConnectionCheckResult = Readonly<{
  outcome: ConnectionCheckOutcome
  /** For whoever maintains the workbench. Never shown to a consultant. */
  detail: string
  durationMs: number
  protocolVersion: number | null
  agentName: string | null
  agentVersion: string | null
  /** True when the runtime came back with text of its own. */
  modelAnswered: boolean
  /** What the runtime said about the workbench tool server's startup. */
  mcpStartup: McpStartupReportKind
  /**
   * Workbench tool calls the probe caused. Expected to stay empty: the probe
   * asks for none, and it is reported so a test can hold that to account.
   */
  workbenchToolCalls: readonly string[]
}>

export type AssistantConnectionCheckRequest = Readonly<{
  /** Same descriptor a real run would inject, so the same wiring is exercised. */
  mcp: WorkbenchMcpDescriptorInput
  workspaceRoot?: string
  forbiddenWorkspaceRoots: readonly string[]
  timeoutMs?: number
}>

export type AssistantConnectionCheckOptions = Readonly<{
  clientName?: string
  verifyTools?: typeof verifyWorkbenchMcpTools
  onDiagnostic?: (message: string) => void
  now?: () => number
}>

/**
 * codex-acp writes the reason into the synthetic startup report: "failed to
 * start: ..." versus "startup was cancelled.". That one word is the whole
 * difference between "the workbench tool server is broken" and "the turn was
 * torn down before the server finished starting", so it is read rather than
 * flattened into a single failure.
 */
export function classifyMcpStartupReport(reportText: string): McpStartupReportKind {
  return /cancel/iu.test(reportText) ? 'cancelled' : 'failed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readVersion(initializeResponse: unknown): Readonly<{
  protocolVersion: number | null
  agentName: string | null
  agentVersion: string | null
}> {
  const response = isRecord(initializeResponse) ? initializeResponse : null
  const rawVersion = response?.['protocolVersion']
  const agentInfo = isRecord(response?.['agentInfo']) ? response['agentInfo'] : null
  const name = agentInfo && typeof agentInfo['name'] === 'string' ? agentInfo['name'] : null
  const version =
    agentInfo && typeof agentInfo['version'] === 'string' ? agentInfo['version'] : null
  return Object.freeze({
    protocolVersion:
      typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : null,
    agentName: name,
    agentVersion: version,
  })
}

/** Host errors that mean the workbench tool surface, not the runtime, is at fault. */
const TOOL_SURFACE_ERROR_CODES = new Set([
  'WORKBENCH_MCP_NOT_FOUND',
  'WORKBENCH_MCP_TOOLS_INVISIBLE',
  'WORKBENCH_MCP_STARTUP_FAILED',
  'MCP_DESCRIPTOR_INVALID',
])

/**
 * Runs one throwaway assistant turn and reports what happened.
 *
 * Total by construction: every path returns a result. A probe that threw would
 * be indistinguishable from an assistant that is down, which is the one thing
 * this must never confuse.
 */
export async function runAssistantConnectionCheck(
  launcher: AcpRuntimeLauncher,
  request: AssistantConnectionCheckRequest,
  options: AssistantConnectionCheckOptions = {},
): Promise<AssistantConnectionCheckResult> {
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const updates = new SessionUpdateObserver()

  let timedOut = false
  let identity = readVersion(null)
  let caught: unknown = null
  let workspace: SessionWorkspace | null = null
  let connection: AcpRuntimeConnection | null = null

  const deadline = new AbortController()
  let reachDeadline: () => void = () => undefined
  const deadlineReached = new Promise<'deadline'>((resolvePromise) => {
    reachDeadline = () => resolvePromise('deadline')
  })
  const timer = setTimeout(() => {
    timedOut = true
    // The polite route first: an agent that honours `session/cancel` ends its
    // own turn.
    deadline.abort()
    // Then the transport is closed under it, for a runtime that ignores
    // cancellation.
    void connection?.close().catch(() => undefined)
    // And finally the answer is given regardless. Neither of the two routes
    // above is guaranteed to make a wedged runtime return, and a consultant
    // waiting on a button must get an answer even when nothing else does. The
    // turn is left to unwind on its own; the throwaway workspace is still
    // cleaned up when it does.
    reachDeadline()
  }, request.timeoutMs ?? DEFAULT_CONNECTION_CHECK_TIMEOUT_MS)
  timer.unref?.()

  const probe = async (): Promise<void> => {
    workspace = await createSessionWorkspace({
      ...(request.workspaceRoot === undefined ? {} : { root: request.workspaceRoot }),
      forbiddenRoots: request.forbiddenWorkspaceRoots,
    })
    const created = workspace

    const descriptor = buildWorkbenchMcpDescriptor(request.mcp)

    // Same contract test a real run performs, for the same reason: a tool
    // server that cannot list its tools is a different problem from a model
    // that cannot be reached, and the consultant deserves to be told which.
    const verify = options.verifyTools ?? verifyWorkbenchMcpTools
    await verify(descriptor)

    const launched = await launcher.launch()
    connection = launched
    try {
      const clientApp = client({ name: options.clientName ?? 'school-workbench' })
        .onNotification(
          methods.client.session.update,
          (params: unknown) => params,
          () => undefined,
        )
        .onRequest(
          methods.client.session.requestPermission,
          async (): Promise<RequestPermissionResponse> => {
            // A probe grants nothing. There is no consultant watching this and
            // no work worth authorising.
            options.onDiagnostic?.('connection check declined a permission request')
            return { outcome: { outcome: 'cancelled' } }
          },
        )

      const observed = observeInboundMessages(launched.stream, (message) => {
        if (!isRecord(message)) return
        if (message['method'] !== methods.client.session.update) return
        const notification = readSessionNotification(message['params'])
        if (!notification) return
        updates.observe(notification.update)
      })

      await clientApp.connectWith(observed, async (context: ClientContext) => {
        const initializeResponse: InitializeResponse = await context.request(
          methods.agent.initialize,
          {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: Object.freeze({}),
            clientInfo: { name: 'School Workbench', version: '0.1.0' },
          },
        )
        identity = readVersion(initializeResponse)

        const sessionRequest: NewSessionRequest = {
          cwd: created.cwd,
          mcpServers: [{ ...descriptor, args: [...descriptor.args], env: [...descriptor.env] }],
        }
        const session = await context.buildSession(sessionRequest).start()
        try {
          const onAbort = (): void => {
            void context
              .notify(methods.agent.session.cancel, { sessionId: session.sessionId })
              .catch(() => undefined)
          }
          deadline.signal.addEventListener('abort', onAbort, { once: true })
          try {
            return await session.prompt([{ type: 'text', text: connectionCheckPromptText }])
          } finally {
            deadline.signal.removeEventListener('abort', onAbort)
          }
        } finally {
          session.dispose()
          await context
            .request(methods.agent.session.close, { sessionId: session.sessionId })
            .catch(() => undefined)
        }
      })
    } finally {
      await launched.close()
    }
  }

  const finished = probe()
    .catch((error: unknown) => {
      caught = error
    })
    .finally(() => {
      clearTimeout(timer)
      // Disposal is chained to the probe rather than awaited by the caller, so
      // a wedged runtime cannot delay the answer and cannot leak the directory
      // either.
      void workspace?.dispose().catch(() => undefined)
    })

  await Promise.race([finished, deadlineReached])

  const startupReport = updates.mcpStartupReports.find(
    (report) => report.serverName === workbenchMcpServerName,
  )
  const mcpStartup: McpStartupReportKind = startupReport
    ? classifyMcpStartupReport(startupReport.text)
    : 'not_reported'
  const workbenchToolCalls = updates.toolCallTitles.filter(isWorkbenchToolCall)
  const modelAnswered = updates.text.trim().length > 0
  const durationMs = Math.max(0, now() - startedAt)

  const base = {
    durationMs,
    protocolVersion: identity.protocolVersion,
    agentName: identity.agentName,
    agentVersion: identity.agentVersion,
    modelAnswered,
    mcpStartup,
    workbenchToolCalls: Object.freeze([...workbenchToolCalls]),
  } as const

  const finish = (
    outcome: ConnectionCheckOutcome,
    detail: string,
  ): AssistantConnectionCheckResult => Object.freeze({ ...base, outcome, detail })

  if (timedOut) {
    return finish('timed_out', 'The assistant did not answer within the time the check allows.')
  }
  if (mcpStartup === 'cancelled') {
    return finish(
      'workbench_tools_cancelled',
      'The runtime cancelled the workbench tool server while it was still starting, which happens when the turn itself collapses.',
    )
  }
  if (mcpStartup === 'failed') {
    return finish(
      'workbench_tools_unavailable',
      'The runtime reported that the workbench tool server failed to start.',
    )
  }
  if (caught instanceof AgentHostError) {
    return finish(
      TOOL_SURFACE_ERROR_CODES.has(caught.code)
        ? 'workbench_tools_unavailable'
        : 'runtime_unavailable',
      `${caught.code}: ${caught.message}`,
    )
  }
  if (caught !== null) {
    return finish(
      'model_backend_unreachable',
      `The turn did not complete: ${caught instanceof Error ? caught.message : String(caught)}`,
    )
  }
  if (!modelAnswered) {
    return finish(
      'model_backend_unreachable',
      'The turn finished without the assistant saying anything, so the model behind it did not answer.',
    )
  }
  return finish('ok', 'The assistant answered a trivial prompt on this computer.')
}
