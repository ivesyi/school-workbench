import {
  createReviewOutcome,
  type JudgmentRepository,
  type PendingProposalReview,
} from '@school-workbench/domain'
import {
  reviewDiagnosisInputSchema,
  schoolIdSchema,
  type AcceptedJudgmentView,
  type EvidenceReferenceView,
  type JudgmentGroundingView,
  type JudgmentReviewView,
  type ReviewDiagnosisInput,
  type ReviewOutcomeView,
} from '@school-workbench/shared'

export type AgentRunJudgmentOutcome =
  | Readonly<{ kind: 'proposal'; view: JudgmentReviewView }>
  | Readonly<{
      kind: 'insufficient_evidence'
      unresolvedQuestions: readonly string[]
      nextObservations: readonly string[]
    }>
  | Readonly<{ kind: 'none' }>

/**
 * PRD 21: internally this is Evidence, to the consultant it is 依据, and where
 * it came from is said in words rather than in a column value.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  feishu_doc: '飞书文档',
  feishu_minutes: '飞书妙记',
  audio: '录音',
  local_file: '本地文件',
  observation: '现场观察',
  pasted_text: '直接提供的材料',
  other: '其他材料',
})

function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? '其他材料'
}

function toEvidenceView(item: PendingProposalReview['evidence'][number]): EvidenceReferenceView {
  return {
    id: item.id,
    title: item.title,
    sourceType: item.sourceType,
    sourceLabel: sourceLabel(item.sourceType),
    uri: item.uri,
    excerpt: item.inlineText,
  }
}

function toGrounding(review: PendingProposalReview): JudgmentGroundingView {
  return {
    schoolName: review.schoolName,
    stageTitle: review.stageTitle,
    stageTargets: review.stageTargets.map((target) => ({
      id: target.id,
      dimensionKey:
        target.dimensionKey as JudgmentGroundingView['stageTargets'][number]['dimensionKey'],
      label: target.title,
      text: target.description,
    })),
    criteria: review.criteria.map((criterion) => ({
      id: criterion.id,
      stableKey: criterion.stableKey,
      title: criterion.title,
      description: criterion.description,
      packTitle: criterion.packTitle,
      packVersion: criterion.packVersion,
    })),
  }
}

/**
 * Renders a judgement an assistant submitted into the review surface.
 *
 * This is the only shape a pending judgement ever takes, because the assistant
 * is the only thing that can produce one: the workbench has no engine of its
 * own and no second persistence path.
 */
function toAssistantReviewView(review: PendingProposalReview): JudgmentReviewView | null {
  const { proposal } = review
  // An abstention has nothing to accept — the domain forbids turning it into a
  // judgement — so it never reaches the review surface.
  if (proposal.status !== 'proposed' || !proposal.provisionalJudgment) return null

  return {
    evidence: review.evidence.map(toEvidenceView),
    facts: review.supportingFacts.map((item) => ({
      id: item.id,
      text: item.text,
      directness: item.directness,
      evidenceId: item.evidenceId,
    })),
    counterFacts: review.counterFacts.map((item) => ({
      id: item.id,
      text: item.text,
      directness: item.directness,
      evidenceId: item.evidenceId,
    })),
    source: 'assistant',
    claims: review.claims.map((item) => ({ id: item.id, text: item.statement })),
    grounding: toGrounding(review),
    proposal: {
      id: proposal.id,
      title: proposal.title,
      interpretations: proposal.interpretations,
      provisionalJudgment: proposal.provisionalJudgment,
      mechanism: proposal.mechanism,
      alternativeHypotheses: proposal.alternativeHypotheses,
      unresolvedQuestions: proposal.unresolvedQuestions,
      proposedActions: proposal.recommendedActions,
      recommendedObservations: proposal.nextObservations,
      impactMeasures: proposal.impactEvidencePlan,
      evidenceQuality: proposal.evidenceQuality,
      confidence: proposal.confidence,
      evidenceCount: review.evidence.length,
      status: 'proposed',
      createdAt: proposal.createdAt,
    },
  }
}

/**
 * Everything the consultant does with a judgement after an assistant proposed
 * one: read it, accept it, rewrite it, or throw it away.
 *
 * Notably absent: any way to *make* one. Creating a DiagnosisProposal belongs
 * to `GroundedDiagnosisService` alone, behind the strict assessment contract.
 */
export class JudgmentService {
  constructor(private readonly judgmentRepository: JudgmentRepository) {}

  async review(input: ReviewDiagnosisInput): Promise<ReviewOutcomeView> {
    const parsed = reviewDiagnosisInputSchema.parse(input)
    const proposal = await this.judgmentRepository.findProposal(parsed.diagnosisId)
    if (!proposal || proposal.schoolId !== parsed.schoolId) {
      throw new Error('没有找到这个待确认判断')
    }

    const outcome = createReviewOutcome(proposal, {
      decision: parsed.decision,
      ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
      ...(parsed.finalText ? { finalText: parsed.finalText } : {}),
    })
    await this.judgmentRepository.saveReviewOutcome(outcome)

    return {
      decision: outcome.review.decision,
      acceptedJudgment: outcome.acceptedJudgment
        ? {
            id: outcome.acceptedJudgment.id,
            proposalId: outcome.acceptedJudgment.proposalId,
            text: outcome.acceptedJudgment.statement,
            createdAt: outcome.acceptedJudgment.createdAt,
          }
        : null,
    }
  }

  /**
   * What a given Agent Run left for the consultant.
   *
   * The three answers are genuinely different things: a judgement to decide on,
   * an explicit "the evidence is not enough yet", and nothing at all. Collapsing
   * the middle one into "nothing" would hide the most professionally useful
   * thing an assistant can say — and nothing else may be produced in its place.
   */
  async findAgentRunOutcome(
    schoolId: string,
    agentRunId: string,
  ): Promise<AgentRunJudgmentOutcome> {
    const proposalId = await this.judgmentRepository.findLatestProposalIdByAgentRun(agentRunId)
    if (!proposalId) return { kind: 'none' }
    const review = await this.judgmentRepository.findPendingProposalReview(proposalId)
    if (!review || review.proposal.schoolId !== schoolId) return { kind: 'none' }
    if (review.proposal.status === 'insufficient_evidence') {
      return {
        kind: 'insufficient_evidence',
        unresolvedQuestions: [...review.proposal.unresolvedQuestions],
        nextObservations: [...review.proposal.nextObservations],
      }
    }
    const view = toAssistantReviewView(review)
    return view ? { kind: 'proposal', view } : { kind: 'none' }
  }

  async listAccepted(schoolId: string): Promise<AcceptedJudgmentView[]> {
    const parsedSchoolId = schoolIdSchema.parse(schoolId)
    const judgments = await this.judgmentRepository.listAcceptedJudgments(parsedSchoolId)
    return judgments.map((item) => ({
      id: item.id,
      proposalId: item.proposalId,
      text: item.statement,
      createdAt: item.createdAt,
    }))
  }
}
