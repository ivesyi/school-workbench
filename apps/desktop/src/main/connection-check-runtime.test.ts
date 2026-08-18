import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  type Model,
} from '@earendil-works/pi-ai'
import type { AcpRuntimeConnection, AcpRuntimeLauncher } from '@school-workbench/agent-host'
import { openWorkbenchDatabase, type WorkbenchDatabase } from '@school-workbench/db'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAssistantConnection } from './connection-check-runtime'
import { startWorkbenchReadPlane, type ReadPlaneRuntime } from './read-plane-runtime'

const migrationsFolder = resolve('packages/db/drizzle')

type RpcMessage = Record<string, unknown>

/**
 * A minimal ACP agent, answered by hand.
 *
 * It stands in for the runtime *process* and nothing else: the read plane, the
 * database and the composition under test are all real. It is written against
 * the wire messages rather than the ACP SDK because this workspace does not
 * depend on that SDK — the workbench spawns the bridge as an opaque artifact
 * (SPEC 12), and the probe's own package owns the protocol.
 */
class HandWrittenRuntimeLauncher implements AcpRuntimeLauncher {
  readonly describe = 'hand-written ACP agent (test only)'

  async launch(): Promise<AcpRuntimeConnection> {
    const toAgent = new TransformStream<RpcMessage, RpcMessage>()
    const toHost = new TransformStream<RpcMessage, RpcMessage>()
    const writer = toHost.writable.getWriter()
    const reader = toAgent.readable.getReader()
    let closed = false

    const reply = async (id: unknown, result: RpcMessage): Promise<void> => {
      await writer.write({ jsonrpc: '2.0', id, result })
    }

    void (async () => {
      for (;;) {
        const next = await reader.read().catch(() => ({ done: true, value: undefined }) as const)
        if (next.done || closed) return
        const message = next.value as RpcMessage | undefined
        if (!message || typeof message['method'] !== 'string') continue
        const id = message['id']
        switch (message['method']) {
          case 'initialize':
            await reply(id, {
              protocolVersion: 1,
              agentCapabilities: {},
              agentInfo: { name: 'hand-written-agent', version: '0.0.0-test' },
            })
            break
          case 'session/new':
            await reply(id, { sessionId: 'probe-session' })
            break
          case 'session/prompt':
            await writer.write({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'probe-session',
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: '可以' },
                },
              },
            })
            await reply(id, { stopReason: 'end_turn' })
            break
          case 'session/close':
            await reply(id, {})
            break
          default:
            if (id !== undefined) await reply(id, {})
            break
        }
      }
    })()

    return Object.freeze({
      stream: {
        readable: toHost.readable,
        writable: toAgent.writable,
      } as AcpRuntimeConnection['stream'],
      describe: this.describe,
      recentStderr: () => '',
      close: async () => {
        closed = true
        await writer.close().catch(() => undefined)
        await reader.cancel().catch(() => undefined)
      },
    })
  }
}

/**
 * Stands in for the workbench MCP server process.
 *
 * The real check spawns the bundle that `pnpm build` produces; `pnpm test` does
 * not build it, so depending on it here would make this test pass or fail on
 * how recently somebody ran a build. What is under test is the composition and
 * what it writes, and neither depends on the tool listing.
 */
const toolsVisible = async () =>
  Object.freeze({
    visibleTools: Object.freeze([]),
    missingTools: Object.freeze([]),
    forbiddenTools: Object.freeze([]),
  })

let database: WorkbenchDatabase
let runtime: ReadPlaneRuntime | undefined
const scratchDirectories: string[] = []

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'connection-check-runtime-'))
  scratchDirectories.push(directory)
  return directory
}

/** Every row in the workbench database, table by table. */
function rowCounts(): Record<string, number> {
  const tables = database.client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
    )
    .all() as Array<{ name: string }>
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const row = database.client.prepare(`SELECT COUNT(*) AS total FROM "${table.name}"`).get() as {
      total: number
    }
    counts[table.name] = row.total
  }
  return counts
}

beforeEach(() => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run('school-1', '南山实验学校', '2026-08-18T00:00:00.000Z')
})

