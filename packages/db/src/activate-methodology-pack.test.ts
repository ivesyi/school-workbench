import {
  loadMethodologyRegistry,
  type MethodologyPack,
  type MethodologyRegistry,
  type PackReviewSignOff,
} from '@school-workbench/methodology'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateMethodologyPack } from './activate-methodology-pack'
import { defaultDatabasePath, parseArguments } from './activate-methodology-pack-cli'
import { openWorkbenchDatabase } from './database'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteMethodologyReviewRepository } from './sqlite-methodology-review-repository'

const migrationsFolder = resolve('packages/db/drizzle')
const repositoryMethodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

let workspace: string
let fixtureRoot: string
let databasePath: string

/** An isolated copy of the reviewed pack. The repository files are never touched. */
function fixturePackPath(): string {
  return join(fixtureRoot, 'schooling-by-design-v1', 'pack.json')
}

function fixturePack(): MethodologyPack {
  const pack = loadMethodologyRegistry(fixtureRoot, sourceManifestPath).getPack(
    'schooling-by-design',
    '1',
  )
  if (!pack) throw new Error('missing fixture pack')
  return pack
}

function approvedSignOff(pack: MethodologyPack, contentHash?: string): PackReviewSignOff {
  return {
    id: 'sign-off-1',
    packKey: pack.key,
    packVersion: pack.version,
    contentHash: contentHash ?? pack.canonicalContentHash.value,
    decision: 'approved',
    note: null,
    signedAt: '2026-08-17T09:00:00.000Z',
    verdicts: pack.criteria.map((criterion) => ({
      criterionStableKey: criterion.id,
      verdict: 'usable' as const,
      note: null,
    })),
  } as PackReviewSignOff
}

async function seedDatabase(
  signOff: PackReviewSignOff | null,
  registry?: MethodologyRegistry,
): Promise<void> {
  const database = openWorkbenchDatabase(databasePath, migrationsFolder)
  try {
    const methodologyRepository = new SqliteMethodologyRepository(database.db)
    await methodologyRepository.syncRegistry(
      registry ?? loadMethodologyRegistry(fixtureRoot, sourceManifestPath),
    )
    if (signOff) await new SqliteMethodologyReviewRepository(database.db).recordSignOff(signOff)
  } finally {
    database.close()
  }
}

function request(apply: boolean): Parameters<typeof activateMethodologyPack>[0] {
  return {
    packKey: 'schooling-by-design',
    packVersion: '1',
    methodologyRoot: fixtureRoot,
    sourceManifestPath,
    databasePath,
    migrationsFolder,
    apply,
  }
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'swb-activation-'))
  fixtureRoot = join(workspace, 'methodology')
  databasePath = join(workspace, 'workbench.sqlite')
  mkdirSync(join(fixtureRoot, 'schooling-by-design-v1'), { recursive: true })
  cpSync(join(repositoryMethodologyRoot, 'schooling-by-design-v1', 'pack.json'), fixturePackPath())
})

afterEach(() => rmSync(workspace, { recursive: true, force: true }))

describe('methodology pack activation command', () => {
  it('activates a reviewed pack and changes nothing except its status', async () => {
    const pack = fixturePack()
    await seedDatabase(approvedSignOff(pack))
    const before = readFileSync(fixturePackPath(), 'utf8')

    const dryRun = await activateMethodologyPack(request(false))
    expect(dryRun.plan).toMatchObject({ ok: true, from: 'review', to: 'active' })
    expect(dryRun.applied).toBe(false)
    expect(readFileSync(fixturePackPath(), 'utf8')).toBe(before)

    const applied = await activateMethodologyPack(request(true))
    expect(applied.applied).toBe(true)

    const after = readFileSync(fixturePackPath(), 'utf8')
    expect(after).not.toBe(before)
    expect(after.replace('"status": "active"', '"status": "review"')).toBe(before)

    const activated = fixturePack()
    expect(activated.status).toBe('active')
    expect(activated.canonicalContentHash.value).toBe(pack.canonicalContentHash.value)
  })

  it('lets the persisted projection follow the file exactly one step later', async () => {
    await seedDatabase(approvedSignOff(fixturePack()))
    await activateMethodologyPack(request(true))

    const database = openWorkbenchDatabase(databasePath, migrationsFolder)
    try {
      const repository = new SqliteMethodologyRepository(database.db)
      expect((await repository.getPack('schooling-by-design', '1'))?.status).toBe('review')
      await repository.syncRegistry(loadMethodologyRegistry(fixtureRoot, sourceManifestPath))
      expect((await repository.getPack('schooling-by-design', '1'))?.status).toBe('active')
    } finally {
      database.close()
    }
  })

  it('refuses without a sign-off, with a stale sign-off, or after the pack is already active', async () => {
    const pack = fixturePack()
    await seedDatabase(null)
    const untouched = readFileSync(fixturePackPath(), 'utf8')

    expect(await activateMethodologyPack(request(true))).toMatchObject({
      applied: false,
      plan: { ok: false, code: 'no_sign_off' },
    })
    expect(readFileSync(fixturePackPath(), 'utf8')).toBe(untouched)

    const database = openWorkbenchDatabase(databasePath, migrationsFolder)
    try {
      await new SqliteMethodologyReviewRepository(database.db).recordSignOff(
        approvedSignOff(pack, 'a'.repeat(64)),
      )
    } finally {
      database.close()
    }
    expect(await activateMethodologyPack(request(true))).toMatchObject({
      applied: false,
      plan: { ok: false, code: 'sign_off_outdated' },
    })
    expect(readFileSync(fixturePackPath(), 'utf8')).toBe(untouched)

    writeFileSync(
      fixturePackPath(),
      untouched.replace('"status": "review"', '"status": "active"'),
      'utf8',
    )
    expect(await activateMethodologyPack(request(true))).toMatchObject({
      plan: { ok: false, code: 'file_not_in_review' },
    })
  })

  it('refuses when the review asked for revisions', async () => {
    const pack = fixturePack()
    const changesRequested = {
      ...approvedSignOff(pack),
      decision: 'changes_requested',
      verdicts: pack.criteria.map((criterion, index) => ({
        criterionStableKey: criterion.id,
        verdict: index === 0 ? ('needs_revision' as const) : ('usable' as const),
        note: null,
      })),
    } as PackReviewSignOff
    await seedDatabase(changesRequested)

    expect(await activateMethodologyPack(request(true))).toMatchObject({
      applied: false,
      plan: { ok: false, code: 'sign_off_not_approved' },
    })
  })

  it('refuses when the pack was never loaded into this database', async () => {
    const pack = fixturePack()
    const database = openWorkbenchDatabase(databasePath, migrationsFolder)
    try {
      await new SqliteMethodologyReviewRepository(database.db).recordSignOff(approvedSignOff(pack))
    } finally {
      database.close()
    }

    expect(await activateMethodologyPack(request(true))).toMatchObject({
      applied: false,
      plan: { ok: false, code: 'not_persisted' },
    })
  })

  it('parses command arguments and resolves a default database location', () => {
    expect(parseArguments(['--pack', 'data-wise', '--version', '3', '--apply'])).toEqual({
      pack: 'data-wise',
      version: '3',
      apply: true,
    })
    expect(defaultDatabasePath('darwin', '/Users/consultant', {})).toBe(
      '/Users/consultant/Library/Application Support/Electron/school-workbench.sqlite',
    )
    expect(
      defaultDatabasePath('linux', '/home/consultant', { SWB_DATABASE_PATH: '/tmp/custom.sqlite' }),
    ).toBe('/tmp/custom.sqlite')
  })
})
