import { openWorkbenchDatabase, SqliteReadPlaneRepository } from '@school-workbench/db'
import { MethodologyRegistry } from '@school-workbench/methodology'
import {
  createWorkbenchReadPlaneBootstrap,
  readScopes,
  WorkbenchReadCapabilityService,
} from '@school-workbench/workbench-read-plane'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { forbiddenAgentToolNames, workbenchToolNames } from './contracts'
import { buildWorkbenchMcpDescriptor } from './mcp-descriptor'
import { verifyWorkbenchMcpTools } from './mcp-visibility'

/**
 * Nothing in this file is a stand-in: it runs the real workbench MCP server
 * binary, over real stdio, against a real loopback read plane backed by a real
 * SQLite database. Only the school data is empty.
 */
let bundleDirectory = ''
let serverEntry = ''

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'agent-host-mcp-'))
  serverEntry = join(bundleDirectory, 'stdio.js')
  await build({
    entryPoints: [resolve('packages/workbench-mcp/src/stdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: serverEntry,
    logLevel: 'silent',
  })
}, 60_000)

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true })
})

async function withLoopback<T>(
  operation: (input: Readonly<{ endpoint: string; token: string }>) => Promise<T>,
): Promise<T> {
  const database = openWorkbenchDatabase(':memory:', resolve('packages/db/drizzle'))
  const service = new WorkbenchReadCapabilityService(
    new SqliteReadPlaneRepository(database),
    new MethodologyRegistry([]),
    {
      listPacks: async () => [],
      getPack: async () => null,
      getCriterion: async () => null,
      findCriteria: async () => [],
    },
  )
  const loopback = createWorkbenchReadPlaneBootstrap(service)
  const endpoint = await loopback.start()
  const grant = loopback.issueToken({
    schoolId: 'school-a',
    agentRunId: 'run-a',
    scopes: readScopes,
  })
  try {
    return await operation({ endpoint, token: grant.token })
  } finally {
    await loopback.stop()
    database.close()
  }
}

describe('workbench MCP tool visibility', () => {
  it('runs the exact descriptor and confirms the frozen tool surface is served', async () => {
    const visibility = await withLoopback(async ({ endpoint, token }) =>
      verifyWorkbenchMcpTools(
        buildWorkbenchMcpDescriptor({
          command: process.execPath,
          entryPath: serverEntry,
          endpoint,
          token,
          schoolId: 'school-a',
          agentRunId: 'run-a',
        }),
      ),
    )

    expect(visibility.visibleTools).toEqual([...workbenchToolNames].sort())
    expect(visibility.missingTools).toEqual([])
    expect(visibility.forbiddenTools).toEqual([])
  }, 30_000)

  it('never exposes a tool that could confirm formal state (SPEC 25)', async () => {
    const visibility = await withLoopback(async ({ endpoint, token }) =>
      verifyWorkbenchMcpTools(
        buildWorkbenchMcpDescriptor({
          command: process.execPath,
          entryPath: serverEntry,
          endpoint,
          token,
          schoolId: 'school-a',
          agentRunId: 'run-a',
        }),
      ),
    )

    for (const forbidden of forbiddenAgentToolNames) {
      expect(visibility.visibleTools).not.toContain(forbidden)
    }
    // The three SPEC 18 write tools are part of the surface now; the four
    // SPEC 25 capabilities never are.
    expect(visibility.visibleTools).toContain('evidence_register')
    expect(visibility.visibleTools).toContain('diagnosis_propose')
    expect(visibility.visibleTools).toContain('stage_propose')
    expect(visibility.visibleTools).not.toContain('feishu_ensure_ready')
  }, 30_000)

  it('reports invisible tools rather than letting a run continue', async () => {
    const missingEntry = join(bundleDirectory, 'not-a-server.js')
    await expect(
      withLoopback(async ({ endpoint, token }) =>
        verifyWorkbenchMcpTools(
          buildWorkbenchMcpDescriptor({
            command: process.execPath,
            entryPath: missingEntry,
            endpoint,
            token,
            schoolId: 'school-a',
            agentRunId: 'run-a',
          }),
        ),
      ),
    ).rejects.toThrowError(/did not answer a tool listing/u)
  }, 30_000)
})
