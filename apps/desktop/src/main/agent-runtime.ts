import {
  AgentHost,
  AgentHostError,
  CodexAcpRuntimeLauncher,
  resolveCodexAcpEntry,
  resolveSystemCodexPath,
  resolveWorkbenchMcpEntry,
  type AgentRunOutcome,
} from '@school-workbench/agent-host'
import type { SqliteAgentRuntimeRepository } from '@school-workbench/db'
import type { AgentRunView, RunAgentInput } from '@school-workbench/shared'
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
}>

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
      },
    )

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
    })
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
      message: '',
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

  return Object.freeze({
    runId: run.id,
    status: outcome.status,
    message: outcome.text,
    usedWorkbenchTools: outcome.usedWorkbenchTools,
    unrecognisedUpdateKinds: [...outcome.unrecognisedUpdateTags],
    runtimeCompatibility: outcome.compatibility.compatibility,
    failureCode: outcome.failure?.code ?? null,
    failureMessage: outcome.failure?.message ?? null,
  })
}
