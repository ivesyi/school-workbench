import {
  AgentHost,
  AgentHostError,
  CodexAcpRuntimeLauncher,
  createWorkbenchAgentTools,
  harnessResultFromAcpOutcome,
  PiHarnessDriver,
  pinnedBuiltinHarnessVersion,
  resolveCodexAcpEntry,
  resolveSystemCodexPath,
  resolveWorkbenchMcpEntry,
  type AgentRunStatus,
  type HarnessRunResult,
  type ModelChannelConfig,
  type PiHarnessChannel,
} from '@school-workbench/agent-host'
import type { JudgmentService } from '@school-workbench/application'
import type { SqliteAgentRuntimeRepository } from '@school-workbench/db'
import type {
  AgentProgressPhase,
  AgentRunOutcomeValue,
  AgentRunView,
  AssistantChoice,
  RunAgentInput,
} from '@school-workbench/shared'
import {
  capabilityScopes,
  type WorkbenchLoopbackReadPlane,
  type WorkbenchWriteCapabilityService,
} from '@school-workbench/workbench-read-plane'
import { randomUUID } from 'node:crypto'
import {
  FEISHU_FAILURE_CODES,
  humanFeishuFailure,
  prepareConsultantMessage,
  type FeishuDocumentResult,
} from './feishu-document'

/**
 * The runtimes this workbench drives, one row each in `runtime_profiles`.
 *
 * Two peers, not a primary and a spare. Which one a run uses comes from the
 * consultant's standing choice and nothing else: no code below picks one,
 * ranks them, or moves to the other after a failure (PRD 15).
 */
export const codexRuntimeProfile = Object.freeze({
  key: 'codex',
  displayName: 'Codex',
})

/**
 * The controlled harness. `displayName` lands in a database column, not on
 * screen; the consultant-facing label lives in the settings view.
 */
export const builtinRuntimeProfile = Object.freeze({
  key: 'builtin',
  displayName: '工作台自带助手',
})

export const runtimeProfiles: Readonly<
  Record<AssistantChoice, { key: string; displayName: string }>
> = Object.freeze({
  codex: codexRuntimeProfile,
  builtin: builtinRuntimeProfile,
})

/**
 * Capability token lifetime for one Agent Run.
 *
 * `packages/workbench-read-plane` caps this at 15 minutes and only stores the
 * SHA-256 digest, so every token dies with the process anyway. The maximum is
 * used because a single reasoning turn can outlive the 5 minute default, and a
 * token that expires mid-turn would surface as an unexplained tool failure.
 */
const CAPABILITY_TOKEN_TTL_MS = 15 * 60 * 1000

/**
 * How long one run may take before the workbench stops waiting.
 *
 * Observed runs finish between roughly a quarter of a minute and two minutes.
 * The bound is generous against that, and well inside the capability token's
 * lifetime, so a runtime that hangs turns into a plain "this did not work"
 * instead of a consultant watching a spinner forever.
 */
const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000

/**
 * PRD 16's four steps, keyed by the workbench tool that reveals them.
 *
 * A tool the workbench does not serve never appears here, so nothing the
 * runtime does on its own can be narrated to the consultant.
 */
const PROGRESS_PHASE_BY_TOOL: Readonly<Record<string, AgentProgressPhase>> = Object.freeze({
  school_context: 'understanding',
  stage_current: 'understanding',
  standards_get: 'gathering',
  evidence_list: 'gathering',
  diagnosis_list: 'gathering',
  state_current: 'comparing',
  state_history: 'comparing',
  evidence_register: 'drafting',
  diagnosis_propose: 'drafting',
  stage_propose: 'drafting',
})

const PHASE_ORDER: readonly AgentProgressPhase[] = Object.freeze([
  'understanding',
  'gathering',
  'comparing',
  'drafting',
])

