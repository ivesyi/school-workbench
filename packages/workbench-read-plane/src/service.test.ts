import {
  MethodologyRegistry,
  loadMethodologyRegistry,
  projectMethodologyPack,
  type MethodologyPack,
  type MethodologyPackProjection,
  type MethodologyRepository,
} from '@school-workbench/methodology'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReadPlaneError, type ReadPlaneRepository } from './contracts'
import { WorkbenchReadCapabilityService } from './service'

const school = Object.freeze({
  id: 'school-a',
  name: 'A 学校',
  createdAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
})

function emptyReadRepository(): ReadPlaneRepository {
  return {
    getSchool: async (schoolId) => (schoolId === school.id ? school : null),
    getActiveStage: async () => null,
    getLatestState: async () => null,
    listStateHistory: async () => ({ items: [], hasMore: false }),
    listRecentJudgments: async () => [],
    listEvidence: async () => ({ items: [], hasMore: false }),
    listDiagnoses: async () => ({ items: [], hasMore: false }),
  }
}

class ProjectionRepository implements MethodologyRepository {
  constructor(private readonly projections: readonly MethodologyPackProjection[]) {}

  async listPacks() {
    return this.projections
  }

  async getPack(key: string, version: string) {
    return this.projections.find((pack) => pack.key === key && pack.version === version) ?? null
  }

  async getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ) {
    const matches = this.projections
      .filter((pack) => !selector?.packKey || pack.key === selector.packKey)
      .filter((pack) => !selector?.version || pack.version === selector.version)
      .flatMap((pack) => pack.criteria)
      .filter((criterion) => criterion.stableKey === stableId)
    return matches[0] ?? null
  }

  async findCriteria() {
    return this.projections.flatMap((pack) => pack.criteria)
  }
}

function loadReviewRegistry() {
  return loadMethodologyRegistry(
    resolve('knowledge/methodology'),
    resolve('references/SOURCE_MANIFEST.md'),
  )
}

function activeSbdFixture(): { registry: MethodologyRegistry; pack: MethodologyPack } {
  const review = loadReviewRegistry().getPack('schooling-by-design', '1')
  if (!review) throw new Error('SBD fixture missing')
  const pack = { ...review, status: 'active' as const }
  return { registry: new MethodologyRegistry([pack]), pack }
}

function createService(
  registry: MethodologyRegistry,
  projections: readonly MethodologyPackProjection[],
) {
  return new WorkbenchReadCapabilityService(
    emptyReadRepository(),
    registry,
    new ProjectionRepository(projections),
  )
}

