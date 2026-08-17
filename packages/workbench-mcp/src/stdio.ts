import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  diagnosisListInputSchema,
  evidenceListInputSchema,
  forbiddenCapabilityNames,
  readCapabilityNames,
  schoolContextInputSchema,
  stageCurrentInputSchema,
  standardsGetInputSchema,
  stateCurrentInputSchema,
  stateHistoryInputSchema,
  writeCapabilityNames,
  type CapabilityName,
  type ReadCapabilityName,
  type WriteCapabilityName,
} from '@school-workbench/workbench-read-plane/contracts'
import {
  diagnosisProposeInputSchema,
  evidenceRegisterInputSchema,
} from '@school-workbench/workbench-read-plane/write-contracts'

const ENV_KEYS = ['SWB_ENDPOINT', 'SWB_TOKEN', 'SWB_SCHOOL_ID', 'SWB_AGENT_RUN_ID'] as const

const TOOL_DESCRIPTIONS: Readonly<Record<ReadCapabilityName, string>> = Object.freeze({
  school_context:
    'Read the scoped school context, active stage summary, current state summary, and recent accepted judgments.',
  stage_current:
    'Read the scoped school current active stage and its confirmed five-dimensional targets.',
  state_current: 'Read the scoped school latest immutable formal state and judgment provenance.',
  state_history: 'Read a bounded page of the scoped school formal state history.',
  evidence_list:
    'Read a bounded page of scoped Evidence metadata and provenance without raw content.',
  diagnosis_list:
    'Read a bounded page of immutable DiagnosisProposal metadata and provenance refs.',
  standards_get:
    'Read a bounded, filtered projection of an exactly matched active methodology pack.',
})

const WRITE_TOOL_DESCRIPTIONS: Readonly<Record<WriteCapabilityName, string>> = Object.freeze({
  evidence_register:
    'Record a piece of material you actually used, the observations you read off it, and the claims those observations support or contradict. Returns the identifiers to cite later. Registering the same material again returns the identifiers it already has.',
  diagnosis_propose:
    'Submit one structured professional judgement for the consultant to review. Cite only identifiers returned by evidence_register or read from this workbench. Rejections come back as a list of specific findings you can correct and resubmit.',
})

/**
 * SPEC 25. These are never registered. The list is stated rather than implied so
 * a contract test fails the moment one of them appears on the tool surface.
 */
const FORBIDDEN_TOOL_NAMES: readonly string[] = forbiddenCapabilityNames

const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
})

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})

type BootstrapConfig = Readonly<{
  endpoint: string
  token: string
  schoolId: string
  agentRunId: string
}>

class McpBootstrapError extends Error {
  readonly code = 'ENV_INVALID' as const
}

class LocalApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /**
     * The assessment protocol's own findings. Decision L5 keeps them intact all
     * the way to the Agent, because they are what makes a refusal correctable.
     */
    readonly details?: readonly unknown[],
  ) {
    super(message)
    this.name = 'LocalApiError'
  }
}

function boundedOpaqueEnv(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed.length > 512 || /[\r\n\0]/u.test(trimmed)) {
    throw new McpBootstrapError(`${field} is missing or malformed`)
  }
  return trimmed
}

function parseEndpoint(value: string | undefined): string {
  const raw = boundedOpaqueEnv(value, 'SWB_ENDPOINT')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new McpBootstrapError('SWB_ENDPOINT is malformed')
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
    throw new McpBootstrapError('SWB_ENDPOINT must be a scoped loopback endpoint')
  }
  return `http://127.0.0.1:${port}/internal/v1`
}

