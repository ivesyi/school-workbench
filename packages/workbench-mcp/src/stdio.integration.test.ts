import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import {
  createWorkbenchReadPlaneBootstrap,
  readCapabilityNames,
  readScopes,
  type WorkbenchReadCapabilityService,
} from '@school-workbench/workbench-read-plane'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let bundleDirectory = ''
let serverBundle = ''

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'workbench-mcp-process-'))
  serverBundle = join(bundleDirectory, 'stdio.mjs')
  await build({
    entryPoints: [resolve('packages/workbench-mcp/src/stdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: serverBundle,
    logLevel: 'silent',
  })
})

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true })
})

function fakeService(): WorkbenchReadCapabilityService {
  return {
    schoolContext: async (schoolId: string) => ({
      school: {
        id: schoolId,
        name: 'MCP Fixture School',
        createdAt: '2026-08-17T00:00:00.000Z',
        archivedAt: null,
      },
      activeStage: null,
      latestSnapshot: null,
      recentJudgments: [],
      judgmentLimit: 10,
      judgmentOrder: 'createdAt_desc_id_desc',
    }),
    stageCurrent: async () => ({ status: 'absent', reason: 'no_active_stage' }),
    stateCurrent: async () => ({ status: 'absent', reason: 'no_snapshot' }),
    stateHistory: async (_schoolId: string, input: unknown) => ({
      items: [],
      order: 'sequence_desc',
      limit: (input as { limit?: number }).limit ?? 10,
      nextBeforeSequence: null,
    }),
    evidenceList: async (_schoolId: string, input: unknown) => ({
      items: [],
      order: 'createdAt_desc_id_desc',
      limit: (input as { limit?: number }).limit ?? 20,
      nextCursor: null,
    }),
    diagnosisList: async (_schoolId: string, input: unknown) => ({
      items: [],
      order: 'createdAt_desc_id_desc',
      limit: (input as { limit?: number }).limit ?? 20,
      nextCursor: null,
    }),
    standardsGet: async () => ({
      status: 'no_active_pack',
      packKey: 'fixture',
      version: '1',
      reason: 'file_not_active',
    }),
  } as unknown as WorkbenchReadCapabilityService
}

function mcpEnv(endpoint: string, token: string) {
  return {
    ...getDefaultEnvironment(),
    SWB_ENDPOINT: endpoint,
    SWB_TOKEN: token,
    SWB_SCHOOL_ID: 'school-a',
    SWB_AGENT_RUN_ID: 'run-a',
  }
}

async function connectClient(endpoint: string, token: string) {
  const client = new Client({ name: 'workbench-read-plane-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverBundle],
    env: mcpEnv(endpoint, token),
    stderr: 'pipe',
  })
  await client.connect(transport)
  return client
}

function textResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  const block = result.content.find((item) => item.type === 'text')
  if (!block || block.type !== 'text') throw new Error('expected text tool result')
  return block.text
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 5_000) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('child did not exit cleanly')), timeoutMs)
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        resolvePromise({ code, signal })
      })
    },
  )
}

describe('workbench-mcp stdio process', () => {
  it('initializes with the official SDK client, exposes exactly seven read tools, and calls every tool', async () => {
    const loopback = createWorkbenchReadPlaneBootstrap(fakeService())
    const endpoint = await loopback.start()
    const grant = loopback.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: readScopes,
    })
    const client = await connectClient(endpoint, grant.token)

    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...readCapabilityNames].sort())
      expect(listed.tools).toHaveLength(7)
      expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)

      const calls = [
        ['school_context', {}],
        ['stage_current', {}],
        ['state_current', {}],
        ['state_history', { limit: 1 }],
        ['evidence_list', { limit: 1 }],
        ['diagnosis_list', { limit: 1 }],
        ['standards_get', { packKey: 'fixture', version: '1', criterionRefs: ['FIX.C1'] }],
      ] as const

      for (const [name, args] of calls) {
        const result = await client.callTool({ name, arguments: args })
        expect(result.isError).not.toBe(true)
        expect(() => JSON.parse(textResult(result))).not.toThrow()
      }

      expect(readFileSync(resolve('packages/workbench-mcp/src/stdio.ts'), 'utf8')).not.toContain(
        'console.log(',
      )
    } finally {
      await client.close()
      await loopback.stop()
    }
  })

  it('maps a local capability scope error to a stable MCP tool error without exposing the token', async () => {
    const loopback = createWorkbenchReadPlaneBootstrap(fakeService())
    const endpoint = await loopback.start()
    const grant = loopback.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: ['school.read'],
    })
    const client = await connectClient(endpoint, grant.token)

    try {
      const result = await client.callTool({ name: 'evidence_list', arguments: {} })
      expect(result.isError).toBe(true)
      expect(textResult(result)).toContain('AUTH_SCOPE_DENIED')
      expect(textResult(result)).not.toContain(grant.token)
    } finally {
      await client.close()
      await loopback.stop()
    }
  })

  it.each(['eof', 'sigterm'] as const)(
    'exits cleanly on %s without stdout pollution',
    async (mode) => {
      const loopback = createWorkbenchReadPlaneBootstrap(fakeService())
      const endpoint = await loopback.start()
      const grant = loopback.issueToken({
        schoolId: 'school-a',
        agentRunId: 'run-a',
        scopes: readScopes,
      })
      const child = spawn(process.execPath, [serverBundle], {
        env: { ...process.env, ...mcpEnv(endpoint, grant.token) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })

      if (mode === 'eof') child.stdin.end()
      else {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
        child.kill('SIGTERM')
      }
      const exited = await waitForExit(child)
      await loopback.stop()

      expect(exited.code === 0 || exited.signal === 'SIGTERM').toBe(true)
      expect(stdout).toBe('')
      expect(stderr).not.toContain(grant.token)
    },
  )

  it('fails before serving when required bootstrap env is missing and never echoes supplied secrets', async () => {
    const secret = 's'.repeat(43)
    const child = spawn(process.execPath, [serverBundle], {
      env: {
        ...process.env,
        SWB_ENDPOINT: 'http://127.0.0.1:43210/internal/v1',
        SWB_TOKEN: secret,
        SWB_SCHOOL_ID: 'school-a',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end()
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    const exited = await waitForExit(child)

    expect(exited.code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('ENV_INVALID')
    expect(stderr).not.toContain(secret)
  })
})
