import { runAgentLoop, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message, Model, Models } from '@earendil-works/pi-ai'
import { agentBootstrapText } from '../bootstrap'
import {
  AgentHostError,
  workbenchToolNames,
  type RuntimeCompatibility,
  type WorkbenchToolName,
} from '../contracts'
import type {
  HarnessDriver,
  HarnessObservers,
  HarnessRunFailure,
  HarnessRunResult,
  HarnessTask,
} from '../harness/contracts'
import { AgentRunLifecycle } from '../run-status'
import { createWorkbenchModelChannel, type ModelChannelConfig } from './model-channel'
import { createWorkbenchAgentTools, type WorkbenchToolCaller } from './workbench-tools'

/**
 * The built-in assistant: a model loop that runs inside the workbench process.
 *
 * What this buys, and it is the whole reason the slice exists: the loop is a
 * library pinned to an exact version in this repository's lockfile. It cannot
 * update itself overnight, cannot start speaking a private dialect to a model
 * backend, and cannot decide on its own to tear down the workbench tool
 * surface. The failure recorded in ledger §14 — a command-line tool the
 * consultant installed changing under the product — is structurally not
 * available to it.
 *
 * What it costs: the model connection becomes the workbench's problem rather
 * than somebody else's account, so an endpoint and a key have to be configured
 * and kept safe. That trade is the substance of ADR-004.
 *
 * The two assistants remain peers. Nothing in this file knows the other one
 * exists, nothing falls back to it, and a failure here is reported to the
 * consultant rather than routed around (PRD 15).
 */

/**
 * How many model turns a real analysis run may take.
 *
 * A turn is one model request plus the tools it asked for. Observed full
 * analyses on the other assistant take on the order of ninety tool calls
 * (many of them criterion lookups and corrections), so the bound has to sit
 * above that rather than above a tidy "ten reads and a proposal". Hitting
 * the bound without an explicit outcome is a failed run, not a silent
 * completion. The wall-clock bound in the composition root is a backstop
 * behind this, not the first line of defence.
 *
 * The connection check uses `CONNECTION_CHECK_MAX_TURNS` on its own driver
 * instance. These two numbers must not share a default.
 */
export const DEFAULT_MAX_TURNS = 120

/**
 * How many model turns a connection check may take.
 *
 * One turn is the whole test: the probe only asks whether a model answers
 * at all. A check that kept calling tools would be a run, not a check.
 */
export const CONNECTION_CHECK_MAX_TURNS = 1

/** Tools that count as an explicit analysis outcome when they succeed. */
export const EXPLICIT_OUTCOME_TOOL_NAMES = Object.freeze([
  'diagnosis_propose',
  'stage_propose',
] as const satisfies readonly WorkbenchToolName[])

export function isExplicitOutcomeTool(name: string): name is WorkbenchToolName {
  return (EXPLICIT_OUTCOME_TOOL_NAMES as readonly string[]).includes(name)
}

/** Name recorded in `agent_sessions.agent_name`. Not consultant-facing. */
export const piHarnessAgentName = 'workbench-builtin-harness'

export type PiHarnessChannel = Readonly<{ models: Models; model: Model<string> }>

export type PiHarnessDependencies = Readonly<{
  /**
   * The consultant's model connection, read when a run starts rather than
   * captured at startup, so a connection filled in halfway through a session
   * works without a restart. `null` means "not configured yet".
   */
  resolveChannel: () => Promise<ModelChannelConfig | null>
  /**
   * Exact version of the pinned harness library, recorded on the session row.
   * Passed in so this module holds no version literal of its own.
   */
  harnessVersion: string
  /**
   * Test seam. Production builds a real OpenAI-compatible channel; a test
   * supplies a scripted model so the loop, the tool surface and the strict
   * contract path can be exercised without a network or a key.
   */
  createChannel?: (config: ModelChannelConfig) => PiHarnessChannel
  /** Test seam. Production calls the real loopback read plane. */
  call?: WorkbenchToolCaller
  /**
   * Analysis-run turn bound. Production leaves this unset so it uses
   * `DEFAULT_MAX_TURNS`. The connection check passes
   * `CONNECTION_CHECK_MAX_TURNS` on its own instance.
   */
  maxTurns?: number
  /**
   * Whether finishing without a successful `diagnosis_propose` or
   * `stage_propose` is a failed run.
   *
   * Analysis runs leave this unset (it defaults to true). The connection
   * check is the one caller that turns it off: a probe is allowed to just
   * answer, and must not be punished for not submitting a judgement.
   */
  requireExplicitOutcome?: boolean
  /**
   * The standing instructions the model is given, defaulting to the SPEC 26
   * Agent Bootstrap.
   *
   * The one caller that overrides it is the connection check, which must not
   * send the bootstrap: that text tells the assistant to go and read a school,
   * and a connection check has no school. This is a composition-time choice
   * about which instructions a *particular* driver instance carries, so it
   * stays out of `HarnessTask` — a task is the same task whichever harness
   * runs it.
   */
  bootstrapText?: string
}>

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (message as { role: unknown }).role === 'assistant'
  )
}

