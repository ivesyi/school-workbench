import {
  diagnosisListInputSchema,
  evidenceListInputSchema,
  schoolContextInputSchema,
  stageCurrentInputSchema,
  standardsGetInputSchema,
  stateCurrentInputSchema,
  stateHistoryInputSchema,
} from '@school-workbench/workbench-read-plane/contracts'
import {
  diagnosisProposeInputSchema,
  evidenceRegisterInputSchema,
  stageProposeInputSchema,
} from '@school-workbench/workbench-read-plane/write-contracts'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { TSchema } from '@earendil-works/pi-ai'
import { z } from 'zod'
import {
  AgentHostError,
  forbiddenAgentToolNames,
  workbenchToolNames,
  type WorkbenchToolName,
} from '../contracts'
import type { HarnessCapabilityGrant } from '../harness/contracts'

/**
 * The workbench capability surface, as tools an in-process harness can call.
 *
 * This is the same surface `packages/workbench-mcp` serves to Codex, reached a
 * different way. The important word is *same*: an in-process driver could have
 * been given a repository handle and a much shorter path to the data, and that
 * would have quietly created a second route into the domain with none of the
 * governance on it. It is not given one. Every call below leaves through the
 * same loopback HTTP endpoint, carrying the same capability token, the same
 * scoped school and run headers, and lands in the same Fastify route that
 * authenticates the token, checks the scope for the capability, and validates
 * the input against the very schemas imported above.
 *
 * So all four guarantees survive unchanged:
 *
 *  - **Scope.** `capabilityScope` maps each capability to one scope, and the
 *    token carries the scopes the composition root granted. A tool whose scope
 *    is not in the grant is refused at the loopback with `AUTH_SCOPE_DENIED`.
 *  - **School isolation.** The school comes from the token, not from the model.
 *    A `schoolId` argument that disagrees with the scoped school is rejected.
 *  - **SPEC 25.** The four forbidden capabilities have no route and no scope.
 *    `assertWorkbenchToolContract` additionally refuses to hand the model a
 *    tool set that contains one, so a future edit cannot add one here quietly.
 *  - **Correctable refusals (decision L5).** The assessment protocol's own
 *    `errors[]` come back through this bridge byte for byte, because they are
 *    what lets an assistant fix a specific field and resubmit.
 *
 * The tool *parameters* are compiled from the same Zod contracts the loopback
 * validates against, so the schema the model is shown and the schema the
 * workbench enforces cannot drift apart. The harness validates arguments
 * against that compiled copy before calling `execute`, but it is only ever a
 * pre-filter: the loopback stays the authority, and a payload the pre-filter
 * happened to let through is refused there exactly as it would be for Codex.
 */

/** Human labels. Never shown to a consultant; the harness wants one per tool. */
const TOOL_LABELS: Readonly<Record<WorkbenchToolName, string>> = Object.freeze({
  school_context: '读取学校情况',
  stage_current: '读取当前阶段',
  state_current: '读取正式状态',
  state_history: '读取状态历史',
  evidence_list: '列出已登记依据',
  diagnosis_list: '列出既往判断',
  standards_get: '读取方法论准则',
  evidence_register: '登记依据',
  diagnosis_propose: '提交判断',
  stage_propose: '提议起始阶段',
})

/**
 * Tool descriptions, word for word as `packages/workbench-mcp/src/stdio.ts`
 * serves them.
 *
 * Restated rather than imported because that module is a process entry point
 * whose import would start an MCP server. `workbench-tool-parity.test.ts` runs
 * the real server and compares every name, description and parameter schema
 * against this file, so the copy cannot drift without a test failing. Moving
 * the descriptions down into `workbench-read-plane/contracts` and deleting this
 * table is the tidier end state and is recorded as follow-up work.
 */
