import {
  agent,
  methods,
  type AgentApp,
  type AnyMessage,
  type Stream,
} from '@agentclientprotocol/sdk'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AcpRuntimeConnection, AcpRuntimeLauncher } from './acp-runtime'
import { agentBootstrapText } from './bootstrap'
import {
  classifyMcpStartupReport,
  connectionCheckPromptText,
  runAssistantConnectionCheck,
} from './connection-check'
import { AgentHostError } from './contracts'
import { workbenchMcpServerName } from './mcp-descriptor'

function memoryStreamPair(): readonly [Stream, Stream] {
  const forward = new TransformStream<AnyMessage, AnyMessage>()
  const backward = new TransformStream<AnyMessage, AnyMessage>()
  return [
    { writable: forward.writable, readable: backward.readable },
    { writable: backward.writable, readable: forward.readable },
  ]
}

/**
 * An ACP agent running in this process, standing in for the runtime process
 * only. It is not a stand-in for the model, the tool server or the read plane:
 * it exists so the probe's own wiring and its verdicts can be asserted without
 * money, network or a Codex login.
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

class UnstartableLauncher implements AcpRuntimeLauncher {
  readonly describe = 'a runtime that is not installed (test only)'

  async launch(): Promise<AcpRuntimeConnection> {
    throw new AgentHostError('RUNTIME_NOT_FOUND', 'The codex-acp bridge was not found.')
  }
}

type ScriptedOptions = Readonly<{
  onPrompt?: (context: {
    notify: (update: Record<string, unknown>) => Promise<void>
  }) => Promise<string>
}>

function scriptedAgent(options: ScriptedOptions = {}): {
  app: AgentApp
  promptRequests: unknown[]
  newSessionRequests: unknown[]
} {
  const promptRequests: unknown[] = []
  const newSessionRequests: unknown[] = []

  const app = agent({ name: 'scripted-agent' })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: 1,
      agentCapabilities: {},
      agentInfo: { name: 'scripted-agent', version: '0.0.0-test' },
    }))
    .onRequest(methods.agent.session.new, async (context) => {
      newSessionRequests.push(context.params)
      return { sessionId: 'probe-session' }
    })
    .onNotification(methods.agent.session.cancel, async () => undefined)
    .onRequest(methods.agent.session.close, async () => ({}))
    .onRequest(methods.agent.session.prompt, async (context) => {
      promptRequests.push(context.params)
      const stopReason = await (options.onPrompt ?? (async () => 'end_turn'))({
        notify: (update) =>
          context.client.notify(methods.client.session.update, {
            sessionId: 'probe-session',
            update,
          } as never),
      })
      return { stopReason } as never
    })

  return { app, promptRequests, newSessionRequests }
}

/** The shape codex-acp uses to report an MCP server that failed or was cancelled. */
function mcpStartupReport(text: string): Record<string, unknown> {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: `mcp_startup.${encodeURIComponent(workbenchMcpServerName)}`,
    kind: 'other',
    title: `mcp__${workbenchMcpServerName}__startup`,
    status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text } }],
  }
}

const scratchDirectories: string[] = []

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'connection-check-'))
  scratchDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (scratchDirectories.length > 0) {
    const directory = scratchDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function probeRequest(workspaceRoot: string, userData: string) {
  return {
    mcp: {
      command: '/usr/local/bin/node',
      entryPath: '/repo/packages/workbench-mcp/dist/stdio.js',
      endpoint: 'http://127.0.0.1:52341/internal/v1',
      token: 'a'.repeat(43),
      schoolId: 'connection-check-0f2b',
      agentRunId: 'connection-check-91ac',
    },
    workspaceRoot,
    forbiddenWorkspaceRoots: [userData],
  }
}

/** The probe never contacts a real MCP server in these tests. */
const toolsVisible = async () =>
  Object.freeze({
    visibleTools: Object.freeze([]),
    missingTools: Object.freeze([]),
    forbiddenTools: Object.freeze([]),
  })

describe('what the connection test sends', () => {
  it('sends one trivial prompt and no school data at all', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '可以' },
        })
        return 'end_turn'
      },
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('ok')
    expect(scripted.promptRequests).toHaveLength(1)
    const sent = JSON.stringify(scripted.promptRequests[0])
    expect(sent).toContain(connectionCheckPromptText)
    // Not the SPEC 26 bootstrap: that text sends the assistant off to read a
    // school, and a probe has no school.
    expect(sent).not.toContain(agentBootstrapText)
    expect(sent).not.toContain('顾问')
  })

  it('records nothing, because it is asked for nothing and calls no tool', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '可以' },
        })
        return 'end_turn'
      },
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    // Every workbench write travels through a workbench tool call, so a probe
    // that made none wrote nothing. `apps/desktop` holds the same property
    // against a real database.
    expect(result.workbenchToolCalls).toEqual([])
  })

  it('grants nothing when the runtime asks for permission', async () => {
    const scripted = scriptedAgent({
      onPrompt: async () => 'end_turn',
    })
    const diagnostics: string[] = []
    await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible, onDiagnostic: (message) => diagnostics.push(message) },
    )
    // Nothing to assert about permissions being granted, because none can be:
    // the handler has one answer. Kept as a run so the wiring stays exercised.
    expect(diagnostics.every((line) => !line.includes('selected'))).toBe(true)
  })
})

