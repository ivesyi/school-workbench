import type { RuntimeCompatibility } from './contracts'

export type ContractTestOutcome = 'passed' | 'failed' | 'skipped'

export type RuntimeCompatibilityAssessment = Readonly<{
  compatibility: RuntimeCompatibility
  protocolVersion: number | null
  agentName: string | null
  agentVersion: string | null
  missingCapabilities: readonly string[]
  contractTest: ContractTestOutcome
  detail: string
}>

export type RuntimeCompatibilityInput = Readonly<{
  /** Protocol version the host asked for. */
  requestedProtocolVersion: number
  /** Raw `initialize` response, read tolerantly. */
  initializeResponse: unknown
  /**
   * Outcome of the workbench contract test — currently "the workbench MCP
   * server the host is about to inject really exposes the frozen read tools".
   */
  contractTest: ContractTestOutcome
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Capabilities the workbench genuinely needs from an ACP agent.
 *
 * ACP makes `session/new`, `session/prompt`, `session/cancel` and
 * `session/update` mandatory for every agent, and stdio MCP servers are the
 * baseline transport (`McpCapabilities` only carries opt-in flags for http, sse
 * and the experimental acp transport). So the only thing that can be *missing*
 * at the capability layer is an agent that explicitly disclaims MCP support —
 * SPEC 8 has no compatibility mode for that.
 */
function collectMissingCapabilities(initializeResponse: unknown): string[] {
  const missing: string[] = []
  if (!isRecord(initializeResponse)) return ['initialize.response']

  const capabilities = initializeResponse['agentCapabilities']
  if (capabilities !== undefined && capabilities !== null && !isRecord(capabilities)) {
    missing.push('agentCapabilities')
    return missing
  }

  const mcp = isRecord(capabilities) ? capabilities['mcp'] : undefined
  if (mcp === false) missing.push('agentCapabilities.mcp')

  return missing
}

/**
 * SPEC 62. The three-state verdict is derived from what the runtime actually
 * answered, never from a version string.
 *
 * - `unsupported` — the ACP handshake did not produce a usable connection, or a
 *   required capability is missing, or the contract test ran and failed.
 * - `compatible`  — handshake and capabilities are fine but no contract test
 *   was executed for this connection.
 * - `verified`    — handshake, capabilities and contract test all passed.
 */
export function assessRuntimeCompatibility(
  input: RuntimeCompatibilityInput,
): RuntimeCompatibilityAssessment {
  const response = isRecord(input.initializeResponse) ? input.initializeResponse : null
  const rawVersion = response?.['protocolVersion']
  const protocolVersion =
    typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : null
  const agentInfo = isRecord(response?.['agentInfo']) ? response['agentInfo'] : null
  const agentName = agentInfo ? readString(agentInfo['name']) : null
  const agentVersion = agentInfo ? readString(agentInfo['version']) : null
  const missingCapabilities = Object.freeze(collectMissingCapabilities(input.initializeResponse))

  const base = { protocolVersion, agentName, agentVersion, missingCapabilities } as const

  if (protocolVersion === null) {
    return Object.freeze({
      ...base,
      compatibility: 'unsupported' as RuntimeCompatibility,
      contractTest: input.contractTest,
      detail: 'The runtime did not answer ACP initialize with a protocol version.',
    })
  }

  if (protocolVersion !== input.requestedProtocolVersion) {
    return Object.freeze({
      ...base,
      compatibility: 'unsupported' as RuntimeCompatibility,
      contractTest: input.contractTest,
      detail: `The runtime negotiated ACP protocol version ${protocolVersion}, which this workbench does not speak.`,
    })
  }

  if (missingCapabilities.length > 0) {
    return Object.freeze({
      ...base,
      compatibility: 'unsupported' as RuntimeCompatibility,
      contractTest: input.contractTest,
      detail: `The runtime is missing required capabilities: ${missingCapabilities.join(', ')}.`,
    })
  }

  if (input.contractTest === 'failed') {
    return Object.freeze({
      ...base,
      compatibility: 'unsupported' as RuntimeCompatibility,
      contractTest: input.contractTest,
      detail: 'The workbench contract test failed against this runtime.',
    })
  }

  if (input.contractTest === 'skipped') {
    return Object.freeze({
      ...base,
      compatibility: 'compatible' as RuntimeCompatibility,
      contractTest: input.contractTest,
      detail: 'ACP handshake and required capabilities are satisfied; no contract test was run.',
    })
  }

  return Object.freeze({
    ...base,
    compatibility: 'verified' as RuntimeCompatibility,
    contractTest: input.contractTest,
    detail: 'ACP handshake, required capabilities and the workbench contract test all passed.',
  })
}
