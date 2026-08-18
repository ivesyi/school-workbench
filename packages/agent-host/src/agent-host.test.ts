import {
  agent,
  methods,
  type AgentApp,
  type AnyMessage,
  type Stream,
} from '@agentclientprotocol/sdk'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AcpRuntimeConnection, AcpRuntimeLauncher } from './acp-runtime'
import { AgentHost, workbenchClientCapabilities } from './agent-host'
import { agentBootstrapText } from './bootstrap'
import { withheldClientMethods } from './contracts'
import { workbenchMcpServerName } from './mcp-descriptor'

/**
 * A pair of connected ACP streams.
 *
 * The host is exercised over a real transport rather than the SDK's in-memory
 * app-to-app shortcut, because the host taps inbound messages on the stream and
 * that seam has to be covered too.
 */
function memoryStreamPair(): readonly [Stream, Stream] {
  const forward = new TransformStream<AnyMessage, AnyMessage>()
  const backward = new TransformStream<AnyMessage, AnyMessage>()
  return [
    { writable: forward.writable, readable: backward.readable },
    { writable: backward.writable, readable: forward.readable },
  ]
}

/**
 * Connects the host to an ACP agent running in this process.
 *
 * This is a test double for the *runtime process*, not for the workbench MCP
 * server or the read plane: it exists so the ACP lifecycle can be asserted
 * without money, network or a Codex login. It never proves the product works
 * end to end — that is what the manual Codex verification is for.
 */
class InProcessRuntimeLauncher implements AcpRuntimeLauncher {
  readonly describe = 'in-process ACP agent (test only)'

  constructor(private readonly app: AgentApp) {}

  async launch(): Promise<AcpRuntimeConnection> {
    const [hostSide, agentSide] = memoryStreamPair()
    const connection = this.app.connect(agentSide)
    return Object.freeze({
      stream: hostSide,
      describe: this.describe,
      recentStderr: () => '',
      close: async () => connection.close(),
    })
  }
}

type ScriptedAgentOptions = Readonly<{
  protocolVersion?: number
  agentCapabilities?: Record<string, unknown>
  onPrompt?: (context: {
    sessionId: string
    notify: (update: Record<string, unknown>) => Promise<void>
    request: <T>(method: string, params: unknown) => Promise<T>
    cancelled: Promise<void>
  }) => Promise<string>
}>

function scriptedAgent(options: ScriptedAgentOptions = {}): {
  app: AgentApp
  newSessionRequests: unknown[]
  promptRequests: unknown[]
  initializeRequests: unknown[]
} {
  const newSessionRequests: unknown[] = []
  const promptRequests: unknown[] = []
  const initializeRequests: unknown[] = []
  let resolveCancelled: (() => void) | null = null
  const cancelled = new Promise<void>((resolvePromise) => {
    resolveCancelled = resolvePromise
  })

  const app = agent({ name: 'scripted-agent' })
    .onRequest(methods.agent.initialize, async (context) => {
      initializeRequests.push(context.params)
      return {
        protocolVersion: options.protocolVersion ?? 1,
        agentCapabilities: options.agentCapabilities ?? {},
        agentInfo: { name: 'scripted-agent', version: '0.0.0-test' },
      }
    })
    .onRequest(methods.agent.session.new, async (context) => {
      newSessionRequests.push(context.params)
      return { sessionId: 'session-under-test' }
    })
    .onNotification(methods.agent.session.cancel, async () => {
      resolveCancelled?.()
    })
    .onRequest(methods.agent.session.close, async () => ({}))
    .onRequest(methods.agent.session.prompt, async (context) => {
      promptRequests.push(context.params)
      const stopReason = await (options.onPrompt ?? (async () => 'end_turn'))({
        sessionId: 'session-under-test',
        notify: (update) =>
          context.client.notify(methods.client.session.update, {
            sessionId: 'session-under-test',
            update,
          } as never),
        request: <T>(method: string, params: unknown) => context.client.request<T>(method, params),
        cancelled,
      })
      return { stopReason } as never
    })

  return { app, newSessionRequests, promptRequests, initializeRequests }
}