describe('how the connection test explains a failure', () => {
  it('tells a cancelled tool server apart from one that failed to start', () => {
    expect(classifyMcpStartupReport('failed to start: No such file or directory')).toBe('failed')
    expect(classifyMcpStartupReport('startup was cancelled.')).toBe('cancelled')
    // No text at all is not evidence of a cancellation.
    expect(classifyMcpStartupReport('')).toBe('failed')
  })

  it('reports a cancelled tool server as its own kind of failure', async () => {
    // The incident this check exists for: the model call fails, and the runtime
    // tears down a tool server that was still starting on its way out.
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupReport('startup was cancelled.'))
        return 'end_turn'
      },
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('workbench_tools_cancelled')
    expect(result.mcpStartup).toBe('cancelled')
  })

  it('reports a tool server that genuinely failed to start as a different problem', async () => {
    const scripted = scriptedAgent({
      onPrompt: async ({ notify }) => {
        await notify(mcpStartupReport('failed to start: No such file or directory'))
        return 'end_turn'
      },
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('workbench_tools_unavailable')
    expect(result.mcpStartup).toBe('failed')
  })

  it('reports a model that never answers as a model problem', async () => {
    const scripted = scriptedAgent({ onPrompt: async () => 'end_turn' })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('model_backend_unreachable')
    expect(result.modelAnswered).toBe(false)
  })

  it('reports a turn that blew up as a model problem too', async () => {
    const scripted = scriptedAgent({
      onPrompt: async () => {
        throw new Error('stream error: 400 unsupported tool type "namespace"')
      },
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('model_backend_unreachable')
  })

  it('reports waiting too long as waiting too long, not as a broken assistant', async () => {
    const scripted = scriptedAgent({
      onPrompt: async () => new Promise<string>(() => undefined),
    })
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      { ...probeRequest(scratchRoot(), scratchRoot()), timeoutMs: 50 },
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('timed_out')
  })

  it('reports a runtime that will not start as a runtime problem', async () => {
    const result = await runAssistantConnectionCheck(
      new UnstartableLauncher(),
      probeRequest(scratchRoot(), scratchRoot()),
      { verifyTools: toolsVisible },
    )

    expect(result.outcome).toBe('runtime_unavailable')
  })

  it('reports an invisible tool surface separately from a runtime that will not start', async () => {
    const scripted = scriptedAgent()
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scripted.app),
      probeRequest(scratchRoot(), scratchRoot()),
      {
        verifyTools: async () => {
          throw new AgentHostError(
            'WORKBENCH_MCP_TOOLS_INVISIBLE',
            'The workbench MCP server did not expose: school_context',
          )
        },
      },
    )

    expect(result.outcome).toBe('workbench_tools_unavailable')
  })

  it('never throws, whatever happens', async () => {
    // A probe that threw would be indistinguishable from an assistant that is
    // down, which is the one thing it must never confuse.
    const result = await runAssistantConnectionCheck(
      new InProcessRuntimeLauncher(scriptedAgent().app),
      { ...probeRequest(scratchRoot(), scratchRoot()), forbiddenWorkspaceRoots: ['/'] },
      { verifyTools: toolsVisible },
    )
    expect(result.outcome).toBe('runtime_unavailable')
  })
})
