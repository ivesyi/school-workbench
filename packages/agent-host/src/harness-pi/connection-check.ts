import {
  connectionCheckPromptText,
  DEFAULT_CONNECTION_CHECK_TIMEOUT_MS,
  type AssistantConnectionCheckResult,
  type ConnectionCheckOutcome,
} from '../connection-check'
import type { HarnessCapabilityGrant } from '../harness/contracts'
import {
  CONNECTION_CHECK_MAX_TURNS,
  PiHarnessDriver,
  piHarnessAgentName,
  type PiHarnessDependencies,
} from './driver'

/**
 * The connection test for the built-in assistant.
 *
 * Same question the ACP probe answers — *can this computer actually reach a
 * model right now* — asked of a harness that has no subprocess, no protocol
 * handshake and no separate tool server. So the same six outcomes are reported,
 * and the two that cannot arise here are stated rather than quietly dropped:
 *
 *  - `workbench_tools_cancelled` **never occurs.** It is the signature of a
 *    runtime tearing down a still-starting MCP subprocess (ledger §14). This
 *    harness has no subprocess to tear down; its tools are function calls in
 *    this process.
 *  - `workbench_tools_unavailable` occurs only when the tool set fails its own
 *    SPEC 18 / SPEC 25 contract check, which would be a bug in this build
 *    rather than something on the consultant's machine.
 *
 * The same two safety rules as the ACP probe hold, for the same structural
 * reasons rather than as promises:
 *
 *  - **No school data leaves the workbench.** The prompt is the entire input
 *    and names no school, no consultant text and no judgement.
 *  - **Nothing is written down.** The caller hands it a grant carrying read
 *    scopes only and identities belonging to no school, so a model that
 *    ignored the prompt and called a write tool anyway would be refused at the
 *    loopback. No Agent Run row, session row or domain row is created, because
 *    this path is given nothing that could create one.
 */

export type BuiltinConnectionCheckRequest = Readonly<{
  /** Read-scoped, school-less grant issued for the probe alone. */
  grant: HarnessCapabilityGrant
  timeoutMs?: number
}>

export type BuiltinConnectionCheckOptions = Readonly<{
  onDiagnostic?: (message: string) => void
  now?: () => number
}>

/** Failure codes that mean this build's tool surface is wrong, not the model. */
const TOOL_SURFACE_ERROR_CODES = new Set(['WORKBENCH_MCP_TOOLS_INVISIBLE'])

/** Failure codes that mean the assistant cannot start at all on this computer. */
const UNAVAILABLE_ERROR_CODES = new Set(['MODEL_CHANNEL_NOT_CONFIGURED', 'HARNESS_ASSEMBLY_FAILED'])

/**
 * Runs one throwaway turn through the real driver and reports what happened.
 *
 * Total by construction: every path returns a result, because a probe that
 * threw would be indistinguishable from an assistant that is down — the one
 * thing this must never confuse.
 */
export async function runBuiltinAssistantConnectionCheck(
  dependencies: Omit<PiHarnessDependencies, 'bootstrapText'>,
  request: BuiltinConnectionCheckRequest,
  options: BuiltinConnectionCheckOptions = {},
): Promise<AssistantConnectionCheckResult> {
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const timeoutMs = request.timeoutMs ?? DEFAULT_CONNECTION_CHECK_TIMEOUT_MS

  const deadline = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    deadline.abort()
  }, timeoutMs)
  timer.unref?.()

  const driver = new PiHarnessDriver({
    ...dependencies,
    // A probe must not be told to go and read a school; there is not one.
    bootstrapText: connectionCheckPromptText,
    // One turn is the whole test. A model that starts calling tools has
    // already answered the only question being asked. This bound is owned
    // by the probe and is not the analysis-run default.
    maxTurns: CONNECTION_CHECK_MAX_TURNS,
    // A connection check is allowed to just answer. Requiring a proposal
    // would turn a working probe into a failed one.
    requireExplicitOutcome: false,
  })

  const workbenchToolCalls: string[] = []
  let result
  try {
    result = await driver.run(
      {
        grant: request.grant,
        consultantMessage: connectionCheckPromptText,
        signal: deadline.signal,
      },
      {
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
        onWorkbenchToolCall: (tool) => workbenchToolCalls.push(tool),
      },
    )
  } finally {
    clearTimeout(timer)
  }

  const durationMs = Math.max(0, now() - startedAt)
  const modelAnswered = result.text.trim().length > 0

  const base = {
    durationMs,
    // No protocol is negotiated in this process, so there is no version to
    // report. Reporting the harness identity is still useful to a maintainer.
    protocolVersion: null,
    agentName: piHarnessAgentName,
    agentVersion: dependencies.harnessVersion,
    modelAnswered,
    // Nothing here starts an MCP server, so there is never a startup report.
    mcpStartup: 'not_reported' as const,
    workbenchToolCalls: Object.freeze([...workbenchToolCalls]),
  } as const

  const finish = (
    outcome: ConnectionCheckOutcome,
    detail: string,
  ): AssistantConnectionCheckResult => Object.freeze({ ...base, outcome, detail })

  if (timedOut) {
    return finish('timed_out', 'The assistant did not answer within the time the check allows.')
  }
  const failure = result.failure
  if (failure) {
    if (TOOL_SURFACE_ERROR_CODES.has(failure.code)) {
      return finish('workbench_tools_unavailable', `${failure.code}: ${failure.message}`)
    }
    if (UNAVAILABLE_ERROR_CODES.has(failure.code)) {
      return finish('runtime_unavailable', `${failure.code}: ${failure.message}`)
    }
    return finish('model_backend_unreachable', `${failure.code}: ${failure.message}`)
  }
  if (!modelAnswered) {
    return finish(
      'model_backend_unreachable',
      'The turn finished without the assistant saying anything, so the model behind it did not answer.',
    )
  }
  return finish('ok', 'The assistant answered a trivial prompt on this computer.')
}
