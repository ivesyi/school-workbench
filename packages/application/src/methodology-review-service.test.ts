import {
  computeCanonicalContentHash,
  loadMethodologyRegistry,
  MethodologyRegistry,
  methodologyPackSchema,
  projectMethodologyPack,
  type MethodologyPack,
  type MethodologyPackProjection,
  type MethodologyPackStatus,
  type MethodologyPackStatusWriter,
  type MethodologyRepository,
  type MethodologyReviewRepository,
  type PackReviewSignOff,
} from '@school-workbench/methodology'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MethodologyReviewService,
  unavailableMethodologyWorkbench,
} from './methodology-review-service'

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const sbdPackPath = resolve('knowledge/methodology/schooling-by-design-v1/pack.json')

function registryFor(packs: readonly MethodologyPack[]): MethodologyRegistry {
  return new MethodologyRegistry(packs)
}

function repositoryPacks(): readonly MethodologyPack[] {
  return loadMethodologyRegistry(methodologyRoot, sourceManifestPath).listPacks()
}

function sbdPack(): MethodologyPack {
  const pack = repositoryPacks().find((item) => item.key === 'schooling-by-design')
  if (!pack) throw new Error('missing SBD pack')
  return pack
}

function packWithStatus(pack: MethodologyPack, status: string): MethodologyPack {
  const raw = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>
  raw.status = status
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

function retranslatedPack(): MethodologyPack {
  const raw = JSON.parse(readFileSync(sbdPackPath, 'utf8')) as Record<string, unknown>
  const criteria = raw.criteria
  if (!Array.isArray(criteria)) throw new Error('fixture criteria missing')
  ;(criteria[0] as Record<string, unknown>).description = '学校是否把使命转译为可辨认的学习结果。'
  delete raw.canonicalContentHash
  raw.canonicalContentHash = { algorithm: 'sha256', value: computeCanonicalContentHash(raw) }
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

class InMemoryMethodologyRepository implements MethodologyRepository, MethodologyPackStatusWriter {
  readonly statusWrites: string[] = []
  private readonly projections: Map<string, MethodologyPackProjection>

  constructor(packs: readonly MethodologyPack[], status?: string) {
    this.projections = new Map(
      packs.map((pack) => {
        const projection = projectMethodologyPack(status ? packWithStatus(pack, status) : pack)
        return [`${pack.key}@${pack.version}`, projection]
      }),
    )
  }

  async listPacks(): Promise<readonly MethodologyPackProjection[]> {
    return [...this.projections.values()]
  }

  async getPack(key: string, version: string): Promise<MethodologyPackProjection | null> {
    return this.projections.get(`${key}@${version}`) ?? null
  }

  async getCriterion(): Promise<null> {
    return null
  }

  async findCriteria(): Promise<readonly MethodologyPackProjection['criteria'][number][]> {
    return []
  }

  async setPackStatus(key: string, version: string, status: MethodologyPackStatus): Promise<void> {
    const current = this.projections.get(`${key}@${version}`)
    if (!current) throw new Error(`missing projection ${key}@${version}`)
    this.projections.set(`${key}@${version}`, { ...current, status })
    this.statusWrites.push(status)
  }
}

class InMemoryReviewRepository implements MethodologyReviewRepository {
  readonly records: PackReviewSignOff[] = []

  async recordSignOff(signOff: PackReviewSignOff): Promise<void> {
    this.records.push(signOff)
  }

  async getLatestSignOff(packKey: string, packVersion: string): Promise<PackReviewSignOff | null> {
    const matches = this.records.filter(
      (record) => record.packKey === packKey && record.packVersion === packVersion,
    )
    return matches[matches.length - 1] ?? null
  }
}

function serviceFor(
  packs: readonly MethodologyPack[],
  reviewRepository: MethodologyReviewRepository,
  persistedStatus?: string,
  methodologyRepository = new InMemoryMethodologyRepository(packs, persistedStatus),
): MethodologyReviewService {
  let sequence = 0
  return new MethodologyReviewService(registryFor(packs), methodologyRepository, reviewRepository, {
    createId: () => {
      sequence += 1
      return `sign-off-${sequence}`
    },
    now: () => new Date('2026-08-17T09:00:00Z'),
  })
}

async function signOffEveryCriterion(
  pack: MethodologyPack,
  reviewRepository: MethodologyReviewRepository,
  verdict: 'usable' | 'needs_revision',
): Promise<void> {
  await serviceFor([pack], reviewRepository).signOff({
    packKey: pack.key,
    packVersion: pack.version,
    note: null,
    verdicts: pack.criteria.map((criterion) => ({
      criterionStableKey: criterion.id,
      verdict,
      note: null,
    })),
  })
}

describe('MethodologyReviewService', () => {
  it('shows the full reviewable content and the concrete gaps of the current translation', async () => {
    const service = serviceFor(repositoryPacks(), new InMemoryReviewRepository())
    const view = await service.getWorkbench()
    if (view.state !== 'ready') throw new Error('expected a ready workbench')

    expect(view.packs).toHaveLength(2)
    const sbd = view.packs.find((pack) => pack.key === 'schooling-by-design')
    // Nothing was signed off: the content is in use by default.
    expect(sbd?.status).toBe('active')
    expect(sbd?.statusLabel).toBe('正在使用')
    expect(sbd?.statusDetail).toBe('正在用于正式判断。')
    expect(sbd?.inUse).toBe(true)
    expect(sbd?.review).toBeNull()
    expect(sbd?.criteria.every((criterion) => criterion.lastVerdict === null)).toBe(true)
    expect(sbd?.criteria).toHaveLength(5)
    expect(sbd?.constructs).toHaveLength(7)
    expect(sbd?.criteria[0]?.gaps).toContain('还没有真正的描述：描述与名称完全相同。')
    expect(sbd?.criteria[0]?.gaps).not.toContain('还没有对应到五个维度中的任何一个。')
    expect(sbd?.criteria[0]?.dimensionLabel).toBe('领导力')
    expect(sbd?.behaviorAnchorCount).toBe(0)
    expect(sbd?.packGuardrails.length).toBeGreaterThan(0)
    expect(view.packs.flatMap((pack) => pack.criteria)).toHaveLength(10)
  })

  it('derives the decision from the verdicts instead of trusting the caller', async () => {
    const reviewRepository = new InMemoryReviewRepository()
    const packs = repositoryPacks()
    const service = serviceFor(packs, reviewRepository)
    const sbd = sbdPack()

    const after = await service.signOff({
      packKey: 'schooling-by-design',
      packVersion: '1',
      note: '  ',
      verdicts: sbd.criteria.map((criterion, index) => ({
        criterionStableKey: criterion.id,
        verdict: index === 0 ? 'needs_revision' : 'usable',
        note: index === 0 ? ' 描述与名称完全相同。 ' : null,
      })),
    })
    if (after.state !== 'ready') throw new Error('expected a ready workbench')

    const record = reviewRepository.records[0]
    expect(record?.decision).toBe('changes_requested')
    expect(record?.contentHash).toBe(sbd.canonicalContentHash.value)
    expect(record?.note).toBeNull()
    expect(record?.verdicts[0]?.note).toBe('描述与名称完全相同。')

    const view = after.packs.find((pack) => pack.key === 'schooling-by-design')
    expect(view?.review).toMatchObject({
      decision: 'changes_requested',
      decisionLabel: '需要修订',
      usableCount: 4,
      needsRevisionCount: 1,
      outdated: false,
    })
    expect(view?.statusDetail).toContain('你把其中 1 条标为需要修订')
    expect(view?.inUse).toBe(false)
    expect(view?.status).toBe('review')
    expect(view?.criteria[0]?.lastVerdict).toEqual({
      verdict: 'needs_revision',
      note: '描述与名称完全相同。',
    })
  })

  it('rejects a sign-off that does not cover every criterion of the pack', async () => {
    const service = serviceFor(repositoryPacks(), new InMemoryReviewRepository())

    await expect(
      service.signOff({
        packKey: 'schooling-by-design',
        packVersion: '1',
        note: null,
        verdicts: [{ criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'usable', note: null }],
      }),
    ).rejects.toThrow(/Criterion verdict is missing/)
    await expect(
      service.signOff({
        packKey: 'schooling-by-design',
        packVersion: '9',
        note: null,
        verdicts: [{ criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'usable', note: null }],
      }),
    ).rejects.toThrow(/未找到方法论内容/)
  })

  it('marks an earlier sign-off as outdated once the content changes', async () => {
    const reviewRepository = new InMemoryReviewRepository()
    const reviewed = sbdPack()
    await signOffEveryCriterion(reviewed, reviewRepository, 'usable')

    const driftedView = await serviceFor([retranslatedPack()], reviewRepository).getWorkbench()
    if (driftedView.state !== 'ready') throw new Error('expected a ready workbench')
    const pack = driftedView.packs[0]

    expect(pack?.review?.outdated).toBe(true)
    expect(pack?.criteria.every((criterion) => criterion.lastVerdict === null)).toBe(true)
    // D5: the previous conclusion was an approval, so drift leaves the content in use.
    expect(pack?.inUse).toBe(true)
    expect(pack?.statusDetail).toBe('正在用于正式判断。')
  })

  it('withdraws the pack from use on one needs_revision and restores it when the consultant changes his mind', async () => {
    const reviewRepository = new InMemoryReviewRepository()
    const pack = sbdPack()
    const methodologyRepository = new InMemoryMethodologyRepository([pack])
    const service = serviceFor([pack], reviewRepository, undefined, methodologyRepository)

    const withdrawn = await service.signOff({
      packKey: 'schooling-by-design',
      packVersion: '1',
      note: null,
      verdicts: pack.criteria.map((criterion, index) => ({
        criterionStableKey: criterion.id,
        verdict: index === 2 ? ('needs_revision' as const) : ('usable' as const),
        note: null,
      })),
    })
    if (withdrawn.state !== 'ready') throw new Error('expected a ready workbench')
    expect(methodologyRepository.statusWrites).toEqual(['review'])
    expect(withdrawn.packs[0]?.inUse).toBe(false)

    const restored = await service.signOff({
      packKey: 'schooling-by-design',
      packVersion: '1',
      note: null,
      verdicts: pack.criteria.map((criterion) => ({
        criterionStableKey: criterion.id,
        verdict: 'usable' as const,
        note: null,
      })),
    })
    if (restored.state !== 'ready') throw new Error('expected a ready workbench')
    expect(methodologyRepository.statusWrites).toEqual(['review', 'active'])
    expect(restored.packs[0]?.inUse).toBe(true)
    expect(restored.packs[0]?.review?.decisionLabel).toBe('全部可以用于判断')
  })

  it('keeps a vetoed pack out of use after the content drifts instead of silently reviving it', async () => {
    const reviewRepository = new InMemoryReviewRepository()
    const reviewed = sbdPack()
    await signOffEveryCriterion(reviewed, reviewRepository, 'needs_revision')

    // The drifted content is persisted as withdrawn, exactly as the sign-off left it.
    const drifted = retranslatedPack()
    const view = await serviceFor([drifted], reviewRepository, 'review').getWorkbench()
    if (view.state !== 'ready') throw new Error('expected a ready workbench')

    expect(view.packs[0]?.review?.outdated).toBe(true)
    expect(view.packs[0]?.inUse).toBe(false)
    expect(view.packs[0]?.statusDetail).toBe(
      '你上次要求修订之后，这份内容又有改动。在你重新看过之前，它不会用于正式判断。',
    )
  })

  it('reports a pack as in use only when the file and the local database agree', async () => {
    const active = packWithStatus(sbdPack(), 'active')
    const bothActive = await serviceFor(
      [active],
      new InMemoryReviewRepository(),
      'active',
    ).getWorkbench()
    const fileOnly = await serviceFor(
      [active],
      new InMemoryReviewRepository(),
      'review',
    ).getWorkbench()
    if (bothActive.state !== 'ready' || fileOnly.state !== 'ready') {
      throw new Error('expected ready workbenches')
    }

    expect(bothActive.packs[0]?.inUse).toBe(true)
    expect(bothActive.packs[0]?.statusDetail).toBe('正在用于正式判断。')
    expect(fileOnly.packs[0]?.inUse).toBe(false)
  })

  it('describes an unavailable methodology surface without technical vocabulary', () => {
    const view = unavailableMethodologyWorkbench('ENOENT: no such file or directory')

    expect(view).toEqual({
      state: 'unavailable',
      message: '方法论内容暂时读不到，工作台其他部分不受影响。',
      detail: 'ENOENT: no such file or directory',
    })
  })
})
