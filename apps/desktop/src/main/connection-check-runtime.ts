import {
  CodexAcpRuntimeLauncher,
  resolveCodexAcpEntry,
  resolveSystemCodexPath,
  resolveWorkbenchMcpEntry,
  runAssistantConnectionCheck,
  type AcpRuntimeLauncher,
  type AssistantConnectionCheckResult,
  type ConnectionCheckOutcome,
  type verifyWorkbenchMcpTools,
} from '@school-workbench/agent-host'
import type { AssistantConnectionCheckView } from '@school-workbench/shared'
import { readScopes, type WorkbenchLoopbackReadPlane } from '@school-workbench/workbench-read-plane'
import { randomUUID } from 'node:crypto'

/**
 * Composition root for one connection test.
 *
 * Note what this function is *not* given: no repository, no judgement service,
 * no school id from anywhere in the product. That is the guarantee, not a
 * promise — a probe with nothing to write to cannot write anything down, and no
 * Agent Run, session row or domain row can appear as a side effect of pressing
 * the button. The capability token it issues carries read scopes only and lives
 * in memory for the length of the probe.
 *
 * The result is shown to a person. It never selects an assistant, never retries
 * and never changes what a later run is allowed to do (PRD 15: assistants are
 * peers and switching is the consultant's decision).
 */
export type ConnectionCheckDependencies = Readonly<{
  readPlane: WorkbenchLoopbackReadPlane
  endpoint: string
  /** Directory the main bundle lives in, used to locate spawned artifacts. */
  mainDirectory: string
  /** Executable used to run the bundled Node artifacts (Electron's own binary). */
  execPath: string
  /** Workbench user data directory. A session workspace may never overlap it. */
  userDataDirectory: string
  environment?: NodeJS.ProcessEnv
  onDiagnostic?: (message: string) => void
  timeoutMs?: number
  now?: () => Date
  /**
   * Test seam. Production really runs the workbench MCP server bundle and asks
   * it for its tool list, exactly as an Agent Run does.
   */
  verifyTools?: typeof verifyWorkbenchMcpTools
  /**
   * Test seam. Production launches the real ACP bridge; a test connects an
   * in-process agent through the same interface so the probe's own wiring can
   * be exercised without money, network or a Codex login.
   */
  createLauncher?: (
    input: Readonly<{
      entryPath: string
      execPath: string
      systemCodexPath: string | null
      environment: NodeJS.ProcessEnv
      cwd: string
    }>,
  ) => AcpRuntimeLauncher
}>

type Copy = Readonly<{ headline: string; detail: string }>

/**
 * What the consultant is told.
 *
 * Every failing line says the same thing in the same place: this is the AI
 * assistant's environment, not something the consultant did and not the school
 * material. No path, no error code and no protocol name reaches this text.
 */
const COPY: Readonly<Record<ConnectionCheckOutcome, Copy>> = Object.freeze({
  ok: {
    headline: '连接正常',
    detail: 'AI 助手在这台电脑上能正常回应，可以开始新的分析。',
  },
  timed_out: {
    headline: '这次没有连上',
    detail:
      '等了一分钟，AI 助手一直没有回应。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。过一会儿再测一次。',
  },
  model_backend_unreachable: {
    headline: '这次没有连上',
    detail:
      'AI 助手启动了，但它背后的模型服务没有回应。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。常见原因是还没登录，或者模型服务这会儿用不了。',
  },
  workbench_tools_cancelled: {
    headline: '这次没有连上',
    detail:
      'AI 助手启动到一半自己中断了，通常是它背后的模型服务这会儿用不了。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。',
  },
  workbench_tools_unavailable: {
    headline: '这次没有连上',
    detail:
      '工作台这次没能把学校资料交到 AI 助手手上。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。重新启动一次工作台再测。',
  },
  runtime_unavailable: {
    headline: '这次没有连上',
    detail:
      '这台电脑上的 AI 助手还没准备好，测试没能开始。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。装好 Codex 后重新启动工作台再测。',
  },
})

/** Shown when the workbench itself is not far enough along to test anything. */
export const NOT_STARTED_VIEW: Copy = Object.freeze({
  headline: '这次没有连上',
  detail: '工作台还在启动，稍等一下再测一次。',
})

export function describeConnectionCheck(
  result: AssistantConnectionCheckResult,
  checkedAt: Date,
): AssistantConnectionCheckView {
  const copy = COPY[result.outcome]
  return Object.freeze({
    state: result.outcome === 'ok' ? ('ok' as const) : ('failed' as const),
    headline: copy.headline,
    detail: copy.detail,
    durationSeconds: Math.max(0, Math.round(result.durationMs / 1000)),
    checkedAt: checkedAt.toISOString(),
  })
}

export async function checkAssistantConnection(
  dependencies: ConnectionCheckDependencies,
): Promise<AssistantConnectionCheckView> {
  const environment = dependencies.environment ?? process.env
  const now = dependencies.now ?? (() => new Date())

  let mcpEntryPath: string
  let codexAcpEntryPath: string
  try {
    mcpEntryPath = resolveWorkbenchMcpEntry(dependencies.mainDirectory, environment).path
    codexAcpEntryPath = resolveCodexAcpEntry(dependencies.mainDirectory, environment).path
  } catch (error) {
    dependencies.onDiagnostic?.(
      `connection check could not start: ${error instanceof Error ? error.message : String(error)}`,
    )
    return Object.freeze({
      state: 'failed' as const,
      ...COPY.runtime_unavailable,
      durationSeconds: 0,
      checkedAt: now().toISOString(),
    })
  }

  // Not a school. The probe is given an identity that belongs to nothing so
  // that even a runtime which ignored the prompt and called a tool anyway would
  // read an empty world rather than a consultant's material.
  const probeSchoolId = `connection-check-${randomUUID()}`
  const probeRunId = `connection-check-${randomUUID()}`
  const grant = dependencies.readPlane.issueToken({
    schoolId: probeSchoolId,
    agentRunId: probeRunId,
    scopes: readScopes,
  })

  const launcherInput = {
    entryPath: codexAcpEntryPath,
    execPath: dependencies.execPath,
    systemCodexPath: resolveSystemCodexPath(environment),
    environment,
    cwd: dependencies.userDataDirectory,
  } as const
  const launcher = dependencies.createLauncher
    ? dependencies.createLauncher(launcherInput)
    : new CodexAcpRuntimeLauncher(launcherInput)

  try {
    const result = await runAssistantConnectionCheck(
      launcher,
      {
        mcp: {
          command: dependencies.execPath,
          entryPath: mcpEntryPath,
          endpoint: dependencies.endpoint,
          token: grant.token,
          schoolId: probeSchoolId,
          agentRunId: probeRunId,
          extraEnv: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
        },
        forbiddenWorkspaceRoots: [dependencies.userDataDirectory],
        ...(dependencies.timeoutMs === undefined ? {} : { timeoutMs: dependencies.timeoutMs }),
      },
      {
        ...(dependencies.onDiagnostic ? { onDiagnostic: dependencies.onDiagnostic } : {}),
        ...(dependencies.verifyTools ? { verifyTools: dependencies.verifyTools } : {}),
      },
    )
    dependencies.onDiagnostic?.(`connection check: ${result.outcome} — ${result.detail}`)
    return describeConnectionCheck(result, now())
  } finally {
    // The token dies with the probe, not with its lifetime.
    dependencies.readPlane.revokeToken(grant.token)
  }
}