/** Progress only ever moves forward, so the wording never appears to backtrack. */
export function nextProgressPhase(
  current: AgentProgressPhase | null,
  tool: string,
): AgentProgressPhase | null {
  const candidate = PROGRESS_PHASE_BY_TOOL[tool]
  if (!candidate) return null
  if (!current) return candidate
  return PHASE_ORDER.indexOf(candidate) > PHASE_ORDER.indexOf(current) ? candidate : null
}

export type AgentRuntimeDependencies = Readonly<{
  /**
   * Which assistant this run uses — the consultant's standing choice, read
   * once when the run is dispatched.
   */
  assistant: AssistantChoice
  /**
   * The built-in assistant's model connection, resolved at the moment it is
   * needed so a connection filled in mid-session works without a restart.
   * Never called on the Codex path.
   */
  resolveModelChannel?: () => Promise<ModelChannelConfig | null>
  /**
   * Test seam, mirroring `createLauncher` on the connection check. Production
   * builds a real OpenAI-compatible channel from the stored connection; a test
   * supplies a scripted model so the whole run — loop, tools, capability
   * token, loopback, assessment gate, SQLite — can be exercised without a
   * network, a key or money.
   */
  createModelChannel?: (config: ModelChannelConfig) => PiHarnessChannel
  readPlane: WorkbenchLoopbackReadPlane
  writeService: WorkbenchWriteCapabilityService
  endpoint: string
  repository: SqliteAgentRuntimeRepository
  /** Directory the main bundle lives in, used to locate spawned artifacts. */
  mainDirectory: string
  /** Executable used to run the bundled Node artifacts (Electron's own binary). */
  execPath: string
  /** Workbench user data directory. A session workspace may never overlap it. */
  userDataDirectory: string
  environment?: NodeJS.ProcessEnv
  onDiagnostic?: (message: string) => void
  /** Renders a judgement the assistant submitted, for the review surface. */
  judgments: JudgmentService
  /** Reports the high-level step the consultant is allowed to see (PRD 16). */
  onProgress?: (phase: AgentProgressPhase) => void
  /**
   * Test seam. Production reads Feishu documents through the local Feishu
   * tool; a test supplies a scripted fetch so no real document is opened.
   */
  fetchFeishuDocument?: (url: string) => Promise<FeishuDocumentResult>
}>

export type AssistantReadinessResult = Readonly<{ ready: boolean; detail: string | null }>

/**
 * Whether the built-in assistant could be started on this computer.
 *
 * Two questions, and they fail differently on purpose. *Can this build assemble
 * the harness at all* is answered by really building the tool set against a
 * throwaway grant — that compiles every parameter schema and runs the SPEC 18 /
 * SPEC 25 contract check, so a broken build is caught here rather than in front
 * of a consultant who just typed a paragraph. *Is there a model to talk to* is
 * the ordinary, expected "not yet", and it says what to do about it.
 *
 * Neither question can be answered by pressing on and hoping, which is why
 * neither is left to the run.
 */
export function builtinAssistantReadiness(
  modelChannelConfigured: boolean,
): AssistantReadinessResult {
  try {
    createWorkbenchAgentTools({
      // Belongs to no school and is never sent anywhere: the tool set is built
      // and thrown away without a request being made.
      endpoint: 'http://127.0.0.1:1/internal/v1',
      token: 'a'.repeat(43),
      schoolId: 'readiness-probe',
      agentRunId: 'readiness-probe',
    })
  } catch {
    return Object.freeze({
      ready: false,
      detail: '工作台自带助手在这个版本里没能装配起来，请更新工作台。',
    })
  }
  if (!modelChannelConfigured) {
    return Object.freeze({
      ready: false,
      detail: '还没填 AI 模型连接。在下面填好模型地址、模型名称和密钥就能用。',
    })
  }
  return Object.freeze({ ready: true, detail: null })
}

/**
 * Whether Codex could be started on this computer.
 *
 * Answered from what is installed, not by starting anything: the consultant
 * needs to know before typing whether waiting is worth it. Whether Codex is
 * signed in cannot be known without asking it, so that surfaces as a failed run
 * with a plain explanation instead.
 */
