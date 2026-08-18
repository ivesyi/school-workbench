import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workbenchToolNames } from '../contracts'
import { createWorkbenchAgentTools } from './workbench-tools'

/**
 * The two assistants must be offered the same capability surface.
 *
 * Codex reads its tools from `packages/workbench-mcp`; the built-in assistant
 * reads them from `workbench-tools.ts`. Two hand-written descriptions of one
 * frozen contract (SPEC 18) is exactly the arrangement that drifts, and a drift
 * here would be invisible: both assistants would keep working, on different
 * instructions, and only the judgements would differ.
 *
 * So this runs the real MCP server as a real subprocess, asks it for its real
 * tool list, and compares every name, description and parameter schema against
 * what the in-process tool set hands the model. No stub on either side.
 */

let bundleDirectory = ''
let serverBundle = ''

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'workbench-tool-parity-'))
  serverBundle = join(bundleDirectory, 'stdio.mjs')
  await build({
    entryPoints: [resolve('packages/workbench-mcp/src/stdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: serverBundle,
    logLevel: 'silent',
  })
}, 60_000)

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true })
})

type ListedTool = Readonly<{
  name: string
  description?: string
  inputSchema?: unknown
}>

async function listMcpTools(): Promise<readonly ListedTool[]> {
  const client = new Client({ name: 'workbench-tool-parity', version: '0.1.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverBundle],
    env: {
      ...getDefaultEnvironment(),
      // The server only needs a well-formed bootstrap to start and list its
      // tools; listing never reaches the read plane, so nothing has to be
      // listening on this port.
      SWB_ENDPOINT: 'http://127.0.0.1:1/internal/v1',
      SWB_TOKEN: 'a'.repeat(43),
      SWB_SCHOOL_ID: 'school-parity',
      SWB_AGENT_RUN_ID: 'run-parity',
    },
    stderr: 'pipe',
  })
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    return listed.tools as readonly ListedTool[]
  } finally {
    await client.close().catch(() => undefined)
  }
}

/**
 * Strips the one difference that is pure packaging rather than contract: the
 * MCP server and this package compile the same Zod schema through the same
 * `z.toJSONSchema`, but the two surfaces need not agree on whether to carry the
 * `$schema` dialect marker to the model.
 */
function comparableSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const rest = { ...(schema as Record<string, unknown>) }
  delete rest['$schema']
  return rest
}

describe('workbench tool surface parity between the two assistants', () => {
  it('offers the same tool names, descriptions and parameter schemas', async () => {
    const listed = await listMcpTools()
    const inProcess = createWorkbenchAgentTools({
      endpoint: 'http://127.0.0.1:1/internal/v1',
      token: 'a'.repeat(43),
      schoolId: 'school-parity',
      agentRunId: 'run-parity',
    })

    expect([...listed.map((tool) => tool.name)].sort()).toEqual([...workbenchToolNames].sort())
    expect([...inProcess.map((tool) => tool.name)].sort()).toEqual([...workbenchToolNames].sort())

    for (const name of workbenchToolNames) {
      const served = listed.find((tool) => tool.name === name)
      const built = inProcess.find((tool) => tool.name === name)
      expect(served, name).toBeDefined()
      expect(built, name).toBeDefined()
      expect(built!.description, `${name} description`).toBe(served!.description)
      expect(comparableSchema(built!.parameters), `${name} parameters`).toEqual(
        comparableSchema(served!.inputSchema),
      )
    }
  }, 60_000)
})
