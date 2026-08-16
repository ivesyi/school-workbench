import type {
  CanonicalDimensionKey,
  Criterion,
  DeepReadonly,
  MethodologyPack,
  ResolvedCriterion,
} from './contracts'
import { deepFreeze } from './immutable'
import { validateMethodologyPackHash, validateMethodologyPackStructure } from './validation'

export type CriterionFilter = Readonly<{
  constructId?: string
  dimensionKey?: CanonicalDimensionKey
  practiceType?: string
  packKey?: string
  version?: string
}>

function packRef(pack: MethodologyPack): string {
  return `${pack.key}@${pack.version}`
}

function assertRegistryIdentity(packs: readonly MethodologyPack[]): void {
  const packIds = new Set<string>()
  const packRefs = new Set<string>()
  const stableOwners = new Map<string, string>()

  for (const pack of packs) {
    if (packIds.has(pack.id)) throw new Error(`Duplicate methodology pack id: ${pack.id}`)
    packIds.add(pack.id)

    const ref = packRef(pack)
    if (packRefs.has(ref)) throw new Error(`Duplicate methodology pack version: ${ref}`)
    packRefs.add(ref)

    const stableIds = [
      ...pack.constructs.map((item) => item.id),
      ...pack.criteria.map((item) => item.id),
      ...pack.behaviorAnchors.map((item) => item.id),
    ]
    for (const stableId of stableIds) {
      const owner = stableOwners.get(stableId)
      if (owner && owner !== pack.key) {
        throw new Error(`Stable id ${stableId} is reused by different methodology packs`)
      }
      stableOwners.set(stableId, pack.key)
    }
  }
}

export class MethodologyRegistry {
  readonly #packs: readonly MethodologyPack[]

  constructor(packs: readonly MethodologyPack[]) {
    for (const pack of packs) {
      validateMethodologyPackStructure(pack)
      validateMethodologyPackHash(pack)
    }
    assertRegistryIdentity(packs)
    this.#packs = deepFreeze([...packs])
  }

  listPacks(): readonly MethodologyPack[] {
    return this.#packs
  }

  getPack(key: string, version: string): MethodologyPack | null {
    return this.#packs.find((pack) => pack.key === key && pack.version === version) ?? null
  }

  getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ): ResolvedCriterion | null {
    const matches = this.#packs.flatMap((pack) => {
      if (selector?.packKey && pack.key !== selector.packKey) return []
      if (selector?.version && pack.version !== selector.version) return []
      const criterion = pack.criteria.find((item) => item.id === stableId)
      if (!criterion) return []
      return [this.resolveCriterion(pack, criterion)]
    })

    if (matches.length > 1) {
      throw new Error(`Criterion ${stableId} exists in multiple loaded versions; select a version`)
    }
    return matches[0] ?? null
  }

  findCriteria(filter: CriterionFilter = {}): readonly ResolvedCriterion[] {
    const matches = this.#packs.flatMap((pack) => {
      if (filter.packKey && pack.key !== filter.packKey) return []
      if (filter.version && pack.version !== filter.version) return []
      return pack.criteria
        .filter((criterion) => !filter.constructId || criterion.constructId === filter.constructId)
        .filter(
          (criterion) => !filter.dimensionKey || criterion.dimensionKey === filter.dimensionKey,
        )
        .filter(
          (criterion) => !filter.practiceType || criterion.practiceType === filter.practiceType,
        )
        .map((criterion) => this.resolveCriterion(pack, criterion))
    })
    return deepFreeze(matches)
  }

  private resolveCriterion(pack: MethodologyPack, criterion: Criterion): ResolvedCriterion {
    const evidenceGuidance = pack.evidenceGuidance.find(
      (guidance) => guidance.criterionId === criterion.id,
    )
    if (!evidenceGuidance) throw new Error(`Criterion ${criterion.id} has no evidence guidance`)
    const inferenceGuardrails = pack.inferenceGuardrails.filter(
      (guardrail) => guardrail.scope === 'pack' || guardrail.criterionId === criterion.id,
    )
    return deepFreeze({ criterion, evidenceGuidance, inferenceGuardrails })
  }
}

export function createMethodologyRegistry(
  packs: readonly MethodologyPack[],
): DeepReadonly<MethodologyRegistry> {
  return new MethodologyRegistry(packs) as DeepReadonly<MethodologyRegistry>
}