function readBootstrapConfig(): BootstrapConfig {
  const endpoint = parseEndpoint(process.env[ENV_KEYS[0]])
  const token = boundedOpaqueEnv(process.env[ENV_KEYS[1]], 'SWB_TOKEN')
  if (!/^[A-Za-z0-9_-]{32,512}$/u.test(token)) {
    throw new McpBootstrapError('SWB_TOKEN is malformed')
  }
  const schoolId = boundedOpaqueEnv(process.env[ENV_KEYS[2]], 'SWB_SCHOOL_ID')
  const agentRunId = boundedOpaqueEnv(process.env[ENV_KEYS[3]], 'SWB_AGENT_RUN_ID')
  if (schoolId.length > 160 || agentRunId.length > 160) {
    throw new McpBootstrapError('Scoped identities are malformed')
  }
  return Object.freeze({ endpoint, token, schoolId, agentRunId })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseApiEnvelope(value: unknown): unknown {
  if (!isObject(value) || typeof value.ok !== 'boolean') {
    throw new LocalApiError(
      'LOCAL_API_PROTOCOL_ERROR',
      'Internal Local API returned an invalid envelope',
    )
  }
  if (value.ok === true) {
    if (!Object.hasOwn(value, 'data')) {
      throw new LocalApiError(
        'LOCAL_API_PROTOCOL_ERROR',
        'Internal Local API response is missing data',
      )
    }
    return value.data
  }
  const error = value.error
  if (
    !isObject(error) ||
    typeof error.code !== 'string' ||
    !error.code ||
    typeof error.message !== 'string' ||
    !error.message
  ) {
    throw new LocalApiError(
      'LOCAL_API_PROTOCOL_ERROR',
      'Internal Local API returned an invalid error',
    )
  }
  const details = Array.isArray(value.errors) ? (value.errors as readonly unknown[]) : undefined
  throw new LocalApiError(error.code, error.message, details)
}

async function callLocalApi(
  config: BootstrapConfig,
  capability: CapabilityName,
  input: unknown,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${config.endpoint}/${capability}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-swb-school-id': config.schoolId,
        'x-swb-agent-run-id': config.agentRunId,
      },
      body: JSON.stringify(input ?? {}),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new LocalApiError('LOCAL_API_UNAVAILABLE', 'Internal Local API is unavailable')
  }

  let body: unknown
  try {
    body = (await response.json()) as unknown
  } catch {
    throw new LocalApiError('LOCAL_API_PROTOCOL_ERROR', 'Internal Local API returned non-JSON data')
  }
  return parseApiEnvelope(body)
}

function successResult(data: unknown) {
  const structuredContent = isObject(data) ? data : { value: data }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function errorResult(error: unknown) {
  const code = error instanceof LocalApiError ? error.code : 'MCP_INTERNAL'
  const message = error instanceof LocalApiError ? error.message : 'Workbench MCP call failed'
  const details = error instanceof LocalApiError ? error.details : undefined
  const payload = details ? { code, message, errors: details } : { code, message }
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function createServer(config: BootstrapConfig): McpServer {
  const server = new McpServer({ name: 'school-workbench-read-plane', version: '0.1.0' })
  const handler = (capability: CapabilityName) => async (input: unknown) => {
    try {
      return successResult(await callLocalApi(config, capability, input))
    } catch (error) {
      return errorResult(error)
    }
  }

  server.registerTool(
    'school_context',
    {
      description: TOOL_DESCRIPTIONS.school_context,
      inputSchema: schoolContextInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('school_context'),
  )
  server.registerTool(
    'stage_current',
    {
      description: TOOL_DESCRIPTIONS.stage_current,
      inputSchema: stageCurrentInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('stage_current'),
  )
  server.registerTool(
    'state_current',
    {
      description: TOOL_DESCRIPTIONS.state_current,
      inputSchema: stateCurrentInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('state_current'),
  )
  server.registerTool(
    'state_history',
    {
      description: TOOL_DESCRIPTIONS.state_history,
      inputSchema: stateHistoryInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('state_history'),
  )
  server.registerTool(
    'evidence_list',
    {
      description: TOOL_DESCRIPTIONS.evidence_list,
      inputSchema: evidenceListInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('evidence_list'),
  )
  server.registerTool(
    'diagnosis_list',
    {
      description: TOOL_DESCRIPTIONS.diagnosis_list,
      inputSchema: diagnosisListInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('diagnosis_list'),
  )
  server.registerTool(
    'standards_get',
    {
      description: TOOL_DESCRIPTIONS.standards_get,
      inputSchema: standardsGetInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    handler('standards_get'),
  )
  server.registerTool(
    'evidence_register',
    {
      description: WRITE_TOOL_DESCRIPTIONS.evidence_register,
      inputSchema: evidenceRegisterInputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    handler('evidence_register'),
  )
  server.registerTool(
    'diagnosis_propose',
    {
      description: WRITE_TOOL_DESCRIPTIONS.diagnosis_propose,
      inputSchema: diagnosisProposeInputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    handler('diagnosis_propose'),
  )

  return server
}

function failBeforeServing(): void {
  process.stderr.write('workbench-mcp bootstrap failed: ENV_INVALID\n')
  process.exitCode = 1
}

let config: BootstrapConfig
try {
  config = readBootstrapConfig()
} catch {
  failBeforeServing()
  config = null as never
}

if (process.exitCode !== 1) {
  const handle = serveStdio(() => createServer(config))
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    void handle.close().catch(() => {
      process.exitCode = 1
    })
  }

  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  process.stdin.once('end', close)
}

export {
  createServer,
  readBootstrapConfig,
  readCapabilityNames,
  writeCapabilityNames,
  FORBIDDEN_TOOL_NAMES,
}
