import { openWorkbenchDatabase, type WorkbenchDatabase } from '@school-workbench/db'
import { readScopes } from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMethodologyRuntime } from './methodology-runtime'
import { startWorkbenchReadPlane, type ReadPlaneRuntime } from './read-plane-runtime'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

let database: WorkbenchDatabase
let runtime: ReadPlaneRuntime | undefined

beforeEach(() => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run('school-1', '南山实验学校', '2026-08-17T00:00:00.000Z')
})

afterEach(async () => {
  await runtime?.stop()
  runtime = undefined
  database.close()
})

async function call(
  plane: ReadPlaneRuntime,
  capability: string,
  body: unknown,
): Promise<Readonly<{ status: number; payload: Record<string, unknown> }>> {
  const grant = plane.plane.issueToken({
    schoolId: 'school-1',
    agentRunId: 'run-1',
    scopes: readScopes,
  })
  const response = await fetch(`${plane.endpoint}/${capability}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant.token}`,
      'content-type': 'application/json',
      'x-swb-school-id': 'school-1',
      'x-swb-agent-run-id': 'run-1',
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

describe('loopback read plane startup', () => {
  it('binds loopback only and never announces anything else', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'not loaded in this test' }),
    })
    expect(runtime.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/internal\/v1$/u)
  })

  it('serves the other read capabilities when methodology content is unavailable', async () => {
    // The methodology runtime is deliberately allowed to fail. Only
    // `standards_get` depends on it, so the agent must keep being able to ask
    // about school state.
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'pack files unreadable' }),
    })

    expect(runtime.isMethodologyAvailable()).toBe(false)
    for (const capability of [
      'school_context',
      'stage_current',
      'state_current',
      'state_history',
      'evidence_list',
      'diagnosis_list',
    ]) {
      const result = await call(runtime, capability, {})
      expect(result.status, capability).toBe(200)
      expect(result.payload.ok, capability).toBe(true)
    }
  })

  it('fails standards_get closed while methodology content is unavailable', async () => {
    runtime = await startWorkbenchReadPlane({
      database,
      methodology: Promise.resolve({ state: 'unavailable', detail: 'pack files unreadable' }),
    })

    const result = await call(runtime, 'standards_get', {
      packKey: 'anything',
      version: '1',
      criterionRefs: ['X.1'],
    })
    expect(result.status).toBe(409)
    expect(result.payload).toEqual({
      ok: false,
      error: {
        code: 'STANDARDS_DRIFT',
        message: 'Methodology content is not available in this session',
      },
    })
  })

  it('does not wait for the methodology runtime before it starts serving', async () => {
    const deferred = { settle: (): void => undefined }
    const methodology = new Promise<{ state: 'unavailable'; detail: string }>((resolvePromise) => {
      deferred.settle = () => resolvePromise({ state: 'unavailable', detail: 'slow' })
    })

    runtime = await startWorkbenchReadPlane({ database, methodology })
    const result = await call(runtime, 'school_context', {})
    expect(result.status).toBe(200)

    deferred.settle()
    await methodology
  })

  it('adopts the methodology runtime collaborators once they load', async () => {
    const loaded = createMethodologyRuntime({
      database,
      paths: { methodologyRoot, sourceManifestPath, origin: 'repository' },
    })
    runtime = await startWorkbenchReadPlane({ database, methodology: loaded })
    await loaded

    expect(runtime.isMethodologyAvailable()).toBe(true)

    // The pack lifecycle status is a product decision that lives in
    // `knowledge/`, so this asserts only that the capability now reaches real
    // content instead of failing closed on a missing registry.
    const result = await call(runtime, 'standards_get', {
      packKey: 'schooling-by-design',
      version: 'v1',
      criterionRefs: ['SBD.C1'],
    })
    expect(result.status).not.toBe(409)

    const syncCount = database.client
      .prepare('SELECT count(*) AS count FROM methodology_packs')
      .get() as { count: number }
    expect(syncCount.count).toBeGreaterThan(0)
  })
})
