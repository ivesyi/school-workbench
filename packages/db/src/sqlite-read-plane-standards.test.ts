import {
  MethodologyRegistry,
  loadMethodologyRegistry,
  methodologyPackSchema,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { WorkbenchReadCapabilityService } from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteMethodologyReviewRepository } from './sqlite-methodology-review-repository'
import { SqliteReadPlaneRepository } from './sqlite-read-plane-repository'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

function activePack(pack: MethodologyPack): MethodologyPack {
  const raw = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>
  raw.status = 'active'
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

describe('standards_get persisted SQLite boundary', () => {
  let database: WorkbenchDatabase

  beforeEach(() => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
    database.client
      .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
      .run('school-a', 'A 学校', '2026-08-17T00:00:00.000Z')
  })

  afterEach(() => database.close())

  it('returns a minimal projection only when the active file pack exactly matches persisted SQLite', async () => {
    const reviewRegistry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
    const reviewPack = reviewRegistry.getPack('schooling-by-design', '1')
    if (!reviewPack) throw new Error('Schooling by Design fixture is missing')
    const active = activePack(reviewPack)
    const activeRegistry = new MethodologyRegistry([active])
    const methodologyRepository = new SqliteMethodologyRepository(
      database.db,
      () => new Date('2026-08-17T00:00:00.000Z'),
    )
    await methodologyRepository.syncRegistry(activeRegistry)

    const service = new WorkbenchReadCapabilityService(
      new SqliteReadPlaneRepository(database),
      activeRegistry,
      methodologyRepository,
    )
    const result = await service.standardsGet('school-a', {
      packKey: active.key,
      version: active.version,
      criterionRefs: ['SBD.C1.RESULT_CLARITY'],
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected active standards result')
    expect(result.pack).toEqual({
      key: active.key,
      version: active.version,
      title: active.title,
      sourceRef: active.sourceRef,
      sourceFingerprint: active.sourceFingerprint.value,
      contentHash: active.canonicalContentHash.value,
    })
    expect(result.criteria.map((criterion) => criterion.id)).toEqual(['SBD.C1.RESULT_CLARITY'])
    expect(result.constructs.map((construct) => construct.id)).toEqual(['SBD.MISSION'])
    expect(result.criteria[0]?.evidenceGuidance).toBeDefined()
    expect(result.criteria[0]?.counterIndicators.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain('SBD.C2.EVIDENCE_BEFORE_ACTION')
  })

  it('fails closed downstream as soon as the consultant withdraws the pack, and stays closed after a restart', async () => {
    const registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
    const pack = registry.getPack('schooling-by-design', '1')
    if (!pack) throw new Error('Schooling by Design fixture is missing')
    const now = (): Date => new Date('2026-08-17T00:00:00.000Z')
    const methodologyRepository = new SqliteMethodologyRepository(database.db, now)
    const reviewRepository = new SqliteMethodologyReviewRepository(database.db, now)
    await methodologyRepository.syncRegistry(registry)

    const service = new WorkbenchReadCapabilityService(
      new SqliteReadPlaneRepository(database),
      registry,
      methodologyRepository,
    )
    const request = {
      packKey: pack.key,
      version: pack.version,
      criterionRefs: ['SBD.C1.RESULT_CLARITY'],
    }
    expect((await service.standardsGet('school-a', request)).status).toBe('ok')

    await reviewRepository.recordSignOff({
      id: 'sign-off-1',
      packKey: pack.key,
      packVersion: pack.version,
      contentHash: pack.canonicalContentHash.value,
      decision: 'changes_requested',
      note: null,
      signedAt: '2026-08-17T09:00:00.000Z',
      verdicts: pack.criteria.map((criterion, index) => ({
        criterionStableKey: criterion.id,
        verdict: index === 0 ? ('needs_revision' as const) : ('usable' as const),
        note: null,
      })),
    })
    await methodologyRepository.setPackStatus(pack.key, pack.version, 'review')

    expect((await service.standardsGet('school-a', request)).status).toBe('no_active_pack')

    // A restart re-reads the same shipped file registry; the refusal must survive it.
    await methodologyRepository.syncRegistry(registry)
    expect((await service.standardsGet('school-a', request)).status).toBe('no_active_pack')
  })
})
