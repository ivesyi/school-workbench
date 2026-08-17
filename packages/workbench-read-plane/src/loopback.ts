import type { AssessmentProtocolError } from '@school-workbench/assessment'
import type { AddressInfo } from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  capabilityScope,
  isReadCapabilityName,
  isWriteCapabilityName,
  ReadPlaneError,
  type CapabilityName,
  type ReadCapabilityName,
  type WriteCapabilityName,
} from './contracts'
import { CapabilityAuthError, CapabilityTokenStore, type CapabilityTokenGrant } from './auth'
import type { WorkbenchReadCapabilityService } from './service'
import { WritePlaneProtocolError, type WorkbenchWriteCapabilityService } from './write-service'

export type ReadPlaneApiErrorCode =
  | CapabilityAuthError['code']
  | ReadPlaneError['code']
  | WritePlaneProtocolError['code']
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_NOT_AVAILABLE'

export type ReadPlaneApiErrorEnvelope = Readonly<{
  ok: false
  error: Readonly<{
    code: ReadPlaneApiErrorCode
    message: string
  }>
  /**
   * The assessment protocol's own findings, passed through unchanged so an
   * Agent can correct a specific field instead of guessing (decision L5).
   */
  errors?: readonly AssessmentProtocolError[]
}>

export type SafeReadPlaneLogEvent = Readonly<{
  level: 'warn' | 'error'
  capability: string
  code: string
}>

export type SafeReadPlaneLogger = (event: SafeReadPlaneLogEvent) => void

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function statusFor(error: CapabilityAuthError | ReadPlaneError | WritePlaneProtocolError): number {
  if (error instanceof CapabilityAuthError) {
    if (error.code === 'AUTH_SCOPE_DENIED' || error.code.endsWith('_MISMATCH')) return 403
    return 401
  }
  // A refused candidate is a well-formed request the domain declined, and the
  // Agent is expected to correct and resubmit it.
  if (error instanceof WritePlaneProtocolError) return 422
  if (error.code === 'INPUT_INVALID') return 400
  if (error.code === 'SCHOOL_NOT_FOUND') return 404
  if (error.code === 'READ_STALE' || error.code === 'STANDARDS_DRIFT') return 409
  return 500
}

function errorEnvelope(
  code: ReadPlaneApiErrorCode,
  message: string,
  errors?: readonly AssessmentProtocolError[],
): ReadPlaneApiErrorEnvelope {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message }),
    ...(errors ? { errors: Object.freeze([...errors]) } : {}),
  })
}

function hasQueryParameters(query: unknown): boolean {
  return query !== null && typeof query === 'object' && Object.keys(query).length > 0
}

async function dispatchWrite(
  service: WorkbenchWriteCapabilityService | undefined,
  capability: WriteCapabilityName,
  context: Readonly<{ schoolId: string; agentRunId: string }>,
  input: unknown,
): Promise<unknown> {
  if (!service) {
    // The write plane is optional so a workbench whose write side is not wired
    // refuses cleanly instead of half-answering.
    throw new ReadPlaneError('INTERNAL', 'The write plane is not available')
  }
  switch (capability) {
    case 'evidence_register':
      return service.evidenceRegister(context, input)
    case 'diagnosis_propose':
      return service.diagnosisPropose(context, input)
  }
}

async function dispatch(
  service: WorkbenchReadCapabilityService,
  capability: ReadCapabilityName,
  schoolId: string,
  input: unknown,
): Promise<unknown> {
  switch (capability) {
    case 'school_context':
      return service.schoolContext(schoolId, input)
    case 'stage_current':
      return service.stageCurrent(schoolId, input)
    case 'state_current':
      return service.stateCurrent(schoolId, input)
    case 'state_history':
      return service.stateHistory(schoolId, input)
    case 'evidence_list':
      return service.evidenceList(schoolId, input)
    case 'diagnosis_list':
      return service.diagnosisList(schoolId, input)
    case 'standards_get':
      return service.standardsGet(schoolId, input)
  }
}

export class WorkbenchLoopbackReadPlane {
  readonly #server: FastifyInstance
  #endpoint: string | null = null