afterEach(async () => {
  await runtime?.stop()
  runtime = undefined
  database.close()
  while (scratchDirectories.length > 0) {
    const directory = scratchDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('the connection test as the application runs it', () => {
  it('adds nothing at all to the workbench database', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const before = rowCounts()
    // The database has real content, so "nothing was added" is a claim about a
    // populated workbench rather than an empty one.
    expect(before['schools']).toBeGreaterThan(0)

    const view = await checkAssistantConnection({
      readPlane: runtime.plane,
      endpoint: runtime.endpoint,
      mainDirectory: resolve('apps/desktop/out/main'),
      execPath: process.execPath,
      userDataDirectory: scratchRoot(),
      createLauncher: () => new HandWrittenRuntimeLauncher(),
      verifyTools: toolsVisible,
    })

    expect(view.state).toBe('ok')
    // No Agent Run, no session, no evidence, no proposal — nothing anywhere.
    expect(rowCounts()).toEqual(before)
  })

  it('says so in plain words when it could not even start, and still writes nothing', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const before = rowCounts()

    const view = await checkAssistantConnection({
      readPlane: runtime.plane,
      endpoint: runtime.endpoint,
      mainDirectory: resolve('apps/desktop/out/main'),
      execPath: process.execPath,
      userDataDirectory: scratchRoot(),
      environment: { ...process.env, SWB_CODEX_ACP_ENTRY: '/nowhere/at/all.js' },
      createLauncher: () => new HandWrittenRuntimeLauncher(),
      verifyTools: toolsVisible,
    })

    expect(view.state).toBe('failed')
    expect(view.detail).toContain('这是 AI 助手环境的问题，不是你的操作或学校资料的问题')
    expect(rowCounts()).toEqual(before)
  })

  it('never puts machinery or a school in front of the consultant', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const view = await checkAssistantConnection({
      readPlane: runtime.plane,
      endpoint: runtime.endpoint,
      mainDirectory: resolve('apps/desktop/out/main'),
      execPath: process.execPath,
      userDataDirectory: scratchRoot(),
      createLauncher: () => new HandWrittenRuntimeLauncher(),
      verifyTools: toolsVisible,
    })

    const shown = `${view.headline}\n${view.detail}`
    for (const word of [
      'ACP',
      'MCP',
      'stdio',
      'loopback',
      'token',
      'scope',
      'session',
      'runtime',
      'SQLite',
      'node_modules',
      '127.0.0.1',
      '/',
      '南山实验学校',
      'RUNTIME_NOT_FOUND',
    ]) {
      expect(shown, word).not.toContain(word)
    }
  })
})

/**
 * A scripted model behind the built-in assistant's probe.
 *
 * Everything else — the read plane, the capability token, the driver, the tool
 * set, the database — is the real thing.
 */
function scriptedChannel(text: string) {
  const faux = fauxProvider({ provider: 'probe-faux', models: [{ id: 'probe-model' }] })
  faux.setResponses([fauxAssistantMessage([fauxText(text)])])
  const models = createModels()
  models.setProvider(faux.provider)
  return () => ({ models, model: faux.getModel() as Model<string> })
}

describe('the same connection test, for the built-in assistant', () => {
  it('adds nothing at all to the workbench database either', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const before = rowCounts()
    expect(before['schools']).toBeGreaterThan(0)

    const view = await checkAssistantConnection(
      {
        readPlane: runtime.plane,
        endpoint: runtime.endpoint,
        mainDirectory: resolve('apps/desktop/out/main'),
        execPath: process.execPath,
        userDataDirectory: scratchRoot(),
        resolveModelChannel: async () => ({
          baseUrl: 'https://example.invalid/v1',
          model: 'probe-model',
          apiKey: 'probe-key',
        }),
        createModelChannel: scriptedChannel('可以'),
      },
      'builtin',
    )

    expect(view.state).toBe('ok')
    expect(rowCounts()).toEqual(before)
  })

  it('tells the consultant to fill in the model connection, not to install Codex', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const before = rowCounts()

    const view = await checkAssistantConnection(
      {
        readPlane: runtime.plane,
        endpoint: runtime.endpoint,
        mainDirectory: resolve('apps/desktop/out/main'),
        execPath: process.execPath,
        userDataDirectory: scratchRoot(),
        // Nothing configured, which is the ordinary starting state.
        resolveModelChannel: async () => null,
      },
      'builtin',
    )

    expect(view.state).toBe('failed')
    expect(view.detail).toContain('模型地址')
    // The Codex advice would be actively misleading here.
    expect(view.detail).not.toContain('Codex')
    expect(rowCounts()).toEqual(before)
  })

  it('never puts machinery in front of the consultant on this path either', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    const view = await checkAssistantConnection(
      {
        readPlane: runtime.plane,
        endpoint: runtime.endpoint,
        mainDirectory: resolve('apps/desktop/out/main'),
        execPath: process.execPath,
        userDataDirectory: scratchRoot(),
        resolveModelChannel: async () => null,
      },
      'builtin',
    )

    const shown = `${view.headline}\n${view.detail}`
    for (const word of ['ACP', 'MCP', 'stdio', 'token', 'scope', 'pi', 'harness', 'provider']) {
      expect(shown, word).not.toContain(word)
    }
  })
})
