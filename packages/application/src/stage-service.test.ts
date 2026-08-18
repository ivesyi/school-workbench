import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
  ReviewOutcome,
  School,
  SchoolRepository,
  StageRecommendation,
  StageRepository,
} from '@school-workbench/domain'
import { activateStageRecommendation } from '@school-workbench/domain'
import { describe, expect, it, vi } from 'vitest'
import {
  BaselineStageRecommendationEngine,
  StageService,
  type StageRecommendationEngine,
} from './stage-service'

const school: School = {
  id: 'school-1',
  name: '南山实验学校',
  createdAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
}

function acceptedJudgment(statement: string, id = 'judgment-1'): AcceptedJudgment {
  return {
    id,
    schoolId: school.id,
    proposalId: `proposal-${id}`,
    reviewId: `review-${id}`,
    statement,
    scopeJson: JSON.stringify({ kind: 'school', schoolId: school.id }),
    validFrom: '2026-08-17T00:00:00.000Z',
    validTo: null,
    createdAt: '2026-08-17T00:00:00.000Z',
  }
}

class MemoryStageRepository implements StageRepository {
  recommendation: StageRecommendation | null = null

  async findActive(schoolId: string): Promise<StageRecommendation | null> {
    return this.recommendation?.stage.schoolId === schoolId &&
      this.recommendation.stage.status === 'active'
      ? this.recommendation
      : null
  }

  async findPlanned(schoolId: string): Promise<StageRecommendation | null> {
    return this.recommendation?.stage.schoolId === schoolId &&
      this.recommendation.stage.status === 'planned'
      ? this.recommendation
      : null
  }

  async findById(stageId: string): Promise<StageRecommendation | null> {
    return this.recommendation?.stage.id === stageId ? this.recommendation : null
  }

  async nextSequence(): Promise<number> {
    return this.recommendation ? this.recommendation.stage.sequence + 1 : 1
  }

  async savePlanned(recommendation: StageRecommendation): Promise<void> {
    this.recommendation = recommendation
  }

  async replacePlanned(recommendation: StageRecommendation): Promise<void> {
    this.recommendation = recommendation
  }

  async activate(
    schoolId: string,
    stageId: string,
    activatedAt: Date,
  ): Promise<StageRecommendation> {
    if (!this.recommendation) throw new Error('missing recommendation')
    if (
      this.recommendation.stage.schoolId !== schoolId ||
      this.recommendation.stage.id !== stageId
    ) {
      throw new Error('wrong stage')
    }
    this.recommendation = activateStageRecommendation(this.recommendation, activatedAt)
    return this.recommendation
  }
}

function schoolRepository(): SchoolRepository {
  return {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(school),
    listActive: vi.fn().mockResolvedValue([school]),
    archive: vi.fn().mockResolvedValue(true),
  }
}

function judgmentRepository(
  judgments: AcceptedJudgment[] | (() => AcceptedJudgment[]),
): JudgmentRepository {
  const current = typeof judgments === 'function' ? judgments : () => judgments
  return {
    findProposal: vi.fn<(id: string) => Promise<DiagnosisProposal | null>>(),
    saveReviewOutcome: vi.fn<(outcome: ReviewOutcome) => Promise<void>>(),
    listAcceptedJudgments: vi.fn().mockImplementation(async () => [...current()]),
    findPendingProposalReview: vi.fn().mockResolvedValue(null),
    findLatestProposalIdByAgentRun: vi.fn().mockResolvedValue(null),
    listPendingProposalReviews: vi.fn().mockResolvedValue([]),
  }
}

const engine: StageRecommendationEngine = {
  recommend: vi.fn().mockImplementation(async (_judgments, feedback?: string) => ({
    title: feedback ? '调整后的阶段' : '建立共同推动改进的组织基础',
    summary: feedback ? '我根据你的补充重新理解了这个阶段。' : '我理解学校正在建立组织基础。',
    focus: feedback ? `现在最需要看到：${feedback}` : '现在最需要看到：中层开始独立承担关键任务。',
    targets: {
      leadership: { title: '领导力', description: '领导目标' },
      key_tasks: { title: '关键任务', description: '关键工作目标' },
      structure: { title: '结构与机制', description: '机制目标' },
      culture: { title: '文化', description: '文化目标' },
      capability: { title: '能力', description: '能力目标' },
    },
  })),
}

