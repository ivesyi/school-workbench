import {
  AgentHost,
  AgentHostError,
  CodexAcpRuntimeLauncher,
  resolveCodexAcpEntry,
  resolveSystemCodexPath,
  resolveWorkbenchMcpEntry,
  type AgentRunOutcome,
} from '@school-workbench/agent-host'
import type { JudgmentService } from '@school-workbench/application'
import type { SqliteAgentRuntimeRepository } from '@school-workbench/db'
import type {
  AgentProgressPhase,
  AgentRunOutcomeValue,
  AgentRunView,
  RunAgentInput,
} from '@school-workbench/shared'
import {
  capabilityScopes,
  type WorkbenchLoopbackReadPlane,
  type WorkbenchWriteCapabilityService,
} from '@school-workbench/workbench-read-plane'
import { randomUUID } from 'node:crypto'

/**
 * The runtime this slice drives. SPEC 8 lists DeepSeek Harness as well, but this
 * slice only wires Codex; nothing here is written for a runtime that is not
 * being integrated.
 */
export const codexRuntimeProfile = Object.freeze({
  key: 'codex',
  displayName: 'Codex',
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
}>

/**
 * Whether an assistant could be started on this computer.
 *
 * Answered from what is installed, not by starting anything: the consultant
 * needs to know before typing whether waiting is worth it. Whether Codex is
 * signed in cannot be known without asking it, so that surfaces as a failed run
 * with a plain explanation instead.
 */
export function assistantReadiness(
  mainDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<{ ready: boolean; detail: string | null }> {
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
export async function runAgentOnce(
  dependencies: AgentRuntimeDependencies,
  input: RunAgentInput,
): Promise<AgentRunView> {
  const environment = dependencies.environment ?? process.env
  const runtimeProfileId = await dependencies.repository.ensureRuntimeProfile(codexRuntimeProfile)
  const run = await dependencies.repository.createRun({
    schoolId: input.schoolId,
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

  let outcome: AgentRunOutcome
  try {
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
        onStatus: (status) => {
          void dependencies.repository.setRunStatus(run.id, status).catch(() => undefined)
        },
        onWorkbenchToolCall: (tool) => {
          const next = nextProgressPhase(phase, tool)
          if (!next) return
          phase = next
          dependencies.onProgress?.(next)
        },
      },
    )

    // Stop waiting eventually. The consultant is watching this happen.
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), AGENT_RUN_TIMEOUT_MS)
    timer.unref?.()
    try {
      outcome = await host.run({
        schoolId: input.schoolId,
        agentRunId: run.id,
        consultantMessage: input.message,
        mcp: {
          command: dependencies.execPath,
          entryPath: mcpEntry.path,
          endpoint: dependencies.endpoint,
          token: grant.token,
          extraEnv: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
        },
        forbiddenWorkspaceRoots: [dependencies.userDataDirectory],
        signal: deadline.signal,
      })
    } finally {
      clearTimeout(timer)
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
    acpSessionId: outcome.acpSessionId,
    cwd: outcome.workspaceCwd ?? '',
    compatibility: outcome.compatibility.compatibility,
    protocolVersion: outcome.compatibility.protocolVersion,
    agentName: outcome.compatibility.agentName,
    agentVersion: outcome.compatibility.agentVersion,
    closedAt: new Date().toISOString(),
  })
  await dependencies.repository.attachRunToSession(run.id, sessionId)
  await dependencies.repository.setRunStatus(run.id, outcome.status)

  // What the assistant said is deliberately dropped here. It arrives mixed with
  // the runtime's own notices ("Skill descriptions were shortened…"), and PRD 16
  // keeps that class of text away from the consultant. What survives is the
  // judgement it submitted through the proper channel, which is reviewable.
  const submitted = await dependencies.judgments
    .findAgentRunOutcome(input.schoolId, run.id)
    .catch(() => ({ kind: 'none' }) as const)

  return Object.freeze({
    runId: run.id,
    status: outcome.status,
    outcome: describeOutcome(outcome.status, submitted.kind),
    proposal: submitted.kind === 'proposal' ? submitted.view : null,
    usedWorkbenchTools: outcome.usedWorkbenchTools,
    unrecognisedUpdateKinds: [...outcome.unrecognisedUpdateTags],
    runtimeCompatibility: outcome.compatibility.compatibility,
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
  status: AgentRunOutcome['status'],
  submitted: 'proposal' | 'insufficient_evidence' | 'none',
): AgentRunOutcomeValue {
  if (submitted === 'proposal') return 'proposal_ready'
  if (submitted === 'insufficient_evidence') return 'needs_more_evidence'
  return status === 'completed' ? 'no_new_judgment' : 'failed'
}