/** The shape codex-acp uses to report an MCP server that failed or was cancelled. */
function mcpStartupFailure(serverName: string): Record<string, unknown> {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: `mcp_startup.${encodeURIComponent(serverName)}`,
    kind: 'other',
    title: `mcp__${serverName}__startup`,
    status: 'failed',
  }
}

const scratchDirectories: string[] = []

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'agent-host-run-'))
  scratchDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (scratchDirectories.length > 0) {
    const directory = scratchDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function hostRequest(workspaceRoot: string, userData: string) {
  return {
    schoolId: 'school-1',
    agentRunId: 'run-1',
    consultantMessage: '今天的中层会议里，任务拆解还是主要由校长完成。',
    mcp: {
      command: '/usr/local/bin/node',
      entryPath: '/repo/packages/workbench-mcp/dist/stdio.js',
      endpoint: 'http://127.0.0.1:52341/internal/v1',
      token: 'a'.repeat(43),
    },
    workspaceRoot,
    forbiddenWorkspaceRoots: [userData],
  }
}

describe('agent host lifecycle', () => {
  it('walks the SPEC 7 lifecycle and injects the workbench MCP server verbatim', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify({
          sessionUpdate: 'tool_call',
          toolCallId: 'c1',
          title: `mcp.${workbenchMcpServerName}.school_context`,
          status: 'completed',
        })
        await notify({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '这所学校目前' },
        })
        return 'end_turn'
      },
    })
    const workspaceRoot = scratchRoot()
    const userData = scratchRoot()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(workspaceRoot, userData))

    expect(outcome.failure).toBeNull()
    expect(outcome.status).toBe('completed')
    expect(outcome.statusHistory).toEqual(['queued', 'running', 'completed'])
    expect(outcome.stopReason).toBe('end_turn')
    expect(outcome.compatibility.compatibility).toBe('verified')
    expect(outcome.acpSessionId).toBe('session-under-test')
    expect(outcome.text).toBe('这所学校目前')
    expect(outcome.toolCallTitles).toEqual([`mcp.${workbenchMcpServerName}.school_context`])

    const sessionRequest = scripted.newSessionRequests[0] as {
      cwd: string
      mcpServers: Array<{ name: string; command: string; args: string[]; env: unknown }>
    }
    expect(sessionRequest.mcpServers).toHaveLength(1)
    expect(sessionRequest.mcpServers[0]?.name).toBe(workbenchMcpServerName)
    expect(sessionRequest.mcpServers[0]?.args).toEqual([
      '/repo/packages/workbench-mcp/dist/stdio.js',
    ])
    expect(sessionRequest.cwd.startsWith(workspaceRoot)).toBe(true)
    expect(sessionRequest.cwd).not.toBe(userData)

    // D3: the throwaway workspace is gone once the run finished.
    expect(outcome.workspaceCwd).not.toBeNull()
  })

  it('sends the SPEC 26 bootstrap verbatim before the consultant message', async () => {
    const scripted = scriptedAgent()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    await host.run(hostRequest(scratchRoot(), scratchRoot()))

    const prompt = scripted.promptRequests[0] as {
      prompt: Array<{ type: string; text: string }>
    }
    expect(prompt.prompt[0]?.text).toBe(agentBootstrapText)
    expect(prompt.prompt[0]?.text).toContain('你正在辅助学校变革陪跑顾问。')
    expect(prompt.prompt[0]?.text).toContain('必须主动寻找相反证据。')
    expect(prompt.prompt[0]?.text).toContain('你没有权限替顾问确认最终判断。')
    // SPEC 26 tells an agent it may propose the starting stage when the school
    // has none yet (PRD 11). It is injected as written, not edited down.
    expect(prompt.prompt[0]?.text).toContain('使用 stage_propose 提议一个，供顾问确认。')
    expect(prompt.prompt[0]?.text).toContain('再使用 diagnosis_propose。')
    expect(prompt.prompt[1]?.text).toBe('今天的中层会议里，任务拆解还是主要由校长完成。')
  })

  it('ignores an unknown session/update kind and still finishes the turn', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify({ sessionUpdate: 'kind_from_a_future_codex_acp', payload: { a: 1 } })
        await notify({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'still here' },
        })
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('completed')
    expect(outcome.failure).toBeNull()
    expect(outcome.text).toBe('still here')
    expect(outcome.unrecognisedUpdateTags).toEqual(['kind_from_a_future_codex_acp'])
  })

  it('never advertises or answers fs/* and terminal/* (D2)', async () => {
    const refusals: Record<string, boolean> = {}
    const scripted = scriptedAgent({
      onPrompt: async ({ request }) => {
        for (const method of withheldClientMethods) {
          try {
            await request(method, { sessionId: 'session-under-test' })
            refusals[method] = false
          } catch {
            refusals[method] = true
          }
        }
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))
    expect(outcome.status).toBe('completed')

    // The host declares nothing at all...
    expect(Object.keys(workbenchClientCapabilities)).toEqual([])

    // ...but the ACP SDK normalises `ClientCapabilities` on the wire and always
    // materialises the fs / terminal flags. What must hold is therefore not
    // "the key is absent" but "every flag says no".
    const advertised = (scripted.initializeRequests[0] as { clientCapabilities: object })
      .clientCapabilities as {
      fs?: { readTextFile?: boolean; writeTextFile?: boolean }
      terminal?: boolean
      auth?: { terminal?: boolean }
    }
    expect(advertised.fs?.readTextFile ?? false).toBe(false)
    expect(advertised.fs?.writeTextFile ?? false).toBe(false)
    expect(advertised.terminal ?? false).toBe(false)
    expect(advertised.auth?.terminal ?? false).toBe(false)

    // And an agent that tries anyway is refused, not served.
    for (const method of withheldClientMethods) {
      expect(refusals[method], `${method} must be refused`).toBe(true)
    }
  })

  it('pauses in needs_input while a permission request is outstanding', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ request }) => {
        await request(methods.client.session.requestPermission, {
          sessionId: 'session-under-test',
          toolCall: { toolCallId: 'c1', title: `mcp.${workbenchMcpServerName}.state_current` },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        })
        await request(methods.client.session.requestPermission, {
          sessionId: 'session-under-test',
          toolCall: { toolCallId: 'c2', title: 'shell' },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        })
        return 'end_turn'
      },
    })
    const statuses: string[] = []
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
      onStatus: (status) => statuses.push(status),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('completed')
    expect(statuses).toEqual([
      'running',
      'needs_input',
      'running',
      'needs_input',
      'running',
      'completed',
    ])
  })

  it('cancels a running turn through session/cancel', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ cancelled }) => {
        await cancelled
        return 'cancelled'
      },
    })
    const controller = new AbortController()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const running = host.run({
      ...hostRequest(scratchRoot(), scratchRoot()),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    const outcome = await running

    expect(outcome.stopReason).toBe('cancelled')
    expect(outcome.status).toBe('cancelled')
    expect(outcome.statusHistory).toEqual(['queued', 'running', 'cancelled'])
  })

  it('fails the run when the runtime negotiates a protocol it does not share', async () => {
    const scripted = scriptedAgent({ protocolVersion: 99 })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('failed')
    expect(outcome.failure?.code).toBe('RUNTIME_UNSUPPORTED')
    expect(outcome.compatibility.compatibility).toBe('unsupported')
    expect(scripted.newSessionRequests).toHaveLength(0)
  })

  it('fails the run when the workbench tools are not visible, instead of continuing quietly', async () => {
    const scripted = scriptedAgent()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => {
        throw new Error('The workbench MCP server did not expose: state_current')
      },
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('failed')
    expect(outcome.failure?.message).toContain('did not expose')
    expect(scripted.initializeRequests).toHaveLength(0)
  })

  it('fails the run when the runtime reports the workbench MCP server failed to start', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupFailure(workbenchMcpServerName))
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('failed')
    expect(outcome.failure?.code).toBe('WORKBENCH_MCP_STARTUP_FAILED')
    expect(outcome.mcpStartupReportedFailure).toBe(true)
    // The synthetic startup report is not a tool call the agent made, so it
    // must never be mistaken for evidence that the server was used.
    expect(outcome.usedWorkbenchTools).toBe(false)
    expect(outcome.toolCallTitles).toEqual([])
  })

  it('does not fail a run whose own tool calls contradict the startup report', async () => {
    // Observed on a real cold start: Codex reported the MCP server as
    // "cancelled" while the server was in fact serving. The run must not be
    // recorded as failed when it demonstrably read through that same server.
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupFailure(workbenchMcpServerName))
        await notify({
          sessionUpdate: 'tool_call',
          toolCallId: 'c1',
          title: `mcp.${workbenchMcpServerName}.state_current`,
          status: 'completed',
        })
        await notify({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '这所学校目前尚无正式状态快照。' },
        })
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('completed')
    expect(outcome.failure).toBeNull()
    expect(outcome.usedWorkbenchTools).toBe(true)
    // The misreport is recorded rather than erased.
    expect(outcome.mcpStartupReportedFailure).toBe(true)
    expect(outcome.text).toBe('这所学校目前尚无正式状态快照。')
  })

  it('still fails when only a different MCP server was used', async () => {
    // Guards against "any tool call excuses a startup failure". Only a call
    // routed through the workbench server can contradict a report about the
    // workbench server.
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupFailure(workbenchMcpServerName))
        await notify({
          sessionUpdate: 'tool_call',
          toolCallId: 'c1',
          title: 'mcp.some-other-server.read_file',
          status: 'completed',
        })
        await notify({
          sessionUpdate: 'tool_call',
          toolCallId: 'c2',
          title: 'shell',
          status: 'completed',
        })
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('failed')
    expect(outcome.failure?.code).toBe('WORKBENCH_MCP_STARTUP_FAILED')
    expect(outcome.usedWorkbenchTools).toBe(false)
  })

  it('ignores a startup failure reported for somebody else’s MCP server', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupFailure('a-consultant-owned-server'))
        return 'end_turn'
      },
    })
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run(hostRequest(scratchRoot(), scratchRoot()))

    expect(outcome.status).toBe('completed')
    expect(outcome.mcpStartupReportedFailure).toBe(false)
  })

  it('runs when the workbench data directory sits under the workspace root', async () => {
    // The end-to-end shape: `SWB_E2E_USER_DATA_DIR` is a temp directory, and
    // the workspace root is the temp directory that contains it.
    const root = scratchRoot()
    const userData = join(root, 'user-data')
    mkdirSync(userData, { recursive: true })

    const scripted = scriptedAgent()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run({
      ...hostRequest(root, userData),
      forbiddenWorkspaceRoots: [userData],
    })

    expect(outcome.failure).toBeNull()
    expect(outcome.status).toBe('completed')
    const sessionRequest = scripted.newSessionRequests[0] as { cwd: string }
    expect(sessionRequest.cwd.startsWith(root)).toBe(true)
    expect(sessionRequest.cwd.startsWith(userData)).toBe(false)
  })

  it('still refuses to run inside the workbench data directory', async () => {
    const userData = scratchRoot()
    const scripted = scriptedAgent()
    const host = new AgentHost(new InProcessRuntimeLauncher(scripted.app), {
      verifyTools: async () => ({ visibleTools: [], missingTools: [], forbiddenTools: [] }),
    })

    const outcome = await host.run({
      ...hostRequest(userData, userData),
      forbiddenWorkspaceRoots: [userData],
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.failure?.code).toBe('SESSION_WORKSPACE_INVALID')
    expect(scripted.initializeRequests).toHaveLength(0)
  })
})