describe('BaselineStageRecommendationEngine', () => {
  it('lets explicit teacher-practice feedback override student-focused prior judgments', async () => {
    const baseline = new BaselineStageRecommendationEngine()
    const judgments = [acceptedJudgment('学生学习结果已经出现变化，需要继续观察。')]

    const initial = await baseline.recommend(judgments)
    expect(initial.title).toBe('验证学生学习变化')

    const adjusted = await baseline.recommend(judgments, '目前更需要稳定教研复盘机制')
    expect(adjusted.title).toBe('让改进进入教师实践')
    expect(adjusted.targets.structure.description).toContain('教研、观察和复盘')
  })

  it('supports explicit turns toward organization and student learning', async () => {
    const baseline = new BaselineStageRecommendationEngine()
    const judgments = [acceptedJudgment('教师已经开始共同备课。')]

    await expect(baseline.recommend(judgments, '先稳定中层授权和协作机制')).resolves.toMatchObject({
      title: '建立共同推动改进的组织基础',
    })
    await expect(baseline.recommend(judgments, '现在要验证学生学习变化')).resolves.toMatchObject({
      title: '验证学生学习变化',
    })
  })
})

describe('StageService', () => {
  it('does not propose a stage before there is an accepted judgment', async () => {
    const service = new StageService(
      schoolRepository(),
      judgmentRepository([]),
      new MemoryStageRepository(),
      engine,
    )

    await expect(service.getWorkspace(school.id)).resolves.toEqual({ state: 'none' })
  })

  it('creates, adjusts and confirms a recommendation without a technical form', async () => {
    const stages = new MemoryStageRepository()
    const replaceableEngine: StageRecommendationEngine = {
      recommend: vi.fn(engine.recommend),
    }
    const service = new StageService(
      schoolRepository(),
      judgmentRepository([acceptedJudgment('中层仍然依赖校长完成任务拆解。')]),
      stages,
      replaceableEngine,
    )

    const suggested = await service.getWorkspace(school.id)
    expect(suggested.state).toBe('suggested')
    if (suggested.state !== 'suggested') throw new Error('expected suggestion')

    const adjusted = await service.adjust({
      schoolId: school.id,
      stageId: suggested.stage.id,
      feedback: '现在更应该看教师实践。',
    })
    expect(adjusted.state).toBe('suggested')
    expect(stages.recommendation?.stage.status).toBe('planned')
    expect(
      stages.recommendation?.targets.every((targetItem) => targetItem.status === 'draft'),
    ).toBe(true)

    const active = await service.confirm({ schoolId: school.id, stageId: suggested.stage.id })
    expect(active.state).toBe('active')
    expect(stages.recommendation?.stage.status).toBe('active')
    expect(
      stages.recommendation?.targets.every((targetItem) => targetItem.status === 'confirmed'),
    ).toBe(true)
  })

  it('uses and records the same latest accepted judgments when adjusting a planned stage', async () => {
    const first = acceptedJudgment('中层仍然依赖校长完成任务拆解。', 'judgment-1')
    const second = acceptedJudgment('教师已经开始稳定教研复盘。', 'judgment-2')
    const currentJudgments = [first]
    const stages = new MemoryStageRepository()
    const trackingEngine: StageRecommendationEngine = {
      recommend: vi.fn(engine.recommend),
    }
    const service = new StageService(
      schoolRepository(),
      judgmentRepository(() => currentJudgments),
      stages,
      trackingEngine,
    )

    const suggested = await service.getWorkspace(school.id)
    if (suggested.state !== 'suggested') throw new Error('expected suggestion')
    expect(stages.recommendation?.judgmentIds).toEqual(['judgment-1'])

    currentJudgments.push(second)
    await service.adjust({
      schoolId: school.id,
      stageId: suggested.stage.id,
      feedback: '目前更需要稳定教研复盘机制',
    })

    expect(trackingEngine.recommend).toHaveBeenLastCalledWith(
      [first, second],
      '目前更需要稳定教研复盘机制',
    )
    expect(stages.recommendation?.judgmentIds).toEqual(['judgment-1', 'judgment-2'])
  })
})