const TOOL_DESCRIPTIONS: Readonly<Record<WorkbenchToolName, string>> = Object.freeze({
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
  evidence_register:
    'Record a piece of material you actually used, the observations you read off it, and the claims those observations support or contradict. Returns the identifiers to cite later. Registering the same material again returns the identifiers it already has.',
  diagnosis_propose:
    'Submit one structured professional judgement for the consultant to review. Cite only identifiers returned by evidence_register or read from this workbench. Rejections come back as a list of specific findings you can correct and resubmit.',
  stage_propose:
    'When the school has no current stage yet, propose the starting stage for the consultant to confirm: a short title, a summary, a focus, and one goal per the five dimensions (leadership, key_tasks, structure, culture, capability). Only ever propose when stage_current reports no stage; the consultant confirms it in the workbench.',
})

const TOOL_INPUT_SCHEMAS: Readonly<Record<WorkbenchToolName, z.ZodType>> = Object.freeze({
  school_context: schoolContextInputSchema,
  stage_current: stageCurrentInputSchema,
  state_current: stateCurrentInputSchema,
  state_history: stateHistoryInputSchema,
  evidence_list: evidenceListInputSchema,
  diagnosis_list: diagnosisListInputSchema,
  standards_get: standardsGetInputSchema,
  evidence_register: evidenceRegisterInputSchema,
  diagnosis_propose: diagnosisProposeInputSchema,
  stage_propose: stageProposeInputSchema,
})

/**
 * The same 5 second bound `packages/workbench-mcp` puts on a loopback call, so
 * a wedged read plane surfaces as one failed tool call rather than a run that
 * never ends.
 */
const LOOPBACK_TIMEOUT_MS = 5_000

export function workbenchToolParameters(tool: WorkbenchToolName): Record<string, unknown> {
  // `io: 'input'` matters: several contracts carry `.default([])`, and the
  // model is being shown what it may *send*, not what the workbench ends up
  // holding.
  return z.toJSONSchema(TOOL_INPUT_SCHEMAS[tool], { io: 'input' }) as Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Rejects the whole response envelope unless it is the shape the read plane
 * promises. A malformed envelope is a workbench bug, and the assistant is told
 * so plainly instead of being handed half a payload.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (!isObject(body) || typeof body['ok'] !== 'boolean') {
    throw new WorkbenchToolCallError(
      'LOCAL_API_PROTOCOL_ERROR',
      'Internal Local API returned an invalid envelope',
    )
  }
  if (body['ok'] === true) {
    if (!Object.hasOwn(body, 'data')) {
      throw new WorkbenchToolCallError(
        'LOCAL_API_PROTOCOL_ERROR',
        'Internal Local API response is missing data',
      )
    }
    return body['data']
  }
  const error = body['error']
  if (
    !isObject(error) ||
    typeof error['code'] !== 'string' ||
    !error['code'] ||
    typeof error['message'] !== 'string' ||
    !error['message']
  ) {
    throw new WorkbenchToolCallError(
      'LOCAL_API_PROTOCOL_ERROR',
      'Internal Local API returned an invalid error',
    )
  }
  throw new WorkbenchToolCallError(
    error['code'],
    error['message'],
    Array.isArray(body['errors']) ? (body['errors'] as readonly unknown[]) : undefined,
  )
}

/**
 * A refused workbench call.
 *
 * Its `message` is the JSON payload the MCP surface returns for the same
 * refusal, because the harness turns a thrown error's message into the tool
 * result the model reads. Keeping the payload identical is what makes an
 * assessment refusal equally correctable on both assistants (decision L5).
 */
export class WorkbenchToolCallError extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
    readonly errors?: readonly unknown[],
  ) {
    super(JSON.stringify(errors ? { code, message: reason, errors } : { code, message: reason }))
    this.name = 'WorkbenchToolCallError'
  }
}

export type WorkbenchToolCaller = (
  tool: WorkbenchToolName,
  input: unknown,
  signal?: AbortSignal,
) => Promise<unknown>

