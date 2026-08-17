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
})
