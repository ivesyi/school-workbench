import { describe, expect, it } from 'vitest'
import { createReviewOutcome, type DiagnosisProposal } from './judgment'

function dependencies() {
  let index = 0
  return {
    createId: () => `id-${++index}`,
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  }
}

function proposedProposal(overrides: Partial<DiagnosisProposal> = {}): DiagnosisProposal {
  return {
    id: 'proposal-1',
    schoolId: 'school-1',
    agentRunId: 'run-1',
    type: 'state',
    title: '中层任务拆解仍依赖校长',
    scopeJson: JSON.stringify({ kind: 'school', schoolId: 'school-1' }),
    interpretations: ['这是一条待验证的组织实践解释。'],
    provisionalJudgment: '原判断',
    mechanism: null,
    alternativeHypotheses: [],
    unresolvedQuestions: [],
    recommendedActions: [],
    nextObservations: [],
    impactEvidencePlan: [],
    evidenceQuality: { directness: 'medium', triangulated: false },
    confidence: 'low',
    status: 'proposed',
    createdAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('judgment review invariants', () => {
  it('only creates an accepted judgment after a human accepts or modifies', () => {
    const proposal = proposedProposal()

    const rejected = createReviewOutcome(proposal, { decision: 'rejected' }, dependencies())
    expect(rejected.review.decision).toBe('rejected')
    expect(rejected.acceptedJudgment).toBeNull()

    const needsMoreEvidence = createReviewOutcome(
      proposal,
      { decision: 'needs_more_evidence' },
      dependencies(),
    )
    expect(needsMoreEvidence.review.decision).toBe('needs_more_evidence')
    expect(needsMoreEvidence.acceptedJudgment).toBeNull()

    const modified = createReviewOutcome(
      proposal,
      { decision: 'modified', finalText: '顾问修改后的判断' },
      dependencies(),
    )
    expect(modified.acceptedJudgment?.statement).toBe('顾问修改后的判断')
  })

  it('keeps the assistant judgment, the consultant feedback and the final text', () => {
    const outcome = createReviewOutcome(
      proposedProposal({ provisionalJudgment: 'AI 原本的判断' }),
      {
        decision: 'modified',
        feedback: '不是中层不会拆，是校长一直没有真正放权。',
        finalText: '中层已表现出基础拆解能力，但校长仍持续承担关键决策。',
      },
      dependencies(),
    )

    expect(outcome.review.feedback).toBe('不是中层不会拆，是校长一直没有真正放权。')
    expect(outcome.review.finalText).toBe('中层已表现出基础拆解能力，但校长仍持续承担关键决策。')
    expect(outcome.review.reviewedAt).toBe('2026-08-17T00:00:00.000Z')
    // The proposal itself is immutable: the original judgement survives the edit.
    expect(outcome.acceptedJudgment?.statement).toBe(
      '中层已表现出基础拆解能力，但校长仍持续承担关键决策。',
    )
  })

  it('never accepts or modifies an insufficient-evidence proposal', () => {
    const proposal = proposedProposal({
      id: 'proposal-insufficient',
      title: '还需要更多依据',
      interpretations: [],
      provisionalJudgment: null,
      unresolvedQuestions: ['还缺什么可观察事实？'],
      nextObservations: ['补充一次可定位观察。'],
      evidenceQuality: { directness: 'low', triangulated: false },
      status: 'insufficient_evidence',
    })

    expect(() => createReviewOutcome(proposal, { decision: 'accepted' }, dependencies())).toThrow(
      /证据不足/,
    )
    expect(() =>
      createReviewOutcome(
        proposal,
        { decision: 'modified', finalText: '不能绕过证据门槛' },
        dependencies(),
      ),
    ).toThrow(/证据不足/)
    expect(
      createReviewOutcome(proposal, { decision: 'needs_more_evidence' }, dependencies())
        .acceptedJudgment,
    ).toBeNull()
  })
})