export function assistantReadiness(
  mainDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): AssistantReadinessResult {
  try {
    resolveWorkbenchMcpEntry(mainDirectory, environment)
  } catch {
    return Object.freeze({
      ready: false,
      detail: '这台电脑上的工作台还没准备好，请重新启动一次。',
    })
  }
  try {
    resolveCodexAcpEntry(mainDirectory, environment)
  } catch {
    return Object.freeze({
      ready: false,
      detail: '这台电脑上还没有装好 Codex，装好后重新启动工作台即可。',
    })
  }
  return Object.freeze({ ready: true, detail: null })
}

/**
 * Composition root for one Agent Run.
 *
 * Everything school-specific — which school, which token, which database rows —
 * is decided here; `packages/agent-host` only sees protocol-level inputs
 * (SPEC 7).
 */
export function unstartedFeishuFailure(reason: keyof typeof FEISHU_FAILURE_CODES): AgentRunView {
  return Object.freeze({
    runId: 'not-started',
    status: 'failed' as const,
    outcome: 'failed' as const,
    proposal: null,
    abstention: null,
    usedWorkbenchTools: false,
    unrecognisedUpdateKinds: [],
    runtimeCompatibility: 'compatible' as const,
    failureCode: FEISHU_FAILURE_CODES[reason],
    failureMessage: humanFeishuFailure(reason),
  })
}

