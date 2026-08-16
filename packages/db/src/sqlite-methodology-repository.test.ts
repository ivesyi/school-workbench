import {
  MethodologyRegistry,
  computeCanonicalContentHash,
  loadMethodologyRegistry,
  methodologyPackSchema,
  projectMethodologyPack,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { methodologyPacks } from './methodology-schema'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

function versionedPack(pack: MethodologyPack, version: string, title: string): MethodologyPack {
  const raw = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>
  raw.id = `${pack.key}-v${version}`
  raw.version = version
  raw.title = title
  delete raw.canonicalContentHash
  raw.canonicalContentHash = {
    algorithm: 'sha256',
    value: computeCanonicalContentHash(raw),
  }
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

describe('SqliteMethodologyRepository', () => {
  let database: WorkbenchDatabase
  let repository: SqliteMethodologyRepository
  let registry: MethodologyRegistry

  beforeEach(() => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
    repository = new SqliteMethodologyRepository(database.db, () => new Date('2026-08-17T00:00:00Z'))
    registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  })

  afterEach(() => database.close())

  it('syncs both reviewed packs idempotently and round-trips the persisted projection', async () => {
    await repository.syncRegistry(registry)
    await repository.syncRegistry(registry)

    const packCount = database.client
      .prepare('SELECT count(*) AS count FROM methodology_packs')
      .get() as { count: number }
    const criterionCount = database.client
      .prepare('SELECT count(*) AS count FROM methodology_criteria')
      .get() as { count: number }
    expect(packCount.count).toBe(2)
    expect(criterionCount.count).toBe(10)

    for (const pack of registry.listPacks()) {
      expect(await repository.getPack(pack.key, pack.version)).toEqual(projectMethodologyPack(pack))
    }
    expect((await repository.getCriterion('DW.C4.INFERENCE_DISCIPLINE'))?.stableKey).toBe(
      'DW.C4.INFERENCE_DISCIPLINE',
    )
    expect(await repository.findCriteria({ practiceType: 'school_design' })).toHaveLength(5)
  })

  it('refuses to overwrite a key+version when canonical content changes', async () => {
    await repository.syncRegistry(registry)
    const original = registry.getPack('schooling-by-design', '1')
    if (!original) throw new Error('missing SBD pack')
    const changed = versionedPack(original, '1', `${original.title} changed`)

    await expect(repository.syncRegistry(new MethodologyRegistry([changed]))).rejects.toThrow(
      /already exists with different content/,
    )
    expect((await repository.getPack('schooling-by-design', '1'))?.title).toBe(original.title)
  })

  it('keeps a new methodology version alongside the historical version', async () => {
    await repository.syncRegistry(registry)
    const original = registry.getPack('schooling-by-design', '1')
    if (!original) throw new Error('missing SBD pack')
    const next = versionedPack(original, '2', 'Schooling by Design Methodology Pack v2 fixture')

    await repository.syncRegistry(new MethodologyRegistry([next]))

    expect(await repository.getPack('schooling-by-design', '1')).not.toBeNull()
    expect(await repository.getPack('schooling-by-design', '2')).not.toBeNull()
    await expect(repository.getCriterion('SBD.C1.RESULT_CLARITY')).rejects.toThrow(
      /multiple persisted versions/,
    )
    expect(
      (
        await repository.getCriterion('SBD.C1.RESULT_CLARITY', {
          packKey: 'schooling-by-design',
          version: '2',
        })
      )?.stableKey,
    ).toBe('SBD.C1.RESULT_CLARITY')
  })

  it('detects parent scope corruption and relies on FK scope for anchors', async () => {
    await repository.syncRegistry(registry)
    const sbdParent = database.client
      .prepare(
        `SELECT c.id FROM methodology_criteria c
         JOIN methodology_packs p ON p.id = c.pack_id
         WHERE p.key = 'schooling-by-design' ORDER BY c.sequence LIMIT 1`,
      )
      .get() as { id: string }
    const dwChild = database.client
      .prepare(
        `SELECT c.id FROM methodology_criteria c
         JOIN methodology_packs p ON p.id = c.pack_id
         WHERE p.key = 'data-wise' ORDER BY c.sequence LIMIT 1`,
      )
      .get() as { id: string }
    database.client
      .prepare('UPDATE methodology_criteria SET parent_id = ? WHERE id = ?')
      .run(sbdParent.id, dwChild.id)

    await expect(repository.getPack('data-wise', '3')).rejects.toThrow(/parent is outside its pack/)
    expect(() =>
      database.client
        .prepare(
          `INSERT INTO behavior_anchors
           (id, criterion_id, level_key, label, description, source_locator_json, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('bad-anchor', 'missing-criterion', 'L1', 'bad', 'bad', '{"label":"bad"}', 1),
    ).toThrow()
  })

  it('persists source fingerprint and content hash without mutable pack pointers', async () => {
    await repository.syncRegistry(registry)
    const row = database.db
      .select({
        sourceFingerprint: methodologyPacks.sourceFingerprint,
        contentHash: methodologyPacks.contentHash,
      })
      .from(methodologyPacks)
      .get()
    expect(row?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(row?.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
