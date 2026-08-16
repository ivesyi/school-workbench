import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
  ProposalChain,
  ReviewOutcome,
  School,
  SchoolRepository,
} from '@school-workbench/domain'
import { describe, expect, it } from 'vitest'
import { JudgmentService } from './judgment-service'

class MemorySchoolRepository implements SchoolRepository {
  constructor(private readonly school: School) {}
  async save(): Promise<void> {}
  async findById(id: string): Promise<School | null> {
    return id === this.school.id ? this.school : null
  }
  async listActive(): Promise<School[]> {
    return [this.school]
  }
}

class MemoryJudgmentRepository implements JudgmentRepository {
  chain: ProposalChain | null = null
  outcome: ReviewOutcome | null = null

  async saveProposalChain(chain: ProposalChain): Promise<void> {
    this.chain = chain
  }
  async findProposal(id: string): Promise<DiagnosisProposal | null> {
    return this.chain?.proposal.id === id ? this.chain.proposal : null
  }
  async saveReviewOutcome(outcome: ReviewOutcome): Promise<void> {
    this.outcome = outcome
  }
  async listAcceptedJudgments(): Promise<AcceptedJudgment[]> {
    return this.outcome?.acceptedJudgment ? [this.outcome.acceptedJudgment] : []
  }
}

describe('JudgmentService', () => {
  it('does not turn a consultant report directly into an observation fact about reality', async () => {
    const school: School = {
      id: 'school-1',
      name: '南山实验学校',
      createdAt: '2026-08-17T00:00:00.000Z',
      archivedAt: null,
    }
    const judgments = new MemoryJudgmentRepository()
    const service = new JudgmentService(new MemorySchoolRepository(school), judgments)

    const view = await service.submitSituation({
      schoolId: school.id,
      text: '中层仍然依赖校长拆任务。',
    })

    expect(view.facts[0]?.text).toBe('顾问报告：“中层仍然依赖校长拆任务。”')
    expect(view.claims[0]?.text).toContain('当前有迹象表明')
    expect(view.proposal.evidenceQuality.triangulated).toBe(false)
  })
})