export async function runAgentOnce(
  dependencies: AgentRuntimeDependencies,
  input: RunAgentInput,
): Promise<AgentRunView> {
  const prepared = await prepareConsultantMessage(input.message, {
    ...(dependencies.environment ? { environment: dependencies.environment } : {}),
    ...(dependencies.fetchFeishuDocument ? { fetch: dependencies.fetchFeishuDocument } : {}),
    log: (line) => {
      process.stderr.write(`${line}\n`)
      dependencies.onDiagnostic?.(line)
    },
  })
  if (!prepared.ok) {
    return unstartedFeishuFailure(prepared.reason)
  }
  const resolvedInput: RunAgentInput = { ...input, message: prepared.message }

  const runtimeProfileId = await dependencies.repository.ensureRuntimeProfile(
    runtimeProfiles[dependencies.assistant],
  )
  const run = await dependencies.repository.createRun({
    schoolId: resolvedInput.schoolId,
    runId: randomUUID(),
  })

  // SPEC 17's full allow list: six read scopes plus `evidence.register` and
  // `diagnosis.propose`. The four capabilities SPEC 25 forbids have no scope at
  // all and no route, so no token can reach them.
  const grant = dependencies.readPlane.issueToken({
    schoolId: input.schoolId,
    agentRunId: run.id,
    scopes: capabilityScopes,
    ttlMs: CAPABILITY_TOKEN_TTL_MS,
  })

  let phase: AgentProgressPhase | null = null
  // Something must be on screen immediately: the first tool call can be a long
  // way off, and PRD 16 is about the wait, not about the result.
  dependencies.onProgress?.('understanding')

  const onWorkbenchToolCall = (tool: string): void => {
    const next = nextProgressPhase(phase, tool)
    if (!next) return
    phase = next
    dependencies.onProgress?.(next)
  }
  const onStatus = (status: AgentRunStatus): void => {
    void dependencies.repository.setRunStatus(run.id, status).catch(() => undefined)
  }

  let outcome: HarnessRunResult
  try {
    // Stop waiting eventually, whichever harness is driving. The consultant is
    // watching this happen.
    const deadline = new AbortController()
    const runTimer = setTimeout(() => deadline.abort(), AGENT_RUN_TIMEOUT_MS)
    runTimer.unref?.()
    try {
      outcome =
        dependencies.assistant === 'builtin'
          ? await runBuiltinAssistant(
              dependencies,
              resolvedInput,
              run.id,
              grant.token,
              deadline.signal,
              {
                onStatus,
                onWorkbenchToolCall,
              },
            )
          : await runCodexAssistant(
              dependencies,
              resolvedInput,
              run.id,
              grant.token,
              deadline.signal,
              {
                onStatus,
                onWorkbenchToolCall,
              },
            )
    } finally {
      clearTimeout(runTimer)
    }
  } catch (error) {
    dependencies.readPlane.revokeToken(grant.token)
    dependencies.writeService.forgetRun(run.id)
    await dependencies.repository.setRunStatus(run.id, 'failed')
    const message = error instanceof Error ? error.message : String(error)
    // Keep the host's own error code. Collapsing every pre-flight failure into
    // one opaque code made unrelated causes — a missing runtime, a missing MCP
    // bundle, a rejected session workspace — indistinguishable to the caller
    // and to tests.
    const failureCode = error instanceof AgentHostError ? error.code : 'AGENT_RUNTIME_UNAVAILABLE'
    return Object.freeze({
      runId: run.id,
      status: 'failed' as const,
      outcome: 'failed' as const,
      proposal: null,
      abstention: null,
      usedWorkbenchTools: false,
      unrecognisedUpdateKinds: [],
      runtimeCompatibility: 'unsupported' as const,
      failureCode,
      failureMessage: message,
    })
  }

  // The token dies with the run, not with its TTL.
  dependencies.readPlane.revokeToken(grant.token)

  // Decision L5: record how many refused candidates this run worked through.
  const selfCorrectionRounds = dependencies.writeService.selfCorrectionRounds(run.id)
  await dependencies.repository.setSelfCorrectionRounds(run.id, selfCorrectionRounds)
  dependencies.writeService.forgetRun(run.id)

  const sessionId = await dependencies.repository.recordSession({
    schoolId: input.schoolId,
    runtimeProfileId,
    acpSessionId: outcome.session.externalSessionId,
    cwd: outcome.session.cwd ?? '',
    compatibility: outcome.session.compatibility,
    protocolVersion: outcome.session.protocolVersion,
    agentName: outcome.session.agentName,
    agentVersion: outcome.session.agentVersion,
    closedAt: new Date().toISOString(),
  })
  await dependencies.repository.attachRunToSession(run.id, sessionId)
  await dependencies.repository.setRunStatus(run.id, outcome.status)

  // What the assistant said is deliberately dropped here. It arrives mixed with
  // the runtime's own notices ("Skill descriptions were shortened…"), and PRD 16
  // keeps that class of text away from the consultant. What survives is what it
  // submitted through the proper channel: a judgement that passed the strict
  // assessment contract, or an explicit abstention. Nothing else is produced in
  // their place.
  const submitted = await dependencies.judgments
    .findAgentRunOutcome(resolvedInput.schoolId, run.id)
    .catch(() => ({ kind: 'none' }) as const)

  return Object.freeze({
    runId: run.id,
    status: outcome.status,
    outcome: describeOutcome(outcome.status, submitted.kind),
    proposal: submitted.kind === 'proposal' ? submitted.view : null,
    abstention:
      submitted.kind === 'insufficient_evidence'
        ? {
            unresolvedQuestions: [...submitted.unresolvedQuestions],
            nextObservations: [...submitted.nextObservations],
          }
        : null,
    usedWorkbenchTools: outcome.usedWorkbenchTools,
    unrecognisedUpdateKinds: [...outcome.unrecognisedRuntimeSignals],
    runtimeCompatibility: outcome.session.compatibility,
    failureCode: outcome.failure?.code ?? null,
    failureMessage: outcome.failure?.message ?? null,
  })
}

/**
 * What the consultant is told happened.
 *
 * "The evidence is not enough yet" is a real and useful answer, distinct from
 * the assistant having nothing to say and distinct again from it not working.
 * A run that submitted a judgement counts as a success even if it ended badly
 * afterwards — the judgement is already safely recorded and reviewable.
 */
