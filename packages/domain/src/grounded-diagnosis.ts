import { ulid } from 'ulid'
import type { DiagnosisProposal, EvidenceQuality } from './judgment'

export type GroundedDiagnosisCriterionRef = Readonly<{
  criterionId: string
  packKey: string
  version: string
  stableKey: string
}>

export type GroundedDiagnosisRecord = Readonly<{
  proposal: DiagnosisProposal
  claimIds: readonly string[]
  criteria: readonly GroundedDiagnosisCriterionRef[]
  stageTargetIds: readonly string[]
}>

export type GroundedDiagnosisDraft = Readonly<{
  /** The Agent Run that produced this proposal, when one did. */
  agentRunId?: string | null
  interpretations: readonly string[]
  provisionalJudgment: string | null
  mechanism: string | null
  alternativeHypotheses: readonly string[]
  unresolvedQuestions: readonly string[]
  recommendedActions: readonly string[]
  nextObservations: readonly string[]
  impactEvidencePlan: readonly string[]
  evidenceQuality: EvidenceQuality
  confidence: DiagnosisProposal['confidence']
  status: DiagnosisProposal['status']
}>

export type GroundedDiagnosisFactoryDependencies = Readonly<{
  createId(): string
  now(): Date
}>

const defaultDependencies: GroundedDiagnosisFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

export function createGroundedDiagnosisProposal(
  schoolId: string,
  type: DiagnosisProposal['type'],
  title: string,
  draft: GroundedDiagnosisDraft,
  dependencies: GroundedDiagnosisFactoryDependencies = defaultDependencies,
): DiagnosisProposal {
  if (draft.status === 'proposed' && !draft.provisionalJudgment?.trim()) {
    throw new Error('proposed diagnosis requires provisional judgment')
  }
  if (draft.status === 'insufficient_evidence' && draft.provisionalJudgment !== null) {
    throw new Error('insufficient-evidence diagnosis must not carry provisional judgment')
  }

  return {
    id: dependencies.createId(),
    schoolId,
    agentRunId: draft.agentRunId ?? null,
    type,
    title: title.trim(),
    scopeJson: JSON.stringify({ kind: 'school', schoolId }),
    interpretations: [...draft.interpretations],
    provisionalJudgment: draft.provisionalJudgment,
    mechanism: draft.mechanism,
    alternativeHypotheses: [...draft.alternativeHypotheses],
    unresolvedQuestions: [...draft.unresolvedQuestions],
    recommendedActions: [...draft.recommendedActions],
    nextObservations: [...draft.nextObservations],
    impactEvidencePlan: [...draft.impactEvidencePlan],
    evidenceQuality: { ...draft.evidenceQuality },
    confidence: draft.confidence,
    status: draft.status,
    createdAt: dependencies.now().toISOString(),
  }
}