/**
 * Calls one workbench capability over the scoped loopback endpoint.
 *
 * Deliberately the same request the bundled MCP server makes: same URL shape,
 * same bearer token, same two scoping headers, same 5 second bound. The read
 * plane cannot tell the two assistants apart, which is the point — its audit
 * and authorisation behaviour is not asked to grow a special case.
 */
export function createLoopbackToolCaller(grant: HarnessCapabilityGrant): WorkbenchToolCaller {
  return async (tool, input, signal) => {
    let response: Response
    try {
      response = await fetch(`${grant.endpoint}/${tool}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${grant.token}`,
          'content-type': 'application/json',
          'x-swb-school-id': grant.schoolId,
          'x-swb-agent-run-id': grant.agentRunId,
        },
        body: JSON.stringify(input ?? {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(LOOPBACK_TIMEOUT_MS)])
          : AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
      })
    } catch {
      throw new WorkbenchToolCallError('LOCAL_API_UNAVAILABLE', 'Internal Local API is unavailable')
    }

    let body: unknown
    try {
      body = (await response.json()) as unknown
    } catch {
      throw new WorkbenchToolCallError(
        'LOCAL_API_PROTOCOL_ERROR',
        'Internal Local API returned non-JSON data',
      )
    }
    return unwrapEnvelope(body)
  }
}

/**
 * Holds the tool set to the frozen contract before the model ever sees it.
 *
 * `workbenchToolNames` and `forbiddenAgentToolNames` are the same two lists the
 * MCP visibility check uses, so both assistants fail for the same reason when
 * the surface is wrong. This runs at assembly time, which makes a broken tool
 * set a refused run rather than a run that quietly offered the model less — or
 * more — than SPEC 18 allows.
 */
export function assertWorkbenchToolContract(tools: readonly AgentTool[]): void {
  const names = tools.map((tool) => tool.name)
  const missing = workbenchToolNames.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench tool set is missing: ${missing.join(', ')}`,
    )
  }
  const forbidden = forbiddenAgentToolNames.filter((name) => names.includes(name))
  if (forbidden.length > 0) {
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench tool set exposed forbidden tools: ${forbidden.join(', ')}`,
    )
  }
  const unknown = names.filter((name) => !(workbenchToolNames as readonly string[]).includes(name))
  if (unknown.length > 0) {
    // Not pedantry: the progress line, the permission story and the SPEC 18
    // freeze all assume this set and nothing else.
    throw new AgentHostError(
      'WORKBENCH_MCP_TOOLS_INVISIBLE',
      `The workbench tool set offered tools outside SPEC 18: ${unknown.join(', ')}`,
    )
  }
}

export type WorkbenchAgentToolsOptions = Readonly<{
  /** Test seam. Production always talks to the real loopback read plane. */
  call?: WorkbenchToolCaller
}>

/**
 * Builds the ten workbench tools for one Agent Run.
 *
 * Bound to a single grant on purpose: a tool cannot be reused across runs or
 * schools, because the scoping it carries came from the grant it was built
 * with.
 */
export function createWorkbenchAgentTools(
  grant: HarnessCapabilityGrant,
  options: WorkbenchAgentToolsOptions = {},
): readonly AgentTool[] {
  const call = options.call ?? createLoopbackToolCaller(grant)

  const tools = workbenchToolNames.map((tool): AgentTool => {
    return {
      name: tool,
      label: TOOL_LABELS[tool],
      description: TOOL_DESCRIPTIONS[tool],
      parameters: workbenchToolParameters(tool) as unknown as TSchema,
      async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
        // A throw is how this harness reports a failed tool call, and the
        // message becomes what the model reads. `WorkbenchToolCallError`
        // already carries the MCP payload as its message, so a refusal arrives
        // in the exact form the other assistant sees.
        const data = await call(tool, params, signal)
        const structured = isObject(data) ? data : { value: data }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
          details: structured,
        }
      },
    }
  })

  assertWorkbenchToolContract(tools)
  return Object.freeze(tools)
}
