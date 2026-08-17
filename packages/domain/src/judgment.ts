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

export type ProposalChain = {
  evidence: Evidence[]
  facts: ObservationFact[]
  claims: Claim[]
  claimFacts: ClaimFact[]
  proposal: DiagnosisProposal
  diagnosisClaims: DiagnosisClaim[]
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

export type AssessmentDraft = {
  title: string
  observationText: string
  factType?: ObservationFact['factType']
  claimText: string
  interpretations: string[]
  provisionalJudgment: string
  mechanism?: string
  alternativeHypotheses?: string[]
  unresolvedQuestions?: string[]
  proposedActions?: string[]
  recommendedObservations?: string[]
  impactMeasures?: string[]
  evidenceQuality: EvidenceQuality
  confidence: 'low' | 'medium' | 'high'
}

export type JudgmentFactoryDependencies = {
  createId(): string
  now(): Date
}

const defaultDependencies: JudgmentFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

export function createProposalChain(
  schoolId: string,
  sourceText: string,
  draft: AssessmentDraft,
  dependencies: JudgmentFactoryDependencies = defaultDependencies,
): ProposalChain {
  const createdAt = dependencies.now().toISOString()
  const evidenceId = dependencies.createId()
  const factId = dependencies.createId()
  const claimId = dependencies.createId()
  const proposalId = dependencies.createId()
  const schoolScope = JSON.stringify({ kind: 'school', schoolId })

  const evidence: Evidence = {
    id: evidenceId,
    schoolId,
    sourceType: 'pasted_text',
    uri: null,
    inlineText: sourceText,
    title: '顾问输入',
    locatorJson: JSON.stringify({ kind: 'inline_text' }),
    contentHash: null,
    capturedAt: createdAt,
    registeredBy: 'human',
    agentRunId: null,
    createdAt,
  }

  const fact: ObservationFact = {
    id: factId,
    schoolId,
    evidenceId,
    factType: draft.factType ?? 'context',
    text: draft.observationText,
    locatorJson: JSON.stringify({ kind: 'inline_text' }),
    directness: draft.evidenceQuality.directness,
    extractedBy: 'agent',
    agentRunId: null,
    createdAt,
  }

  const claim: Claim = {
    id: claimId,
    schoolId,
    subjectRefJson: schoolScope,
    predicateKey: 'swb:claim.current_situation',
    objectRefJson: null,
    statement: draft.claimText,
    validFrom: createdAt,
    validTo: null,
    scopeJson: schoolScope,
    createdBy: 'agent',
    agentRunId: null,
    createdAt,
  }

  const proposal: DiagnosisProposal = {
    id: proposalId,
    schoolId,
    agentRunId: null,
    type: 'state',
    title: draft.title,
    scopeJson: schoolScope,
    interpretations: draft.interpretations,
    provisionalJudgment: draft.provisionalJudgment,
    mechanism: draft.mechanism ?? null,
    alternativeHypotheses: draft.alternativeHypotheses ?? [],
    unresolvedQuestions: draft.unresolvedQuestions ?? [],
    recommendedActions: draft.proposedActions ?? [],
    nextObservations: draft.recommendedObservations ?? [],
    impactEvidencePlan: draft.impactMeasures ?? [],
    evidenceQuality: draft.evidenceQuality,
    confidence: draft.confidence,
    status: 'proposed',
    createdAt,
  }

  return {
    evidence: [evidence],
    facts: [fact],
    claims: [claim],
    claimFacts: [{ claimId, factId, stance: 'supporting', sequence: 0 }],
    proposal,
    diagnosisClaims: [{ proposalId, claimId }],
  }
}

export function assertReviewDecisionAllowed(
  proposal: DiagnosisProposal,
  decision: HumanReview['decision'],
): void {
  if (
    proposal.status === 'insufficient_evidence' &&
    (decision === 'accepted' || decision === 'modified')
  ) {
    throw new DiagnosisReviewInvariantError(
      '证据不足的判断只能被拒绝或标记为需要补充更多依据',
    )
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
    input.decision === 'modified'
      ? input.finalText!.trim()
      : proposal.provisionalJudgment!.trim()

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

export interface JudgmentRepository {
  saveProposalChain(chain: ProposalChain): Promise<void>
  findProposal(id: string): Promise<DiagnosisProposal | null>
  saveReviewOutcome(outcome: ReviewOutcome): Promise<void>
  listAcceptedJudgments(schoolId: string): Promise<AcceptedJudgment[]>
}
