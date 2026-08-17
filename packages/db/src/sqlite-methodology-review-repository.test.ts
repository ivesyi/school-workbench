import {
  computeCanonicalContentHash,
  loadMethodologyRegistry,
  methodologyPackSchema,
  packReviewApproves,
  packReviewIsOutdated,
  type MethodologyPack,
  type PackReviewSignOff,
} from '@school-workbench/methodology'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteMethodologyReviewRepository } from './sqlite-methodology-review-repository'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const sbdPackPath = resolve('knowledge/methodology/schooling-by-design-v1/pack.json')

function sbdPack(): MethodologyPack {
  const pack = loadMethodologyRegistry(methodologyRoot, sourceManifestPath).getPack(
    'schooling-by-design',
    '1',
  )
  if (!pack) throw new Error('missing SBD pack')
  return pack
}

function retranslatedPack(): MethodologyPack {
  const raw = JSON.parse(readFileSync(sbdPackPath, 'utf8')) as Record<string, unknown>
  const criteria = raw.criteria
  if (!Array.isArray(criteria)) throw new Error('fixture criteria missing')
  const first = criteria[0] as Record<string, unknown>
  first.description = '学校是否把使命转译为可辨认的学习结果，而不是活动清单。'
  delete raw.canonicalContentHash
  raw.canonicalContentHash = { algorithm: 'sha256', value: computeCanonicalContentHash(raw) }
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

function signOffFor(
  pack: MethodologyPack,
  overrides: Partial<PackReviewSignOff> = {},
): PackReviewSignOff {
  return {
    id: 'sign-off-1',
    packKey: pack.key,
    packVersion: pack.version,
    contentHash: pack.canonicalContentHash.value,
    decision: 'approved',
    note: null,
    signedAt: '2026-08-17T09:00:00.000Z',
    verdicts: pack.criteria.map((criterion) => ({
      criterionStableKey: criterion.id,
      verdict: 'usable' as const,
      note: null,
    })),
    ...overrides,
  } as PackReviewSignOff
}

describe('SqliteMethodologyReviewRepository', () => {
  let database: WorkbenchDatabase
  let repository: SqliteMethodologyReviewRepository

  beforeEach(() => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
    repository = new SqliteMethodologyReviewRepository(
      database.db,
      () => new Date('2026-08-17T09:00:00Z'),
    )
  })

  afterEach(() => database.close())

  it('persists a sign-off with every criterion verdict and reads it back unchanged', async () => {
    const pack = sbdPack()
    const signOff = signOffFor(pack, {
      note: '整体可用，但描述仍需回到原书措辞。',
      verdicts: pack.criteria.map((criterion, index) => ({
        criterionStableKey: criterion.id,
        verdict: index === 0 ? ('needs_revision' as const) : ('usable' as const),
        note: index === 0 ? '描述与名称完全相同。' : null,
      })),
      decision: 'changes_requested',
    })

    await repository.recordSignOff(signOff)

    const stored = await repository.getLatestSignOff('schooling-by-design', '1')
    expect(stored).toEqual(signOff)
    expect(stored?.verdicts).toHaveLength(5)
    expect(packReviewApproves(pack, stored)).toBe(false)
  })

  it('keeps every sign-off and returns the most recent one', async () => {
    const pack = sbdPack()
    await repository.recordSignOff(
      signOffFor(pack, { id: 'sign-off-1', signedAt: '2026-08-17T09:00:00.000Z' }),
    )
    await repository.recordSignOff(
      signOffFor(pack, {
        id: 'sign-off-2',
        signedAt: '2026-08-18T09:00:00.000Z',
        note: '第二次复核。',
      }),
    )

    const rows = database.client
      .prepare('SELECT count(*) AS count FROM methodology_pack_sign_offs')
      .get() as { count: number }
    expect(rows.count).toBe(2)
    expect((await repository.getLatestSignOff('schooling-by-design', '1'))?.id).toBe('sign-off-2')
    await expect(repository.recordSignOff(signOffFor(pack, { id: 'sign-off-2' }))).rejects.toThrow(
      /already exists/,
    )
  })

  it('invalidates a stored sign-off as soon as the reviewed content drifts', async () => {
    const reviewed = sbdPack()
    await repository.recordSignOff(signOffFor(reviewed))
    const stored = await repository.getLatestSignOff('schooling-by-design', '1')
    const retranslated = retranslatedPack()

    expect(retranslated.canonicalContentHash.value).not.toBe(reviewed.canonicalContentHash.value)
    expect(packReviewApproves(reviewed, stored)).toBe(true)
    expect(packReviewApproves(retranslated, stored)).toBe(false)
    expect(packReviewIsOutdated(retranslated, stored)).toBe(true)
    expect(stored?.contentHash).toBe(reviewed.canonicalContentHash.value)
  })

  it('returns nothing for a pack version that was never reviewed', async () => {
    expect(await repository.getLatestSignOff('data-wise', '3')).toBeNull()
    expect(await repository.getLatestSignOff('schooling-by-design', '9')).toBeNull()
  })

  it('rejects a malformed sign-off before it reaches the database', async () => {
    const pack = sbdPack()
    await expect(
      repository.recordSignOff(signOffFor(pack, { contentHash: 'not-a-hash' })),
    ).rejects.toThrow()
    await expect(repository.recordSignOff(signOffFor(pack, { verdicts: [] }))).rejects.toThrow()
    expect(
      database.client.prepare('SELECT count(*) AS count FROM methodology_pack_sign_offs').get(),
    ).toEqual({ count: 0 })
  })
})
