import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
  PendingProposalReview,
  ReviewOutcome,
} from '@school-workbench/domain'
import { describe, expect, it } from 'vitest'
import { JudgmentService } from './judgment-service'

function proposal(overrides: Partial<DiagnosisProposal> = {}): DiagnosisProposal {
  return {
    id: 'proposal-1',
    schoolId: 'school-1',
    agentRunId: 'run-1',
    type: 'state',
    title: '中层任务拆解仍依赖校长',
    scopeJson: JSON.stringify({ kind: 'school', schoolId: 'school-1' }),
    interpretations: ['同一现象在两次会议里重复出现。'],
    provisionalJudgment: '中层独立任务转译能力尚未稳定表现出来。',
    mechanism: '关键决策仍集中在校长身上，中层缺少独立承担的机会。',
    alternativeHypotheses: ['也可能只是这两周的临时安排。'],
    unresolvedQuestions: ['下一轮同类任务是否仍然如此？'],
    recommendedActions: ['把下一次任务拆解交给中层主导。'],
    nextObservations: ['观察下一次中层会议的分工记录。'],
    impactEvidencePlan: ['比较下一轮任务记录里校长的介入次数。'],
    evidenceQuality: { directness: 'high', triangulated: true },
    confidence: 'medium',
    status: 'proposed',
    createdAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  }
}