/** Visible prose only: thinking and tool calls are not something to report. */
function assistantText(messages: readonly AssistantMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text) parts.push(block.text)
    }
  }
  return parts.join('\n')
}

function isWorkbenchToolName(name: string): name is WorkbenchToolName {
  return (workbenchToolNames as readonly string[]).includes(name)
}

/**
 * Turns the last assistant turn into an Agent Run outcome.
 *
 * `error` and `aborted` are the only two that are not a finished turn.
 * Everything else — including `length`, where the model ran out of output room
 * — is a turn that genuinely ended, for the same reason `statusForStopReason`
 * treats an unrecognised ACP stop reason as completed: a runtime must not be
 * able to turn a finished turn into an error.
 */
export function outcomeForStopReason(
  last: AssistantMessage | undefined,
): Readonly<{ status: 'completed' | 'failed' | 'cancelled'; failure: HarnessRunFailure | null }> {
  if (!last) {
    return Object.freeze({
      status: 'failed' as const,
      failure: Object.freeze({
        code: 'MODEL_REQUEST_FAILED',
        message: 'The model produced no response at all.',
      }),
    })
  }
  if (last.stopReason === 'aborted') {
    return Object.freeze({ status: 'cancelled' as const, failure: null })
  }
  if (last.stopReason === 'error') {
    return Object.freeze({
      status: 'failed' as const,
      failure: Object.freeze({
        code: 'MODEL_REQUEST_FAILED',
        message: last.errorMessage ?? 'The model service did not complete the request.',
      }),
    })
  }
  return Object.freeze({ status: 'completed' as const, failure: null })
}

export class PiHarnessDriver implements HarnessDriver {
  readonly key = 'builtin' as const

  constructor(private readonly dependencies: PiHarnessDependencies) {}

