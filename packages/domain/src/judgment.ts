import { ulid } from 'ulid'

export type Evidence = {
  id: string
  schoolId: string
  sourceType:
    | 'feishu_doc'
    | 'feishu_minutes'
    | 'audio'
    | 'local_file'
    | 'observation'
    | 'pasted_text'
    | 'other'
  uri: string | null
  inlineText: string | null
  title: string
  locatorJson: string | null
  contentHash: string | null
  capturedAt: string | null
  registeredBy: 'agent' | 'human'
  agentRunId: string | null
  createdAt: string
}

export type ObservationFact = {
  id: string
  schoolId: string
  evidenceId: string
  factType: 'learner' | 'adult_practice' | 'organization' | 'context'
  text: string
  locatorJson: string
  directness: 'low' | 'medium' | 'high'
  extractedBy: 'agent' | 'human'
  agentRunId: string | null
  createdAt: string
}

export type Claim = {
  id: string
  schoolId: string
  subjectRefJson: string
  predicateKey: string
  objectRefJson: string | null
  statement: string
  validFrom: string | null
  validTo: string | null
  scopeJson: string
  createdBy: 'agent' | 'human'
  agentRunId: string | null
  createdAt: string
}

export type ClaimFact = {
  claimId: string
  factId: string
  stance: 'supporting' | 'counter'
  sequence: number
}

export type EvidenceQuality = {
  directness: 'low' | 'medium' | 'high'
  triangulated: boolean
  notes?: string
}

export type DiagnosisProposal = {
  id: string
  schoolId: string
  agentRunId: string | null
  type: 'state' | 'characteristic' | 'mismatch' | 'practice'
  title: string
  scopeJson: string
  interpretations: string[]
  provisionalJudgment: string | null
  mechanism: string | null
  alternativeHypotheses: string[]
  unresolvedQuestions: string[]
  recommendedActions: string[]
  nextObservations: string[]
  impactEvidencePlan: string[]
  evidenceQuality: EvidenceQuality
  confidence: 'low' | 'medium' | 'high'
  status: 'proposed' | 'insufficient_evidence'
  createdAt: string
}

export type DiagnosisClaim = {
  proposalId: string
  claimId: string
}

export type HumanReview = {
  id: string
  proposalId: string
  decision: 'accepted' | 'modified' | 'rejected' | 'needs_more_evidence'
  feedback: string | null
  finalText: string | null
  reason: string | null
  reviewedAt: string
}

export type AcceptedJudgment = {
  id: string
  schoolId: string
  proposalId: string
  reviewId: string
  statement: string
  scopeJson: string
  validFrom: string | null
  validTo: string | null
  createdAt: string
}

export type ReviewOutcome = {
  review: HumanReview
  acceptedJudgment: AcceptedJudgment | null
}

export class DiagnosisReviewInvariantError extends Error {
  readonly code = 'DIAGNOSIS_REVIEW_DECISION_NOT_ALLOWED' as const

  constructor(message: string) {
    super(message)
    this.name = 'DiagnosisReviewInvariantError'
  }
}

export type JudgmentFactoryDependencies = {
  createId(): string
  now(): Date
}

const defaultDependencies: JudgmentFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

export function assertReviewDecisionAllowed(
  proposal: DiagnosisProposal,
  decision: HumanReview['decision'],
): void {
  if (
    proposal.status === 'insufficient_evidence' &&
    (decision === 'accepted' || decision === 'modified')
  ) {
    throw new DiagnosisReviewInvariantError('证据不足的判断只能被拒绝或标记为需要补充更多依据')
  }
  if (
    proposal.status === 'proposed' &&
    (decision === 'accepted' || decision === 'modified') &&
    !proposal.provisionalJudgment?.trim()
  ) {
    throw new DiagnosisReviewInvariantError('待确认判断缺少可接受的暂定判断文本')
  }
}

export function createReviewOutcome(
  proposal: DiagnosisProposal,
  input: {
    decision: HumanReview['decision']
    feedback?: string
    finalText?: string
    reason?: string
  },
  dependencies: JudgmentFactoryDependencies = defaultDependencies,
): ReviewOutcome {
  assertReviewDecisionAllowed(proposal, input.decision)

  const reviewedAt = dependencies.now().toISOString()
  const reviewId = dependencies.createId()

  if (input.decision === 'modified' && !input.finalText?.trim()) {
    throw new Error('请写下你确认后的判断')
  }

  const review: HumanReview = {
    id: reviewId,
    proposalId: proposal.id,
    decision: input.decision,
    feedback: input.feedback?.trim() || null,
    finalText: input.finalText?.trim() || null,
    reason: input.reason?.trim() || null,
    reviewedAt,
  }

  if (input.decision === 'rejected' || input.decision === 'needs_more_evidence') {
    return { review, acceptedJudgment: null }
  }

  const statement =
    input.decision === 'modified' ? input.finalText!.trim() : proposal.provisionalJudgment!.trim()

  return {
    review,
    acceptedJudgment: {
      id: dependencies.createId(),
      schoolId: proposal.schoolId,
      proposalId: proposal.id,
      reviewId,
      statement,
      scopeJson: proposal.scopeJson,
      validFrom: reviewedAt,
      validTo: null,
      createdAt: reviewedAt,
    },
  }
}

/**
 * A proposal that is still waiting for the consultant, together with the chain
 * it rests on.
 *
 * The workbench needs this to show a judgement an assistant submitted earlier
 * through its own channel: unlike the deterministic path, that judgement is not
 * already in hand when the review surface renders it.
 */
export type PendingProposalReview = {
  proposal: DiagnosisProposal
  /** Named so the review surface can state which school this is about. */
  schoolName: string
  /** The confirmed stage the judgement was measured against. */
  stageTitle: string
  evidence: Evidence[]
  supportingFacts: ObservationFact[]
  counterFacts: ObservationFact[]
  claims: Claim[]
  criteria: PendingProposalCriterion[]
  stageTargets: PendingProposalStageTarget[]
}

/**
 * The versioned methodology criterion a proposal was measured against.
 *
 * Carried through to the consultant because PRD 5.7 makes a judgement auditable
 * only if the standard behind it can be named, and the standard is versioned.
 */
export type PendingProposalCriterion = {
  id: string
  stableKey: string
  title: string
  description: string
  packTitle: string
  packKey: string
  packVersion: string
}

export type PendingProposalStageTarget = {
  id: string
  dimensionKey: string
  title: string
  description: string
}

/**
 * Reading and reviewing judgements.
 *
 * There is deliberately no way to *create* a proposal here. A DiagnosisProposal
 * can only be produced by `GroundedDiagnosisService`, which refuses anything
 * that has not passed the strict assessment contract, so no second persistence
 * route exists for the workbench to fall back on.
 */
export interface JudgmentRepository {
  findProposal(id: string): Promise<DiagnosisProposal | null>
  saveReviewOutcome(outcome: ReviewOutcome): Promise<void>
  listAcceptedJudgments(schoolId: string): Promise<AcceptedJudgment[]>
  /** The pending proposal and its chain, or null once it has been reviewed. */
  findPendingProposalReview(proposalId: string): Promise<PendingProposalReview | null>
  /** The newest proposal a given Agent Run submitted, if it submitted one. */
  findLatestProposalIdByAgentRun(agentRunId: string): Promise<string | null>
}
