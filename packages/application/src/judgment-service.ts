import {
  createProposalChain,
  createReviewOutcome,
  type AssessmentDraft,
  type JudgmentRepository,
  type ProposalChain,
  type SchoolRepository,
} from '@school-workbench/domain'
import {
  reviewDiagnosisInputSchema,
  schoolIdSchema,
  submitSituationInputSchema,
  type AcceptedJudgmentView,
  type JudgmentReviewView,
  type ReviewDiagnosisInput,
  type ReviewOutcomeView,
  type SubmitSituationInput,
} from '@school-workbench/shared'

export interface AssessmentEngine {
  analyze(text: string): Promise<AssessmentDraft>
}

export class BaselineAssessmentEngine implements AssessmentEngine {
  async analyze(text: string): Promise<AssessmentDraft> {
    const normalized = text.trim()
    return {
      title: '一个新的情况',
      observationText: `顾问报告：“${normalized}”`,
      factType: 'context',
      claimText: `当前有迹象表明：${normalized}`,
      interpretations: ['目前只有顾问的一条直接报告，尚不能把报告内容本身当作已验证事实。'],
      provisionalJudgment: normalized,
      alternativeHypotheses: ['这可能只是一次局部现象，还不能代表稳定状态。'],
      unresolvedQuestions: ['还有没有独立材料支持或反驳这条判断？'],
      proposedActions: [],
      recommendedObservations: ['寻找至少一条独立材料进行交叉验证。'],
      impactMeasures: [],
      evidenceQuality: {
        directness: 'medium',
        triangulated: false,
        notes: '单一顾问输入，尚未完成交叉验证。',
      },
      confidence: 'low',
    }
  }
}

function toReviewView(chain: ProposalChain): JudgmentReviewView {
  if (chain.proposal.status !== 'proposed' || !chain.proposal.provisionalJudgment) {
    throw new Error('工作台待确认判断必须包含暂定判断文本')
  }

  return {
    evidence: chain.evidence.map((item) => ({
      id: item.id,
      title: item.title,
      sourceType: item.sourceType,
    })),
    facts: chain.facts.map((item) => ({
      id: item.id,
      text: item.text,
      directness: item.directness,
    })),
    claims: chain.claims.map((item) => ({
      id: item.id,
      text: item.statement,
    })),
    proposal: {
      id: chain.proposal.id,
      title: chain.proposal.title,
      interpretations: chain.proposal.interpretations,
      provisionalJudgment: chain.proposal.provisionalJudgment,
      alternativeHypotheses: chain.proposal.alternativeHypotheses,
      unresolvedQuestions: chain.proposal.unresolvedQuestions,
      proposedActions: chain.proposal.recommendedActions,
      recommendedObservations: chain.proposal.nextObservations,
      impactMeasures: chain.proposal.impactEvidencePlan,
      evidenceQuality: chain.proposal.evidenceQuality,
      confidence: chain.proposal.confidence,
      evidenceCount: chain.evidence.length,
      status: 'proposed',
      createdAt: chain.proposal.createdAt,
    },
  }
}

export class JudgmentService {
  constructor(
    private readonly schoolRepository: SchoolRepository,
    private readonly judgmentRepository: JudgmentRepository,
    private readonly assessmentEngine: AssessmentEngine = new BaselineAssessmentEngine(),
  ) {}

  async submitSituation(input: SubmitSituationInput): Promise<JudgmentReviewView> {
    const parsed = submitSituationInputSchema.parse(input)
    const school = await this.schoolRepository.findById(parsed.schoolId)
    if (!school || school.archivedAt) throw new Error('没有找到这所学校')

    const draft = await this.assessmentEngine.analyze(parsed.text)
    const chain = createProposalChain(parsed.schoolId, parsed.text, draft)
    await this.judgmentRepository.saveProposalChain(chain)
    return toReviewView(chain)
  }

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