  async run(task: HarnessTask, observers: HarnessObservers = {}): Promise<HarnessRunResult> {
    const lifecycle = new AgentRunLifecycle(observers.onStatus)
    const toolCalls: WorkbenchToolName[] = []
    let text = ''
    let failure: HarnessRunFailure | null = null
    let producedExplicitOutcome = false
    // Nothing is verified until the tool contract has actually been checked
    // against the frozen SPEC 18 list, so the pessimistic value starts here.
    let compatibility: RuntimeCompatibility = 'unsupported'

    try {
      const config = await this.dependencies.resolveChannel()
      if (!config) {
        throw new AgentHostError(
          'MODEL_CHANNEL_NOT_CONFIGURED',
          'No model connection has been configured for the built-in assistant.',
        )
      }

      const channel = (this.dependencies.createChannel ?? createWorkbenchModelChannel)(config)

      // Building the tool set runs the SPEC 18 / SPEC 25 contract check, so a
      // wrong surface throws before a single token is spent. This is the
      // in-process counterpart of the MCP visibility check the ACP path runs
      // against a real subprocess.
      const tools = createWorkbenchAgentTools(task.grant, {
        ...(this.dependencies.call ? { call: this.dependencies.call } : {}),
      })
      compatibility = 'verified'

      const maxTurns = this.dependencies.maxTurns ?? DEFAULT_MAX_TURNS
      let turns = 0

      lifecycle.transition('running')

      const messages = await runAgentLoop(
        [
          {
            role: 'user',
            content: [{ type: 'text', text: task.consultantMessage }],
            timestamp: Date.now(),
          },
        ],
        {
          // SPEC 26 bootstrap, verbatim. The ACP path sends it as the first
          // prompt block because that is the only slot ACP gives it; here it
          // is the system prompt, which is the same instruction reaching the
          // model through the slot this harness actually has.
          systemPrompt: this.dependencies.bootstrapText ?? agentBootstrapText,
          messages: [],
          tools: [...tools],
        },
        {
          model: channel.model,
          // This driver registers no custom message kinds, so every message in
          // the transcript is already an LLM message and conversion is
          // identity. Written out rather than assumed: the loop calls this
          // before each request and a throw here would break it.
          convertToLlm: (all: AgentMessage[]): Message[] => all as Message[],
          // One tool at a time. Workbench writes are ordered — evidence is
          // registered before the judgement that cites it — so a run firing
          // them concurrently would be racing its own citations.
          toolExecution: 'sequential',
          shouldStopAfterTurn: () => {
            turns += 1
            if (turns < maxTurns) return false
            observers.onDiagnostic?.(`built-in assistant stopped at the ${maxTurns} turn bound`)
            return true
          },
        },
        (event: AgentEvent) => {
          // A successful propose or stage proposal is the only thing that
          // counts as an analysis having finished its job. A refused call is
          // not that — the model still has to correct it or abstain.
          if (event.type === 'tool_execution_end') {
            if (
              !event.isError &&
              isWorkbenchToolName(event.toolName) &&
              isExplicitOutcomeTool(event.toolName)
            ) {
              producedExplicitOutcome = true
            }
            return
          }
          // The progress line follows what the assistant actually did. Only
          // workbench tools reach it, so nothing a runtime does on its own can
          // be described to a consultant (PRD 16).
          if (event.type !== 'tool_execution_start') return
          if (!isWorkbenchToolName(event.toolName)) return
          toolCalls.push(event.toolName)
          observers.onWorkbenchToolCall?.(event.toolName)
        },
        task.signal,
        (model, context, options) => channel.models.streamSimple(model, context, options),
      )

      const assistants = messages.filter(isAssistantMessage)
      text = assistantText(assistants)
      const outcome = outcomeForStopReason(assistants.at(-1))
      const requireExplicitOutcome = this.dependencies.requireExplicitOutcome ?? true
      if (outcome.status === 'completed' && requireExplicitOutcome && !producedExplicitOutcome) {
        failure = Object.freeze({
          code: 'NO_EXPLICIT_OUTCOME',
          message:
            'The built-in assistant finished without submitting a diagnosis proposal, an explicit abstention, or a stage proposal.',
        })
        observers.onDiagnostic?.('built-in assistant finished without an explicit outcome')
        lifecycle.settle('failed')
      } else {
        failure = outcome.failure
        lifecycle.settle(outcome.status)
      }
    } catch (error) {
      const code = error instanceof AgentHostError ? error.code : 'HARNESS_ASSEMBLY_FAILED'
      const message = error instanceof Error ? error.message : String(error)
      failure = Object.freeze({ code, message })
      lifecycle.settle('failed')
      observers.onDiagnostic?.(`built-in assistant run failed: ${code}`)
    }

    return Object.freeze({
      status: lifecycle.status,
      statusHistory: lifecycle.history,
      text,
      workbenchToolCalls: Object.freeze([...toolCalls]),
      usedWorkbenchTools: toolCalls.length > 0,
      // A library called directly speaks no protocol, so there is nothing it
      // could say that this build would fail to recognise.
      unrecognisedRuntimeSignals: Object.freeze([]),
      session: Object.freeze({
        // An in-process loop negotiates no protocol and is handed no throwaway
        // working directory, so both stay null rather than carrying a
        // plausible-looking value into the database.
        externalSessionId: null,
        cwd: null,
        compatibility,
        protocolVersion: null,
        agentName: piHarnessAgentName,
        agentVersion: this.dependencies.harnessVersion,
      }),
      failure,
    })
  }
}