describe('WorkbenchReadCapabilityService', () => {
  it('returns typed absence instead of inventing a stage or state', async () => {
    const registry = loadReviewRegistry()
    const service = createService(registry, [])

    await expect(service.stageCurrent(school.id, {})).resolves.toEqual({
      status: 'absent',
      reason: 'no_active_stage',
    })
    await expect(service.stateCurrent(school.id, {})).resolves.toEqual({
      status: 'absent',
      reason: 'no_snapshot',
    })
  })

  it('rejects a schoolId that differs from the injected run scope', async () => {
    const service = createService(loadReviewRegistry(), [])
    await expect(service.schoolContext(school.id, { schoolId: 'school-b' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    })
  })

  it('returns an explicit no-active result for the real review pack', async () => {
    const registry = loadReviewRegistry()
    const service = createService(registry, [])

    await expect(
      service.standardsGet(school.id, {
        packKey: 'schooling-by-design',
        version: '1',
        criterionRefs: ['SBD.C1.RESULT_CLARITY'],
      }),
    ).resolves.toEqual({
      status: 'no_active_pack',
      packKey: 'schooling-by-design',
      version: '1',
      reason: 'file_not_active',
    })
  })

  it('returns only the minimal selected active standards projection when file and DB match exactly', async () => {
    const { registry, pack } = activeSbdFixture()
    const projection = projectMethodologyPack(pack)
    const service = createService(registry, [projection])

    const result = await service.standardsGet(school.id, {
      packKey: pack.key,
      version: pack.version,
      criterionRefs: ['SBD.C1.RESULT_CLARITY'],
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected standards result')
    expect(result.criteria.map((criterion) => criterion.id)).toEqual(['SBD.C1.RESULT_CLARITY'])
    expect(result.constructs.map((construct) => construct.id)).toEqual(['SBD.MISSION'])
    expect(result.criteria[0]?.evidenceGuidance).toBeDefined()
    expect(result.criteria[0]?.counterIndicators.length).toBeGreaterThan(0)
    expect(result.pack).toMatchObject({
      key: pack.key,
      version: pack.version,
      sourceFingerprint: pack.sourceFingerprint.value,
      contentHash: pack.canonicalContentHash.value,
    })
    expect(JSON.stringify(result)).not.toContain('SBD.C2.EVIDENCE_BEFORE_ACTION')
  })

  it.each(['review', 'retired'] as const)(
    'returns persisted_not_active when the DB pack is %s while the file pack is active',
    async (status) => {
      const { registry, pack } = activeSbdFixture()
      const projection = { ...projectMethodologyPack(pack), status }
      const service = createService(registry, [projection])
      await expect(
        service.standardsGet(school.id, {
          packKey: pack.key,
          version: pack.version,
          criterionRefs: ['SBD.C1.RESULT_CLARITY'],
        }),
      ).resolves.toMatchObject({ status: 'no_active_pack', reason: 'persisted_not_active' })
    },
  )

  it.each(['review', 'retired'] as const)(
    'returns file_not_active when the file pack is %s',
    async (status) => {
      const review = loadReviewRegistry().getPack('schooling-by-design', '1')
      if (!review) throw new Error('SBD fixture missing')
      const filePack = { ...review, status }
      const registry = new MethodologyRegistry([filePack])
      const persistedActive = projectMethodologyPack({ ...review, status: 'active' as const })
      const service = createService(registry, [persistedActive])
      await expect(
        service.standardsGet(school.id, {
          packKey: filePack.key,
          version: filePack.version,
          criterionRefs: ['SBD.C1.RESULT_CLARITY'],
        }),
      ).resolves.toMatchObject({ status: 'no_active_pack', reason: 'file_not_active' })
    },
  )

  it.each([
    ['content hash', (pack: MethodologyPackProjection) => ({ ...pack, contentHash: '0'.repeat(64) })],
    [
      'source fingerprint',
      (pack: MethodologyPackProjection) => ({ ...pack, sourceFingerprint: '1'.repeat(64) }),
    ],
    [
      'criterion projection',
      (pack: MethodologyPackProjection) => ({
        ...pack,
        criteria: pack.criteria.map((criterion, index) =>
          index === 0 ? { ...criterion, description: `${criterion.description} drift` } : criterion,
        ),
      }),
    ],
  ] as const)(
    'fails closed on active %s drift',
    async (_label, mutate) => {
      const { registry, pack } = activeSbdFixture()
      const service = createService(registry, [mutate(projectMethodologyPack(pack))])
      await expect(
        service.standardsGet(school.id, {
          packKey: pack.key,
          version: pack.version,
          criterionRefs: ['SBD.C1.RESULT_CLARITY'],
        }),
      ).rejects.toMatchObject({ code: 'STANDARDS_DRIFT' })
    },
  )

  it.each([
    { packKey: 'schooling-by-design', version: '404', criterionRefs: ['SBD.C1.RESULT_CLARITY'] },
    { packKey: 'schooling-by-design', version: '1', criterionRefs: ['UNKNOWN'] },
    { packKey: 'schooling-by-design', version: '1', practiceType: 'unknown-practice' },
    {
      packKey: 'schooling-by-design',
      version: '1',
      criterionRefs: ['SBD.C1.RESULT_CLARITY', 'SBD.C1.RESULT_CLARITY'],
    },
    {
      packKey: 'schooling-by-design',
      version: '1',
      dimensionKeys: ['leadership', 'leadership'],
    },
    { packKey: 'schooling-by-design', version: '1' },
  ])('fails closed for unknown, duplicate, or unbounded standards filters %#', async (input) => {
    const { registry, pack } = activeSbdFixture()
    const service = createService(registry, [projectMethodologyPack(pack)])
    await expect(service.standardsGet(school.id, input)).rejects.toBeInstanceOf(ReadPlaneError)
    await expect(service.standardsGet(school.id, input)).rejects.toMatchObject({ code: 'INPUT_INVALID' })
  })
})