export function describeOutcome(
  status: HarnessRunResult['status'],
  submitted: 'proposal' | 'insufficient_evidence' | 'none',
): AgentRunOutcomeValue {
  if (submitted === 'proposal') return 'proposal_ready'
  if (submitted === 'insufficient_evidence') return 'needs_more_evidence'
  return status === 'completed' ? 'no_new_judgment' : 'failed'
}

type RunObservers = Readonly<{
  onStatus: (status: AgentRunStatus) => void
  onWorkbenchToolCall: (tool: string) => void
}>

/**
 * The Codex run, unchanged.
 *
 * Every line below was moved here verbatim from the body of `runAgentOnce`;
 * nothing about how Codex is launched, prompted or torn down is different. The
 * only new thing is the last line, which projects the outcome onto the Harness
 * shape so the code after the call does not have to know which assistant ran.
 */
async function runCodexAssistant(
  dependencies: AgentRuntimeDependencies,
  input: RunAgentInput,
  runId: string,
  token: string,
  signal: AbortSignal,
  observers: RunObservers,
): Promise<HarnessRunResult> {
  const environment = dependencies.environment ?? process.env
  const mcpEntry = resolveWorkbenchMcpEntry(dependencies.mainDirectory, environment)
  const codexAcpEntry = resolveCodexAcpEntry(dependencies.mainDirectory, environment)
  const systemCodexPath = resolveSystemCodexPath(environment)

  const host = new AgentHost(
    new CodexAcpRuntimeLauncher({
      entryPath: codexAcpEntry.path,
      execPath: dependencies.execPath,
      systemCodexPath,
      environment,
      // The bridge process itself runs in the user data directory: it never
      // receives the session workspace, which belongs to the agent.
      cwd: dependencies.userDataDirectory,
    }),
    {
      ...(dependencies.onDiagnostic ? { onDiagnostic: dependencies.onDiagnostic } : {}),
      onStatus: observers.onStatus,
      onWorkbenchToolCall: observers.onWorkbenchToolCall,
    },
  )

  return harnessResultFromAcpOutcome(
    await host.run({
      schoolId: input.schoolId,
      agentRunId: runId,
      consultantMessage: input.message,
      mcp: {
        command: dependencies.execPath,
        entryPath: mcpEntry.path,
        endpoint: dependencies.endpoint,
        token,
        extraEnv: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
      },
      forbiddenWorkspaceRoots: [dependencies.userDataDirectory],
      signal,
    }),
  )
}

/**
 * The built-in assistant run.
 *
 * Notice how little there is: no subprocess to launch, no throwaway working
 * directory to create and delete, no protocol to negotiate, no MCP descriptor
 * to build and verify. All of that exists on the Codex path to get a capability
 * grant safely across a process boundary, and here there is no boundary to
 * cross — the grant is handed straight to the tool set, which still spends it
 * through the same loopback endpoint under the same scopes.
 */
async function runBuiltinAssistant(
  dependencies: AgentRuntimeDependencies,
  input: RunAgentInput,
  runId: string,
  token: string,
  signal: AbortSignal,
  observers: RunObservers,
): Promise<HarnessRunResult> {
  const resolveModelChannel = dependencies.resolveModelChannel ?? (async () => null)
  const driver = new PiHarnessDriver({
    resolveChannel: resolveModelChannel,
    harnessVersion: pinnedBuiltinHarnessVersion,
    ...(dependencies.createModelChannel ? { createChannel: dependencies.createModelChannel } : {}),
  })
  return driver.run(
    {
      grant: {
        endpoint: dependencies.endpoint,
        token,
        schoolId: input.schoolId,
        agentRunId: runId,
      },
      consultantMessage: input.message,
      signal,
    },
    {
      ...(dependencies.onDiagnostic ? { onDiagnostic: dependencies.onDiagnostic } : {}),
      onStatus: observers.onStatus,
      onWorkbenchToolCall: observers.onWorkbenchToolCall,
    },
  )
}
