import {
  MethodologyRegistry,
  computeCanonicalContentHash,
  loadMethodologyRegistry,
  methodologyPackSchema,
  projectMethodologyPack,
  type MethodologyPack,
  type MethodologyPackStatus,
  type PackReviewCriterionVerdict,
} from '@school-workbench/methodology'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { methodologyPacks } from './methodology-schema'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteMethodologyReviewRepository } from './sqlite-methodology-review-repository'

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

function packWithStatus(pack: MethodologyPack, status: MethodologyPackStatus): MethodologyPack {
  const raw = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>
  raw.status = status
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

describe('SqliteMethodologyRepository', () => {
  let database: WorkbenchDatabase
  let repository: SqliteMethodologyRepository
  let reviewRepository: SqliteMethodologyReviewRepository
  let registry: MethodologyRegistry

  beforeEach(() => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
    repository = new SqliteMethodologyRepository(
      database.db,
      () => new Date('2026-08-17T00:00:00Z'),
    )
    reviewRepository = new SqliteMethodologyReviewRepository(
      database.db,
      () => new Date('2026-08-17T00:00:00Z'),
    )
    registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  })

  afterEach(() => database.close())

  async function recordSignOff(
    id: string,
    verdict: PackReviewCriterionVerdict['verdict'],
    options: Readonly<{ contentHash?: string; signedAt?: string }> = {},
  ): Promise<void> {
    const pack = registry.getPack('schooling-by-design', '1')
    if (!pack) throw new Error('missing SBD pack')
    await reviewRepository.recordSignOff({
      id,
      packKey: pack.key,
      packVersion: pack.version,
      contentHash: options.contentHash ?? pack.canonicalContentHash.value,
      decision: verdict === 'usable' ? 'approved' : 'changes_requested',
      note: null,
      signedAt: options.signedAt ?? '2026-08-17T09:00:00.000Z',
      verdicts: pack.criteria.map((criterion) => ({
        criterionStableKey: criterion.id,
        verdict,
        note: null,
      })),
    })
  }

  function sbdStatus(): Promise<string | undefined> {
    return repository
      .getPack('schooling-by-design', '1')
      .then((persisted) => persisted?.status ?? undefined)
  }

  it('syncs both shipped packs idempotently and round-trips the persisted projection', async () => {
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

  it('moves a pack out of use and back without changing immutable methodology content', async () => {
    await repository.syncRegistry(registry)
    const original = registry.getPack('schooling-by-design', '1')
    if (!original) throw new Error('missing SBD pack')

    const beforePack = database.client
      .prepare(
        'SELECT id, status, created_at AS createdAt, content_hash AS contentHash FROM methodology_packs WHERE key = ? AND version = ?',
      )
      .get(original.key, original.version) as {
      id: string
      status: string
      createdAt: string
      contentHash: string
    }
    const beforeCriteria = database.client
      .prepare('SELECT * FROM methodology_criteria WHERE pack_id = ? ORDER BY sequence')
      .all(beforePack.id)
    const beforeAnchorCount = database.client
      .prepare(
        `SELECT count(*) AS count FROM behavior_anchors a
         JOIN methodology_criteria c ON c.id = a.criterion_id
         WHERE c.pack_id = ?`,
      )
      .get(beforePack.id) as { count: number }

    expect(beforePack.status).toBe('active')
    const withdrawn = packWithStatus(original, 'review')
    expect(withdrawn.canonicalContentHash.value).toBe(original.canonicalContentHash.value)
    await repository.setPackStatus(original.key, original.version, 'review')
    expect(await sbdStatus()).toBe('review')
    await repository.setPackStatus(original.key, original.version, 'active')

    const afterPack = database.client
      .prepare(
        'SELECT id, status, created_at AS createdAt, content_hash AS contentHash FROM methodology_packs WHERE key = ? AND version = ?',
      )
      .get(original.key, original.version) as typeof beforePack
    const afterCriteria = database.client
      .prepare('SELECT * FROM methodology_criteria WHERE pack_id = ? ORDER BY sequence')
      .all(beforePack.id)
    const afterAnchorCount = database.client
      .prepare(
        `SELECT count(*) AS count FROM behavior_anchors a
         JOIN methodology_criteria c ON c.id = a.criterion_id
         WHERE c.pack_id = ?`,
      )
      .get(beforePack.id) as { count: number }

    expect(afterPack).toEqual(beforePack)
    expect(afterCriteria).toEqual(beforeCriteria)
    expect(afterAnchorCount).toEqual(beforeAnchorCount)
    expect(await sbdStatus()).toBe('active')
  })

  it('rejects lifecycle rollback and skipped lifecycle states', async () => {
    await repository.syncRegistry(registry)
    const original = registry.getPack('schooling-by-design', '1')
    if (!original) throw new Error('missing SBD pack')

    await expect(
      repository.syncRegistry(new MethodologyRegistry([packWithStatus(original, 'draft')])),
    ).rejects.toThrow(/active -> draft/)

    await repository.setPackStatus(original.key, original.version, 'review')
    await expect(repository.setPackStatus(original.key, original.version, 'draft')).rejects.toThrow(
      /review -> draft/,
    )
    await expect(
      repository.setPackStatus(original.key, original.version, 'retired'),
    ).rejects.toThrow(/review -> retired/)
    await expect(repository.setPackStatus('schooling-by-design', '9', 'review')).rejects.toThrow(
      /not in the local database/,
    )
    expect(await sbdStatus()).toBe('review')
  })

  it('never restores a pack the consultant withdrew, however often the registry is synced', async () => {
    await repository.syncRegistry(registry)
    expect(await sbdStatus()).toBe('active')

    // The consultant marks the content as needing revision; the file still says active.
    await recordSignOff('sign-off-1', 'needs_revision')
    await repository.setPackStatus('schooling-by-design', '1', 'review')

    // Every subsequent launch re-reads the same active file registry.
    await repository.syncRegistry(registry)
    await repository.syncRegistry(registry)

    expect(await sbdStatus()).toBe('review')
    expect(
      database.client
        .prepare("SELECT status FROM methodology_packs WHERE key = 'schooling-by-design'")
        .get(),
    ).toEqual({ status: 'review' })
  })

  it('honours a veto recorded against content that has since drifted', async () => {
    await repository.syncRegistry(registry)
    // A refusal made before the content changed must not be washed out by the edit.
    await recordSignOff('sign-off-drifted', 'needs_revision', { contentHash: 'a'.repeat(64) })
    await repository.setPackStatus('schooling-by-design', '1', 'review')

    await repository.syncRegistry(registry)

    expect(await sbdStatus()).toBe('review')
  })

  it('puts the pack back in use only after the consultant says every criterion is usable', async () => {
    await repository.syncRegistry(registry)
    await recordSignOff('sign-off-1', 'needs_revision')
    await repository.setPackStatus('schooling-by-design', '1', 'review')
    await repository.syncRegistry(registry)
    expect(await sbdStatus()).toBe('review')

    await recordSignOff('sign-off-2', 'usable', { signedAt: '2026-08-17T10:00:00.000Z' })
    await repository.syncRegistry(registry)

    expect(await sbdStatus()).toBe('active')
  })

  it('withdraws a pack at sync time when a veto was recorded while the app was closed', async () => {
    await repository.syncRegistry(registry)
    expect(await sbdStatus()).toBe('active')

    await recordSignOff('sign-off-1', 'needs_revision')
    await repository.syncRegistry(registry)

    expect(await sbdStatus()).toBe('review')
  })

  it('projects a vetoed pack straight into review on a database that never saw it', async () => {
    await recordSignOff('sign-off-1', 'needs_revision')
    await repository.syncRegistry(registry)

    expect(await sbdStatus()).toBe('review')
    expect((await repository.getPack('data-wise', '3'))?.status).toBe('active')
  })

  it('refuses to revive a retired pack', async () => {
    await repository.syncRegistry(registry)
    const original = registry.getPack('schooling-by-design', '1')
    if (!original) throw new Error('missing SBD pack')

    await repository.syncRegistry(new MethodologyRegistry([packWithStatus(original, 'active')]))
    await repository.syncRegistry(new MethodologyRegistry([packWithStatus(original, 'retired')]))
    expect((await repository.getPack('schooling-by-design', '1'))?.status).toBe('retired')

    await expect(
      repository.syncRegistry(new MethodologyRegistry([packWithStatus(original, 'active')])),
    ).rejects.toThrow(/retired -> active/)
    await expect(
      repository.syncRegistry(new MethodologyRegistry([packWithStatus(original, 'review')])),
    ).rejects.toThrow(/retired -> review/)
    expect((await repository.getPack('schooling-by-design', '1'))?.status).toBe('retired')
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
