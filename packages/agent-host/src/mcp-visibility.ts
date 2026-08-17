import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AgentHostError, forbiddenAgentToolNames, workbenchToolNames } from './contracts'
import { descriptorEnvRecord, type WorkbenchMcpServerDescriptor } from './mcp-descriptor'

export type WorkbenchMcpVisibility = Readonly<{
  visibleTools: readonly string[]
  missingTools: readonly string[]
  forbiddenTools: readonly string[]
}>

/**
 * Runs the exact stdio descriptor the host is about to hand to the agent and
 * asks the server for its tool list.
 *
 * Why this exists: ACP gives a client no way to enumerate the tools an agent
 * ended up with, and codex-acp silently drops a requested MCP server whose name
 * collides with an existing Codex config layer. A run must not continue
 * quietly when the workbench tools are not really there, so the descriptor is
 * exercised for real — same command, same args, same environment — before it is
 * injected. This is the "contract test" leg of the SPEC 62 verdict.
 *
 * This is a real MCP client talking to the real workbench MCP server over real
 * stdio; nothing here is stubbed.
 */
export async function verifyWorkbenchMcpTools(
  descriptor: WorkbenchMcpServerDescriptor,
  options: Readonly<{ clientName?: string; clientVersion?: string }> = {},
): Promise<WorkbenchMcpVisibility> {
  const client = new Client({
    name: options.clientName ?? 'school-workbench-agent-host',
    version: options.clientVersion ?? '0.1.0',
  })
  const transport = new StdioClientTransport({
    command: descriptor.command,
    args: [...descriptor.args],
    env: { ...getDefaultEnvironment(), ...descriptorEnvRecord(descriptor) },
    stderr: 'pipe',
  })

  let visibleTools: string[]
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    visibleTools = listed.tools.map((tool) => tool.name)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench MCP server did not answer a tool listing: ${detail}`,
    )
  } finally {
    await client.close().catch(() => undefined)
  }

  const missingTools = workbenchToolNames.filter((name) => !visibleTools.includes(name))
  const forbiddenTools = forbiddenAgentToolNames.filter((name) => visibleTools.includes(name))

  if (missingTools.length > 0) {
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench MCP server did not expose: ${missingTools.join(', ')}`,
    )
  }
  if (forbiddenTools.length > 0) {
    // SPEC 25: the agent must not be able to confirm formal state. Finding one
    // of these on the surface is a hard stop, not a warning.
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench MCP server exposed forbidden tools: ${forbiddenTools.join(', ')}`,
    )
  }

  return Object.freeze({
    visibleTools: Object.freeze([...visibleTools].sort()),
    missingTools: Object.freeze([]),
    forbiddenTools: Object.freeze([]),
  })
}
