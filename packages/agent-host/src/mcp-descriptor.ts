import { isAbsolute } from 'node:path'
import { AgentHostError } from './contracts'

/**
 * Name of the workbench MCP server as it is announced to the agent runtime.
 *
 * codex-acp 1.4.0 filters requested MCP servers whose (whitespace-sanitised)
 * name already exists in any Codex config layer, unless
 * `DISABLE_MCP_CONFIG_FILTERING=true` — see `shouldDeduplicateMcpConflicts()`
 * in its bundle. A filtered server is dropped silently: the agent simply never
 * sees the tools. Disabling the filter is not an option, because that makes
 * Codex deep-merge two unrelated server definitions under the same key.
 *
 * The defence is therefore the name itself. It is long, product-namespaced,
 * carries an arbitrary fixed suffix, and contains no whitespace (so
 * `sanitizeMcpServerName()` passes it through unchanged). A consultant's own
 * `~/.codex/config.toml` will not contain this key by accident.
 */
export const workbenchMcpServerName = 'school-workbench-internal-read-plane-3f9a1c'

export type EnvVariable = Readonly<{ name: string; value: string }>

/** Shape of ACP `McpServerStdio`, restated so the builder has no ACP import. */
export type WorkbenchMcpServerDescriptor = Readonly<{
  name: string
  command: string
  args: readonly string[]
  env: readonly EnvVariable[]
}>

export type WorkbenchMcpDescriptorInput = Readonly<{
  /** Absolute path to the executable that runs the bundled MCP server. */
  command: string
  /** Absolute path to the bundled `stdio.js` entry point. */
  entryPath: string
  endpoint: string
  token: string
  schoolId: string
  agentRunId: string
  /**
   * Extra environment entries. Used to pass `ELECTRON_RUN_AS_NODE=1` when the
   * command is the Electron binary rather than a plain Node binary.
   */
  extraEnv?: readonly EnvVariable[]
}>

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/u
const CONTROL_CHARACTERS = /[\r\n\0]/u

function invalid(message: string): never {
  throw new AgentHostError('MCP_DESCRIPTOR_INVALID', message)
}

function requireAbsolute(value: string, field: string): string {
  if (!value || CONTROL_CHARACTERS.test(value)) invalid(`${field} is missing or malformed`)
  if (!isAbsolute(value)) invalid(`${field} must be an absolute path`)
  return value
}

function requireBoundedIdentity(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 160 || CONTROL_CHARACTERS.test(trimmed)) {
    invalid(`${field} must be a bounded opaque identity`)
  }
  return trimmed
}

/**
 * Re-checks the endpoint against the exact rule the MCP server itself enforces
 * in `packages/workbench-mcp/src/stdio.ts`. Failing here surfaces a descriptor
 * bug in the host instead of a silent `ENV_INVALID` exit inside a subprocess
 * that Codex owns.
 */
function requireLoopbackEndpoint(value: string): string {
  if (!value || CONTROL_CHARACTERS.test(value)) invalid('SWB_ENDPOINT is missing or malformed')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalid('SWB_ENDPOINT is malformed')
  }
  const port = Number(url.port)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/internal/v1' && url.pathname !== '/internal/v1/')
  ) {
    invalid('SWB_ENDPOINT must be a scoped loopback endpoint')
  }
  return `http://127.0.0.1:${port}/internal/v1`
}

function requireToken(value: string): string {
  if (!TOKEN_PATTERN.test(value)) invalid('SWB_TOKEN is malformed')
  return value
}

/**
 * Builds the single stdio MCP server descriptor injected through ACP
 * `session/new`. SPEC 14 fixes the transport at stdio and SPEC 16 fixes the
 * four bootstrap variables.
 */
export function buildWorkbenchMcpDescriptor(
  input: WorkbenchMcpDescriptorInput,
): WorkbenchMcpServerDescriptor {
  const command = requireAbsolute(input.command, 'MCP command')
  const entryPath = requireAbsolute(input.entryPath, 'MCP entry path')
  const endpoint = requireLoopbackEndpoint(input.endpoint)
  const token = requireToken(input.token)
  const schoolId = requireBoundedIdentity(input.schoolId, 'SWB_SCHOOL_ID')
  const agentRunId = requireBoundedIdentity(input.agentRunId, 'SWB_AGENT_RUN_ID')

  const env: EnvVariable[] = [
    ...(input.extraEnv ?? []).map((entry) => Object.freeze({ ...entry })),
    Object.freeze({ name: 'SWB_ENDPOINT', value: endpoint }),
    Object.freeze({ name: 'SWB_TOKEN', value: token }),
    Object.freeze({ name: 'SWB_SCHOOL_ID', value: schoolId }),
    Object.freeze({ name: 'SWB_AGENT_RUN_ID', value: agentRunId }),
  ]

  return Object.freeze({
    name: workbenchMcpServerName,
    command,
    args: Object.freeze([entryPath]),
    env: Object.freeze(env),
  })
}

/** Flattens a descriptor's env list into the record form used to spawn a probe. */
export function descriptorEnvRecord(
  descriptor: WorkbenchMcpServerDescriptor,
): Record<string, string> {
  const record: Record<string, string> = {}
  for (const entry of descriptor.env) record[entry.name] = entry.value
  return record
}