  constructor(
    private readonly service: WorkbenchReadCapabilityService,
    readonly tokens: CapabilityTokenStore = new CapabilityTokenStore(),
    private readonly safeLog: SafeReadPlaneLogger = () => undefined,
    private readonly writeService?: WorkbenchWriteCapabilityService,
  ) {
    this.#server = Fastify({
      logger: false,
      bodyLimit: 32 * 1024,
    })

    this.#server.post('/internal/v1/:capability', async (request, reply) => {
      const capability = (request.params as { capability?: string }).capability ?? ''
      // SPEC 25's forbidden capabilities are not merely unimplemented: they are
      // not routable, and asking for one is indistinguishable from asking for a
      // capability that never existed.
      if (!isReadCapabilityName(capability) && !isWriteCapabilityName(capability)) {
        this.safeLog({ level: 'warn', capability, code: 'CAPABILITY_NOT_FOUND' })
        return reply
          .code(404)
          .send(errorEnvelope('CAPABILITY_NOT_FOUND', 'Workbench capability not found'))
      }

      const typedCapability: CapabilityName = capability
      try {
        const schoolId = firstHeader(request.headers['x-swb-school-id'])
        const agentRunId = firstHeader(request.headers['x-swb-agent-run-id'])
        if (!schoolId) {
          throw new CapabilityAuthError('AUTH_SCHOOL_MISMATCH', 'Scoped school header is required')
        }
        if (!agentRunId) {
          throw new CapabilityAuthError('AUTH_RUN_MISMATCH', 'Scoped agent run header is required')
        }
        this.tokens.authenticate(request.headers.authorization, capabilityScope[typedCapability], {
          schoolId,
          agentRunId,
        })
        if (hasQueryParameters(request.query)) {
          throw new ReadPlaneError(
            'INPUT_INVALID',
            'Query parameters are not accepted by the read plane',
          )
        }
        const data = isWriteCapabilityName(typedCapability)
          ? await dispatchWrite(
              this.writeService,
              typedCapability,
              { schoolId, agentRunId },
              request.body ?? {},
            )
          : await dispatch(this.service, typedCapability, schoolId, request.body ?? {})
        return reply.code(200).send({ ok: true, data })
      } catch (error) {
        if (error instanceof WritePlaneProtocolError) {
          this.safeLog({ level: 'warn', capability, code: error.code })
          return reply
            .code(statusFor(error))
            .send(errorEnvelope(error.code, error.message, error.errors))
        }
        if (error instanceof CapabilityAuthError || error instanceof ReadPlaneError) {
          this.safeLog({
            level: statusFor(error) >= 500 ? 'error' : 'warn',
            capability,
            code: error.code,
          })
          return reply.code(statusFor(error)).send(errorEnvelope(error.code, error.message))
        }
        this.safeLog({ level: 'error', capability, code: 'INTERNAL' })
        return reply.code(500).send(errorEnvelope('INTERNAL', 'Internal read-plane error'))
      }
    })
  }

  get endpoint(): string | null {
    return this.#endpoint
  }

  async start(): Promise<string> {
    if (this.#endpoint) return this.#endpoint
    await this.#server.listen({ host: '127.0.0.1', port: 0 })
    const address = this.#server.server.address()
    if (!address || typeof address === 'string') {
      await this.#server.close()
      throw new Error('Loopback read plane did not expose a TCP address')
    }
    const info = address as AddressInfo
    if (info.address !== '127.0.0.1') {
      await this.#server.close()
      throw new Error('Loopback read plane bound outside 127.0.0.1')
    }
    this.#endpoint = `http://127.0.0.1:${info.port}/internal/v1`
    return this.#endpoint
  }

  async stop(): Promise<void> {
    if (!this.#endpoint) return
    this.#endpoint = null
    await this.#server.close()
  }

  issueToken(
    input: Readonly<{
      schoolId: string
      agentRunId: string
      scopes: readonly string[]
      ttlMs?: number
    }>,
  ): CapabilityTokenGrant {
    return this.tokens.issue(input)
  }

  revokeToken(token: string): boolean {
    return this.tokens.revoke(token)
  }
}

export function createWorkbenchReadPlaneBootstrap(
  service: WorkbenchReadCapabilityService,
  options: Readonly<{
    tokenStore?: CapabilityTokenStore
    safeLog?: SafeReadPlaneLogger
    writeService?: WorkbenchWriteCapabilityService
  }> = {},
): WorkbenchLoopbackReadPlane {
  return new WorkbenchLoopbackReadPlane(
    service,
    options.tokenStore,
    options.safeLog,
    options.writeService,
  )
}
