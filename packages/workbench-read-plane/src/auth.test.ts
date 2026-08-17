import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityTokenStore } from './auth'
import { ReadPlaneError } from './contracts'
import { createWorkbenchReadPlaneBootstrap, type SafeReadPlaneLogEvent } from './loopback'
import type { WorkbenchReadCapabilityService } from './service'

const running: Array<ReturnType<typeof createWorkbenchReadPlaneBootstrap>> = []

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop()
})

function fakeService(): WorkbenchReadCapabilityService {
  return {
    schoolContext: async (schoolId: string, input: unknown) => {
      const body = input as { schoolId?: string }
      if (body.schoolId && body.schoolId !== schoolId) {
        throw new ReadPlaneError('INPUT_INVALID', 'Input schoolId does not match the scoped school')
      }
      return {
        school: {
          id: schoolId,
          name: 'Scoped School',
          createdAt: '2026-08-17T00:00:00.000Z',
          archivedAt: null,
        },
        activeStage: null,
        latestSnapshot: null,
        recentJudgments: [],
        judgmentLimit: 10,
        judgmentOrder: 'createdAt_desc_id_desc',
      }
    },
    stageCurrent: async () => ({ status: 'absent', reason: 'no_active_stage' }),
    stateCurrent: async () => ({ status: 'absent', reason: 'no_snapshot' }),
    stateHistory: async () => ({
      items: [],
      order: 'sequence_desc',
      limit: 10,
      nextBeforeSequence: null,
    }),
    evidenceList: async () => ({
      items: [],
      order: 'createdAt_desc_id_desc',
      limit: 20,
      nextCursor: null,
    }),
    diagnosisList: async () => ({
      items: [],
      order: 'createdAt_desc_id_desc',
      limit: 20,
      nextCursor: null,
    }),
    standardsGet: async () => ({
      status: 'no_active_pack',
      packKey: 'fixture',
      version: '1',
      reason: 'file_not_active',
    }),
  } as unknown as WorkbenchReadCapabilityService
}

async function post(
  endpoint: string,
  capability: string,
  input: unknown,
  headers: Readonly<{
    token?: string
    schoolId?: string
    agentRunId?: string
  }> = {},
) {
  return fetch(`${endpoint}/${capability}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers.token ? { authorization: `Bearer ${headers.token}` } : {}),
      ...(headers.schoolId ? { 'x-swb-school-id': headers.schoolId } : {}),
      ...(headers.agentRunId ? { 'x-swb-agent-run-id': headers.agentRunId } : {}),
    },
    body: JSON.stringify(input),
  })
}

describe('Workbench loopback capability auth', () => {
  it('binds to random 127.0.0.1 and fails closed for every token/run/school failure without leaking tokens', async () => {
    let now = Date.parse('2026-08-17T00:00:00.000Z')
    const tokenStore = new CapabilityTokenStore(() => now)
    const logs: SafeReadPlaneLogEvent[] = []
    const server = createWorkbenchReadPlaneBootstrap(fakeService(), {
      tokenStore,
      safeLog: (event) => logs.push(event),
    })
    running.push(server)
    const endpoint = await server.start()

    const url = new URL(endpoint)
    expect(url.hostname).toBe('127.0.0.1')
    expect(Number(url.port)).toBeGreaterThan(0)
    expect(await server.start()).toBe(endpoint)

    const valid = server.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: ['school.read'],
      ttlMs: 5_000,
    })
    const legal = await post(endpoint, 'school_context', {}, {
      token: valid.token,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(legal.status).toBe(200)
    await expect(legal.json()).resolves.toMatchObject({
      ok: true,
      data: { school: { id: 'school-a' } },
    })

    const missing = await post(endpoint, 'school_context', {}, {
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(missing.status).toBe(401)
    await expect(missing.json()).resolves.toMatchObject({ error: { code: 'AUTH_MISSING' } })

    const unknownToken = 'u'.repeat(43)
    const unknown = await post(endpoint, 'school_context', {}, {
      token: unknownToken,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(unknown.status).toBe(401)
    expect(JSON.stringify(await unknown.json())).not.toContain(unknownToken)

    const expiring = server.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: ['school.read'],
      ttlMs: 1_000,
    })
    now += 1_000
    const expired = await post(endpoint, 'school_context', {}, {
      token: expiring.token,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toMatchObject({ error: { code: 'AUTH_EXPIRED' } })

    const revoked = server.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: ['school.read'],
    })
    expect(server.revokeToken(revoked.token)).toBe(true)
    const revokedResponse = await post(endpoint, 'school_context', {}, {
      token: revoked.token,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(revokedResponse.status).toBe(401)
    await expect(revokedResponse.json()).resolves.toMatchObject({ error: { code: 'AUTH_REVOKED' } })

    const wrongScope = server.issueToken({
      schoolId: 'school-a',
      agentRunId: 'run-a',
      scopes: ['stage.read'],
    })
    const scopeResponse = await post(endpoint, 'school_context', {}, {
      token: wrongScope.token,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(scopeResponse.status).toBe(403)
    await expect(scopeResponse.json()).resolves.toMatchObject({
      error: { code: 'AUTH_SCOPE_DENIED' },
    })

    const wrongSchool = await post(endpoint, 'school_context', {}, {
      token: valid.token,
      schoolId: 'school-b',
      agentRunId: 'run-a',
    })
    expect(wrongSchool.status).toBe(403)
    await expect(wrongSchool.json()).resolves.toMatchObject({
      error: { code: 'AUTH_SCHOOL_MISMATCH' },
    })

    const wrongRun = await post(endpoint, 'school_context', {}, {
      token: valid.token,
      schoolId: 'school-a',
      agentRunId: 'run-b',
    })
    expect(wrongRun.status).toBe(403)
    await expect(wrongRun.json()).resolves.toMatchObject({ error: { code: 'AUTH_RUN_MISMATCH' } })

    const bodyScope = await post(endpoint, 'school_context', { schoolId: 'school-b' }, {
      token: valid.token,
      schoolId: 'school-a',
      agentRunId: 'run-a',
    })
    expect(bodyScope.status).toBe(400)
    await expect(bodyScope.json()).resolves.toMatchObject({ error: { code: 'INPUT_INVALID' } })

    const serializedLogs = JSON.stringify(logs)
    for (const token of [valid.token, unknownToken, expiring.token, revoked.token, wrongScope.token]) {
      expect(serializedLogs).not.toContain(token)
    }
  })
})
