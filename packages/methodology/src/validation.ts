import type { MethodologyPack } from './contracts'
import { computePackContentHash } from './hash'

function assertUnique(ids: readonly string[], label: string, pack: MethodologyPack): void {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate ${label} stable id in ${pack.key}@${pack.version}: ${[...new Set(duplicates)].join(', ')}`,
    )
  }
}

function assertNoParentCycle(
  ids: readonly string[],
  parentById: ReadonlyMap<string, string | undefined>,
  label: string,
): void {
  for (const id of ids) {
    const seen = new Set<string>()
    let current: string | undefined = id
    while (current) {
      if (seen.has(current)) throw new Error(`${label} parent cycle detected at ${current}`)
      seen.add(current)
      current = parentById.get(current)
    }
  }
}

export function validateMethodologyPackStructure(pack: MethodologyPack): void {
  assertUnique(
    pack.constructs.map((item) => item.id),
    'construct',
    pack,
  )
  assertUnique(
    pack.criteria.map((item) => item.id),
    'criterion',
    pack,
  )
  assertUnique(
    pack.behaviorAnchors.map((item) => item.id),
    'behavior anchor',
    pack,
  )

  const constructIds = new Set(pack.constructs.map((item) => item.id))
  const criterionIds = new Set(pack.criteria.map((item) => item.id))

  for (const construct of pack.constructs) {
    if (construct.parentId && !constructIds.has(construct.parentId)) {
      throw new Error(`Construct ${construct.id} references unknown parent ${construct.parentId}`)
    }
  }
  assertNoParentCycle(
    pack.constructs.map((item) => item.id),
    new Map(pack.constructs.map((item) => [item.id, item.parentId])),
    'Construct',
  )

  for (const criterion of pack.criteria) {
    if (!constructIds.has(criterion.constructId)) {
      throw new Error(`Criterion ${criterion.id} references unknown construct ${criterion.constructId}`)
    }
    if (criterion.parentId && !criterionIds.has(criterion.parentId)) {
      throw new Error(`Criterion ${criterion.id} references unknown parent ${criterion.parentId}`)
    }
  }
  assertNoParentCycle(
    pack.criteria.map((item) => item.id),
    new Map(pack.criteria.map((item) => [item.id, item.parentId])),
    'Criterion',
  )

  for (const anchor of pack.behaviorAnchors) {
    if (!criterionIds.has(anchor.criterionId)) {
      throw new Error(`Behavior anchor ${anchor.id} references unknown criterion ${anchor.criterionId}`)
    }
  }

  const guidanceIds = pack.evidenceGuidance.map((item) => item.criterionId)
  assertUnique(guidanceIds, 'evidence guidance criterion', pack)
  if (guidanceIds.length !== pack.criteria.length) {
    throw new Error(`Every criterion in ${pack.key}@${pack.version} requires evidence guidance`)
  }
  const unknownGuidanceTarget = guidanceIds.find((id) => !criterionIds.has(id))
  if (unknownGuidanceTarget) {
    throw new Error(`Evidence guidance references unknown criterion ${unknownGuidanceTarget}`)
  }

  for (const guardrail of pack.inferenceGuardrails) {
    if (guardrail.criterionId && !criterionIds.has(guardrail.criterionId)) {
      throw new Error(`Inference guardrail references unknown criterion ${guardrail.criterionId}`)
    }
  }
}

export function validateMethodologyPackHash(pack: MethodologyPack): void {
  const contentHash = computePackContentHash(pack)
  if (contentHash !== pack.canonicalContentHash.value) {
    throw new Error(`Canonical content hash mismatch for ${pack.key}@${pack.version}`)
  }
}