function pendingReview(target: DiagnosisProposal): PendingProposalReview {
  return {
    proposal: target,
    schoolName: '南山实验学校',
    stageTitle: '中层承接机制建立',
    evidence: [
      {
        id: 'e1',
        schoolId: target.schoolId,
        sourceType: 'feishu_doc',
        uri: 'https://example.invalid/doc',
        inlineText: null,
        title: '《8月中层会议纪要》',
        locatorJson: '{}',
        contentHash: null,
        capturedAt: '2026-08-16T00:00:00.000Z',
        registeredBy: 'agent',
        agentRunId: 'run-1',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    supportingFacts: [
      {
        id: 'f1',
        schoolId: target.schoolId,
        evidenceId: 'e1',
        factType: 'organization',
        text: '会议记录里的三项关键任务都由校长拆解。',
        locatorJson: '{}',
        directness: 'high',
        extractedBy: 'agent',
        agentRunId: 'run-1',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    counterFacts: [
      {
        id: 'f2',
        schoolId: target.schoolId,
        evidenceId: 'e1',
        factType: 'organization',
        text: '其中一项任务由年级组长独立完成了拆解。',
        locatorJson: '{}',
        directness: 'medium',
        extractedBy: 'agent',
        agentRunId: 'run-1',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    claims: [
      {
        id: 'c1',
        schoolId: target.schoolId,
        subjectRefJson: '{}',
        predicateKey: 'swb:claim.practice',
        objectRefJson: null,
        statement: '关键任务的拆解仍主要由校长完成。',
        validFrom: null,
        validTo: null,
        scopeJson: '{}',
        createdBy: 'agent',
        agentRunId: 'run-1',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    criteria: [
      {
        id: 'criterion-row-1',
        stableKey: 'DW.C2.PRACTICE_VISIBILITY',
        title: '实践可见性',
        description: '成人实践的改变是否可被观察到。',
        packTitle: 'Data Wise',
        packKey: 'data-wise',
        packVersion: '3',
      },
    ],
    stageTargets: [
      {
        id: 'target-1',
        dimensionKey: 'key_tasks',
        title: '关键任务',
        description: '中层开始独立完成任务转译。',
      },
    ],
  }
}

class StubJudgmentRepository implements JudgmentRepository {
  outcome: ReviewOutcome | null = null

  constructor(
    private readonly review: PendingProposalReview | null,
    private readonly proposalIdByRun: string | null,
  ) {}

  async findProposal(id: string): Promise<DiagnosisProposal | null> {
    return this.review && this.review.proposal.id === id ? this.review.proposal : null
  }
  async saveReviewOutcome(outcome: ReviewOutcome): Promise<void> {
    this.outcome = outcome
  }
  async listAcceptedJudgments(): Promise<AcceptedJudgment[]> {
    return this.outcome?.acceptedJudgment ? [this.outcome.acceptedJudgment] : []
  }
  async findPendingProposalReview(id: string): Promise<PendingProposalReview | null> {
    return this.review && this.review.proposal.id === id ? this.review : null
  }
  async findLatestProposalIdByAgentRun(): Promise<string | null> {
    return this.proposalIdByRun
  }
}

describe('JudgmentService', () => {
  it('has no way to create a judgement of its own', () => {
    const service = new JudgmentService(new StubJudgmentRepository(null, null))
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service) as object)
    expect(surface.sort()).toEqual(['constructor', 'findAgentRunOutcome', 'listAccepted', 'review'])
  })

  it('renders an assistant judgement with everything PRD 18 asks the consultant to audit', async () => {
    const target = proposal()
    const service = new JudgmentService(
      new StubJudgmentRepository(pendingReview(target), target.id),
    )

    const outcome = await service.findAgentRunOutcome('school-1', 'run-1')
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const { view } = outcome
    expect(view.source).toBe('assistant')
    expect(view.facts[0]?.text).toContain('校长')
    expect(view.counterFacts).toHaveLength(1)
    expect(view.evidence[0]?.sourceLabel).toBe('飞书文档')
    expect(view.evidence[0]?.uri).toBe('https://example.invalid/doc')
    expect(view.proposal.mechanism).toContain('关键决策')
    expect(view.proposal.alternativeHypotheses).toHaveLength(1)
    expect(view.proposal.unresolvedQuestions).toHaveLength(1)
    expect(view.proposal.proposedActions).toHaveLength(1)
    expect(view.proposal.recommendedObservations).toHaveLength(1)
    expect(view.proposal.impactMeasures).toHaveLength(1)
    expect(view.grounding.schoolName).toBe('南山实验学校')
    expect(view.grounding.stageTitle).toBe('中层承接机制建立')
    expect(view.grounding.stageTargets[0]?.label).toBe('关键任务')
    expect(view.grounding.criteria[0]?.packTitle).toBe('Data Wise')
    expect(view.grounding.criteria[0]?.packVersion).toBe('3')
  })

  it('reports an abstention as an abstention and never as a judgement', async () => {
    const target = proposal({
      status: 'insufficient_evidence',
      provisionalJudgment: null,
      unresolvedQuestions: ['还缺一条可定位的独立材料。'],
      nextObservations: ['再观察一次同类会议。'],
    })
    const service = new JudgmentService(
      new StubJudgmentRepository(pendingReview(target), target.id),
    )

    const outcome = await service.findAgentRunOutcome('school-1', 'run-1')
    expect(outcome.kind).toBe('insufficient_evidence')
    if (outcome.kind !== 'insufficient_evidence') throw new Error('expected an abstention')
    expect(outcome.nextObservations).toEqual(['再观察一次同类会议。'])
    expect(Reflect.get(outcome, 'view')).toBeUndefined()
  })

  it('does not hand one school a judgement that belongs to another', async () => {
    const target = proposal()
    const service = new JudgmentService(
      new StubJudgmentRepository(pendingReview(target), target.id),
    )
    expect(await service.findAgentRunOutcome('school-2', 'run-1')).toEqual({ kind: 'none' })
  })

  it('keeps the consultant feedback alongside the final text when a judgement is rewritten', async () => {
    const target = proposal()
    const repository = new StubJudgmentRepository(pendingReview(target), target.id)
    const service = new JudgmentService(repository)

    await service.review({
      schoolId: 'school-1',
      diagnosisId: target.id,
      decision: 'modified',
      feedback: '不是中层不会拆，是校长一直没有真正放权。',
      finalText: '中层已表现出基础拆解能力，但校长仍持续承担关键决策。',
    })

    expect(repository.outcome?.review.feedback).toContain('放权')
    expect(repository.outcome?.review.finalText).toContain('关键决策')
    expect(repository.outcome?.acceptedJudgment?.statement).toContain('关键决策')
  })
})
