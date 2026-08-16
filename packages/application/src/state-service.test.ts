import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
  ProposalChain,
  ReviewOutcome,
  School,
  SchoolRepository,
  StageRecommendation,
  StageRepository,
  StateRecord,
  StateRepository,
} from '@school-workbench/domain'
import { describe, expect, it, vi } from 'vitest'
import {
  BaselineStateAssessmentEngine,
  StateService,
  type StateAssessmentEngine,
} from './state-service'

const school: School = {
  id: 'school-1',
  name: '南山实验学校',
  createdAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
}

const activeStage: StageRecommendation = {
  stage: {
    id: 'stage-1',
    schoolId: school.id,
    title: '建立共同推动改进的组织基础',
    summary: '阶段摘要',
    focus: '当前最需要看到组织基础逐步稳定。',
    sequence: 1,
    status: 'active',
    startsAt: '2026-08-17T01:00:00.000Z',
    endsAt: null,
    adjustmentFeedback: null,
    createdAt: '2026-08-17T00:30:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  },
  targets: [
    ['leadership', '领导力', '校长从代办转向授权，中层承担真实责任。'],
    ['key_tasks', '关键任务', '关键任务由中层独立拆解、推进和调整。'],
    ['structure', '结构与机制', '形成稳定的分工、推进和复盘机制。'],
    ['culture', '文化', '团队能够公开讨论问题并对结果负责。'],
    ['capability', '能力', '中层能够独立分析、协同推进并复盘。'],
  ].map(([dimensionKey, title, description], index) => ({
    id: `target-${index + 1}`,
    stageId: 'stage-1',
    schoolId: school.id,
    dimensionKey: dimensionKey as StageRecommendation['targets'][number]['dimensionKey'],
    title,
    description,
    status: 'confirmed' as const,
    sequence: index + 1,
    createdAt: '2026-08-17T00:30:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  })),
  judgmentIds: ['judgment-1'],
}

function judgment(id: string, statement: string, createdAt: string): AcceptedJudgment {
  return {
    id,
    schoolId: school.id,
    proposalId: `proposal-${id}`,
    reviewId: `review-${id}`,
    statement,
    scopeJson: JSON.stringify({ kind: 'school', schoolId: school.id }),
    validFrom: createdAt,
    validTo: null,
    createdAt,
  }
}

const judgments = [
  judgment('judgment-2', '教师已经开始稳定教研复盘，能够根据课堂情况调整。', '2026-08-17T02:00:00.000Z'),
  judgment('judgment-1', '中层仍然依赖校长完成关键任务拆解。', '2026-08-17T01:30:00.000Z'),
]

function schoolRepository(): SchoolRepository {
  return {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(school),
    listActive: vi.fn().mockResolvedValue([school]),
  }
}

function judgmentRepository(items = judgments): JudgmentRepository {
  return {
    saveProposalChain: vi.fn<(chain: ProposalChain) => Promise<void>>(),
    findProposal: vi.fn<(id: string) => Promise<DiagnosisProposal | null>>(),
    saveReviewOutcome: vi.fn<(outcome: ReviewOutcome) => Promise<void>>(),
    listAcceptedJudgments: vi.fn().mockResolvedValue(items),
  }
}

class MemoryStageRepository implements StageRepository {
  async findActive(schoolId: string): Promise<StageRecommendation | null> {
    return schoolId === school.id ? activeStage : null
  }
  async findPlanned(): Promise<StageRecommendation | null> {
    return null
  }
  async findById(stageId: string): Promise<StageRecommendation | null> {
    return stageId === activeStage.stage.id ? activeStage : null
  }
  async nextSequence(): Promise<number> {
    return 2
  }
  async savePlanned(): Promise<void> {}
  async replacePlanned(): Promise<void> {}
  async activate(): Promise<StageRecommendation> {
    return activeStage
  }
}

class MemoryStateRepository implements StateRepository {
  record: StateRecord | null = null
  saves = 0

  async findLatest(schoolId: string): Promise<StateRecord | null> {
    return this.record?.snapshot.schoolId === schoolId ? this.record : null
  }

  async saveBaseline(record: StateRecord): Promise<void> {
    if (this.record) throw new Error('已经记录起点状态')
    this.record = record
    this.saves += 1
  }
}

describe('BaselineStateAssessmentEngine', () => {
  it('uses only confirmed stage targets, covers all five dimensions and stays unverified when evidence is absent', async () => {
    const engine = new BaselineStateAssessmentEngine()
    const draft = await engine.assess(activeStage, judgments)

    expect(draft.judgmentIds).toEqual(['judgment-2', 'judgment-1'])
    expect(draft.assessments).toHaveLength(5)
    expect(draft.assessments.map((item) => item.dimensionKey)).toEqual([
      'leadership',
      'key_tasks',
      'structure',
      'culture',
      'capability',
    ])
    expect(draft.assessments.find((item) => item.dimensionKey === 'culture')?.status).toBe(
      'unverified',
    )
    expect(
      draft.assessments
        .filter((item) => item.status !== 'unverified')
        .every((item) => item.judgmentIds.length > 0),
    ).toBe(true)
  })

  it('uses natural-language feedback to reframe a transient dimension assessment', async () => {
    const engine = new BaselineStateAssessmentEngine()
    const initial = await engine.assess(activeStage, judgments)
    expect(initial.assessments.find((item) => item.dimensionKey === 'leadership')?.status).toBe(
      'far_below',
    )

    const adjusted = await engine.assess(
      activeStage,
      judgments,
      '领导力这部分先别判断，还需要更多观察',
    )
    const leadership = adjusted.assessments.find((item) => item.dimensionKey === 'leadership')
    expect(leadership?.status).toBe('unverified')
    expect(leadership?.summary).toContain('领导力这部分先别判断')
    expect(adjusted.summary).toContain('重新整理了当前状态')
    expect(adjusted.judgmentIds).toEqual(initial.judgmentIds)
  })
})

describe('StateService', () => {
  it('keeps the draft transient, persists only on confirmation and makes repeated confirmation idempotent', async () => {
    const states = new MemoryStateRepository()
    const engine: StateAssessmentEngine = {
      assess: vi.fn(new BaselineStateAssessmentEngine().assess.bind(new BaselineStateAssessmentEngine())),
    }
    const service = new StateService(
      schoolRepository(),
      judgmentRepository(),
      new MemoryStageRepository(),
      states,
      engine,
    )

    const initial = await service.getWorkspace(school.id)
    expect(initial.state).toBe('draft')
    expect(states.record).toBeNull()

    const adjusted = await service.adjust({
      schoolId: school.id,
      feedback: '领导力这部分先别判断，还需要更多观察',
    })
    expect(adjusted.state).toBe('draft')
    expect(states.record).toBeNull()
    expect(engine.assess).toHaveBeenLastCalledWith(
      activeStage,
      judgments,
      '领导力这部分先别判断，还需要更多观察',
    )

    const confirmed = await service.confirm({ schoolId: school.id })
    expect(confirmed.state).toBe('baseline')
    expect(states.record?.snapshot.sequence).toBe(1)
    expect(states.record?.snapshot.isBaseline).toBe(true)
    expect(states.record?.judgmentIds).toEqual(['judgment-2', 'judgment-1'])
    expect(states.saves).toBe(1)

    const repeated = await service.confirm({ schoolId: school.id })
    expect(repeated.state).toBe('baseline')
    expect(states.saves).toBe(1)
  })
})
