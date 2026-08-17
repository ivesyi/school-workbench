import type { AddressInfo } from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  capabilityScope,
  readCapabilityNames,
  ReadPlaneError,
  type ReadCapabilityName,
} from './contracts'
import { CapabilityAuthError, CapabilityTokenStore, type CapabilityTokenGrant } from './auth'
import type { WorkbenchReadCapabilityService } from './service'

export type ReadPlaneApiErrorCode =
  CapabilityAuthError['code'] | ReadPlaneError['code'] | 'CAPABILITY_NOT_FOUND'

export type ReadPlaneApiErrorEnvelope = Readonly<{
  ok: false
  error: Readonly<{
    code: ReadPlaneApiErrorCode
    message: string
  }>
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

function statusFor(error: CapabilityAuthError | ReadPlaneError): number {
  if (error instanceof CapabilityAuthError) {
    if (error.code === 'AUTH_SCOPE_DENIED' || error.code.endsWith('_MISMATCH')) return 403
    return 401
  }
  if (error.code === 'INPUT_INVALID') return 400
  if (error.code === 'SCHOOL_NOT_FOUND') return 404
  if (error.code === 'READ_STALE' || error.code === 'STANDARDS_DRIFT') return 409
  return 500
}

function errorEnvelope(code: ReadPlaneApiErrorCode, message: string): ReadPlaneApiErrorEnvelope {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
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
  ) {
    this.#server = Fastify({
      logger: false,
      bodyLimit: 32 * 1024,
      disableRequestLogging: true,
    })

    this.#server.post('/internal/v1/:capability', async (request, reply) => {
      const capability = (request.params as { capability?: string }).capability ?? ''
      if (!readCapabilityNames.includes(capability as ReadCapabilityName)) {
        this.safeLog({ level: 'warn', capability, code: 'CAPABILITY_NOT_FOUND' })
        return reply
          .code(404)
          .send(errorEnvelope('CAPABILITY_NOT_FOUND', 'Read capability not found'))
      }

      const typedCapability = capability as ReadCapabilityName
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
        const data = await dispatch(this.service, typedCapability, schoolId, request.body ?? {})
        return reply.code(200).send({ ok: true, data })
      } catch (error) {
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
  }> = {},
): WorkbenchLoopbackReadPlane {
  return new WorkbenchLoopbackReadPlane(service, options.tokenStore, options.safeLog)
}
