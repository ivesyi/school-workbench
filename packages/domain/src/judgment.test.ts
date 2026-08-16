import { describe, expect, it } from 'vitest'
import { createProposalChain, createReviewOutcome } from './judgment'

function dependencies() {
  let index = 0
  return {
    createId: () => `id-${++index}`,
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  }
}

describe('judgment epistemic chain', () => {
  it('keeps evidence, fact, claim and proposal as distinct records', () => {
    const chain = createProposalChain(
      'school-1',
      '中层会议里仍由校长完成任务拆解。',
      {
        title: '中层任务拆解仍依赖校长',
        observationText: '中层会议里仍由校长完成任务拆解。',
        factType: 'organization',
        claimText: '中层当前可能仍依赖校长完成任务拆解。',
        interpretations: ['这是一条待验证的组织实践解释。'],
        provisionalJudgment: '中层独立任务转译能力尚未稳定表现出来。',
        evidenceQuality: { directness: 'medium', triangulated: false },
        confidence: 'low',
      },
      dependencies(),
    )

    expect(chain.evidence[0]?.inlineText).toContain('校长')
    expect(chain.facts[0]?.text).toContain('会议')
    expect(chain.claims[0]?.statement).toContain('可能')
    expect(chain.proposal.provisionalJudgment).toContain('尚未稳定')
    expect(chain.claimFacts[0]?.stance).toBe('supporting')
  })

  it('only creates an accepted judgment after a human accepts or modifies', () => {
    const chain = createProposalChain(
      'school-1',
      '新的情况',
      {
        title: '新的情况',
        observationText: '新的情况',
        claimText: '暂定判断',
        interpretations: [],
        provisionalJudgment: '原判断',
        evidenceQuality: { directness: 'medium', triangulated: false },
        confidence: 'low',
      },
      dependencies(),
    )

    const rejected = createReviewOutcome(
      chain.proposal,
      { decision: 'rejected' },
      dependencies(),
    )
    expect(rejected.review.decision).toBe('rejected')
    expect(rejected.acceptedJudgment).toBeNull()

    const needsMoreEvidence = createReviewOutcome(
      chain.proposal,
      { decision: 'needs_more_evidence' },
      dependencies(),
    )
    expect(needsMoreEvidence.review.decision).toBe('needs_more_evidence')
    expect(needsMoreEvidence.acceptedJudgment).toBeNull()

    const modified = createReviewOutcome(
      chain.proposal,
      { decision: 'modified', finalText: '顾问修改后的判断' },
      dependencies(),
    )
    expect(modified.acceptedJudgment?.statement).toBe('顾问修改后的判断')
  })
})
