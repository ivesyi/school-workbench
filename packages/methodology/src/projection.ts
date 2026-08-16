import type { EvidenceGuidance, MethodologyPack, MethodologyPackProjection } from './contracts'
import { deepFreeze } from './immutable'

function persistenceGuidance(
  guidance: EvidenceGuidance,
): Omit<EvidenceGuidance, 'criterionId' | 'counterIndicators'> {
  return {
    supportingIndicators: guidance.supportingIndicators,
    insufficientEvidence: guidance.insufficientEvidence,
    counterexampleChecks: guidance.counterexampleChecks,
    collectionPrinciples: guidance.collectionPrinciples,
    adjustmentConditions: guidance.adjustmentConditions,
  }
}

export function projectMethodologyPack(pack: MethodologyPack): MethodologyPackProjection {
  const guidanceByCriterion = new Map(
    pack.evidenceGuidance.map((guidance) => [guidance.criterionId, guidance]),
  )

  const criteria = pack.criteria.map((criterion, index) => {
    const guidance = guidanceByCriterion.get(criterion.id)
    if (!guidance) throw new Error(`Criterion ${criterion.id} has no evidence guidance`)
    return {
      id: `${pack.id}::${criterion.id}`,
      stableKey: criterion.id,
      parentStableKey: criterion.parentId ?? null,
      constructKey: criterion.constructId,
      dimensionKey: criterion.dimensionKey,
      practiceType: criterion.practiceType,
      title: criterion.title,
      description: criterion.description,
      applicability: criterion.applicability,
      evidenceGuidance: persistenceGuidance(guidance),
      counterIndicators: guidance.counterIndicators,
      guardrails: pack.inferenceGuardrails.filter(
        (guardrail) => guardrail.scope === 'pack' || guardrail.criterionId === criterion.id,
      ),
      sourceLocator: criterion.sourceLocator,
      sequence: index + 1,
    }
  })

  const behaviorAnchors = pack.behaviorAnchors.map((anchor, index) => ({
    id: `${pack.id}::${anchor.id}`,
    stableKey: anchor.id,
    criterionStableKey: anchor.criterionId,
    levelKey: anchor.levelKey,
    label: anchor.label,
    description: anchor.description,
    sourceLocator: anchor.sourceLocator,
    sequence: index + 1,
  }))

  return deepFreeze({
    id: pack.id,
    key: pack.key,
    version: pack.version,
    title: pack.title,
    status: pack.status,
    sourceType: pack.sourceType,
    sourceRef: pack.sourceRef,
    sourceFingerprint: pack.sourceFingerprint.value,
    contentHash: pack.canonicalContentHash.value,
    criteria,
    behaviorAnchors,
  })
}
