import { createHash, randomBytes } from 'node:crypto'
import { readScopes, type ReadScope } from './contracts'

export const capabilityAuthErrorCodes = [
  'AUTH_MISSING',
  'AUTH_UNKNOWN',
  'AUTH_EXPIRED',
  'AUTH_REVOKED',
  'AUTH_SCOPE_DENIED',
  'AUTH_RUN_MISMATCH',
  'AUTH_SCHOOL_MISMATCH',
] as const

export type CapabilityAuthErrorCode = (typeof capabilityAuthErrorCodes)[number]

export class CapabilityAuthError extends Error {
  constructor(
    readonly code: CapabilityAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CapabilityAuthError'
  }
}

export type CapabilityTokenClaims = Readonly<{
  agentRunId: string
  schoolId: string
  scopes: readonly ReadScope[]
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
}>

export type CapabilityTokenGrant = Readonly<{
  token: string
  claims: CapabilityTokenClaims
}>

type StoredGrant = {
  agentRunId: string
  schoolId: string
  scopes: readonly ReadScope[]
  issuedAtMs: number
  expiresAtMs: number
  revokedAtMs: number | null
}

const READ_SCOPE_SET = new Set<string>(readScopes)
const DEFAULT_TTL_MS = 5 * 60 * 1000
const MAX_TTL_MS = 15 * 60 * 1000

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function requireOpaqueIdentity(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 160)
    throw new Error(`${field} must be a bounded opaque identity`)
  return trimmed
}

function parseBearer(authorization: string | undefined): string {
  if (!authorization)
    throw new CapabilityAuthError('AUTH_MISSING', 'Bearer authorization is required')
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(authorization)
  if (!match?.[1]) throw new CapabilityAuthError('AUTH_UNKNOWN', 'Bearer authorization is invalid')
  return match[1]
}

function toClaims(record: StoredGrant): CapabilityTokenClaims {
  return Object.freeze({
    agentRunId: record.agentRunId,
    schoolId: record.schoolId,
    scopes: Object.freeze([...record.scopes]),
    issuedAt: new Date(record.issuedAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    revokedAt: record.revokedAtMs === null ? null : new Date(record.revokedAtMs).toISOString(),
  })
}

export class CapabilityTokenStore {
  readonly #grants = new Map<string, StoredGrant>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(
    input: Readonly<{
      agentRunId: string
      schoolId: string
      scopes: readonly string[]
      ttlMs?: number
    }>,
  ): CapabilityTokenGrant {
    const agentRunId = requireOpaqueIdentity(input.agentRunId, 'agentRunId')
    const schoolId = requireOpaqueIdentity(input.schoolId, 'schoolId')
    if (input.scopes.length === 0 || new Set(input.scopes).size !== input.scopes.length) {
      throw new Error('Capability scopes must be non-empty and unique')
    }
    if (input.scopes.some((scope) => !READ_SCOPE_SET.has(scope))) {
      throw new Error('Only frozen read scopes can be issued in this slice')
    }

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
      throw new Error('Capability token TTL is outside the allowed short-lived range')
    }

    const issuedAtMs = this.now()
    const token = randomBytes(32).toString('base64url')
    const record: StoredGrant = {
      agentRunId,
      schoolId,
      scopes: Object.freeze([...input.scopes] as ReadScope[]),
      issuedAtMs,
      expiresAtMs: issuedAtMs + ttlMs,
      revokedAtMs: null,
    }
    this.#grants.set(tokenDigest(token), record)
    return Object.freeze({ token, claims: toClaims(record) })
  }

  revoke(token: string): boolean {
    const record = this.#grants.get(tokenDigest(token))
    if (!record || record.revokedAtMs !== null) return false
    record.revokedAtMs = this.now()
    return true
  }

  authenticate(
    authorization: string | undefined,
    requiredScope: ReadScope,
    context: Readonly<{ schoolId: string; agentRunId: string }>,
  ): CapabilityTokenClaims {
    const rawToken = parseBearer(authorization)
    const record = this.#grants.get(tokenDigest(rawToken))
    if (!record) throw new CapabilityAuthError('AUTH_UNKNOWN', 'Capability token is unknown')
    if (record.revokedAtMs !== null) {
      throw new CapabilityAuthError('AUTH_REVOKED', 'Capability token has been revoked')
    }
    if (this.now() >= record.expiresAtMs) {
      throw new CapabilityAuthError('AUTH_EXPIRED', 'Capability token has expired')
    }
    if (!record.scopes.includes(requiredScope)) {
      throw new CapabilityAuthError('AUTH_SCOPE_DENIED', 'Capability scope is not granted')
    }
    if (record.agentRunId !== context.agentRunId) {
      throw new CapabilityAuthError('AUTH_RUN_MISMATCH', 'Agent run does not match token scope')
    }
    if (record.schoolId !== context.schoolId) {
      throw new CapabilityAuthError('AUTH_SCHOOL_MISMATCH', 'School does not match token scope')
    }
    return toClaims(record)
  }
}
