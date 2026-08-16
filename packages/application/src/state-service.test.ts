import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
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

const activeStageTargets: Array<
  [StageRecommendation['targets'][number]['dimensionKey'], string, string]
> = [
  ['leadership', '领导力', '校长从代办转向授权，中层承担真实责任。'],
  ['key_tasks', '关键任务', '关键任务由中层独立拆解、推进和调整。'],
  ['structure', '结构与机制', '形成稳定的分工、推进和复盘机制。'],
  ['culture', '文化', '团队能够公开讨论问题并对结果负责。'],
  ['capability', '能力', '中层能够独立分析、协同推进并复盘。'],
]

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
  targets: activeStageTargets.map(([dimensionKey, title, description], index) => ({
    id: `target-${index + 1}`,
    stageId: 'stage-1',
    schoolId: school.id,
    dimensionKey,
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

const initialJudgments = [
  judgment(
    'judgment-2',
    '教师已经开始稳定教研复盘，能够根据课堂情况调整。',
    '2026-08-17T02:00:00.000Z',
  ),
  judgment('judgment-1', '中层仍然依赖校长完成关键任务拆解。', '2026-08-17T01:30:00.000Z'),
]

function schoolRepository(): SchoolRepository {
  return {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(school),
    listActive: vi.fn().mockResolvedValue([school]),
  }
}

class MemoryJudgmentRepository implements JudgmentRepository {
  constructor(public items: AcceptedJudgment[] = [...initialJudgments]) {}
  async saveProposalChain(): Promise<void> {}
  async findProposal(): Promise<DiagnosisProposal | null> {
    return null
  }
  async saveReviewOutcome(): Promise<void> {}
  async listAcceptedJudgments(schoolId: string): Promise<AcceptedJudgment[]> {
    return this.items.filter((item) => item.schoolId === schoolId)
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
  records: StateRecord[] = []
  saves = 0

  async findLatest(schoolId: string): Promise<StateRecord | null> {
    return (
      this.records
        .filter((item) => item.snapshot.schoolId === schoolId)
        .sort((left, right) => right.snapshot.sequence - left.snapshot.sequence)[0] ?? null
    )
  }

  async findById(id: string): Promise<StateRecord | null> {
    return this.records.find((item) => item.snapshot.id === id) ?? null
  }

  async saveBaseline(record: StateRecord): Promise<void> {
    if (await this.findLatest(record.snapshot.schoolId)) throw new Error('已经记录起点状态')
    this.records.push(record)
    this.saves += 1
  }

  async saveNext(record: StateRecord, expectedPreviousSnapshotId: string): Promise<void> {
    const latest = await this.findLatest(record.snapshot.schoolId)
    if (!latest || latest.snapshot.id !== expectedPreviousSnapshotId) {
      throw new Error('学校状态已经有更新')
    }
    this.records.push(record)
    this.saves += 1
  }
}

describe('BaselineStateAssessmentEngine', () => {
  it('uses only confirmed stage targets, covers all five dimensions and stays unverified when evidence is absent', async () => {
    const engine = new BaselineStateAssessmentEngine()
    const draft = await engine.assess(activeStage, initialJudgments)

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
    const initial = await engine.assess(activeStage, initialJudgments)
    expect(initial.assessments.find((item) => item.dimensionKey === 'leadership')?.status).toBe(
      'far_below',
    )

    const adjusted = await engine.assess(
      activeStage,
      initialJudgments,
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
  it('keeps baseline draft transient, persists only on confirmation and makes repeated confirmation idempotent', async () => {
    const states = new MemoryStateRepository()
    const judgments = new MemoryJudgmentRepository()
    const baselineEngine = new BaselineStateAssessmentEngine()
    const assess = vi.fn(
      (stage: StageRecommendation, items: AcceptedJudgment[], feedback?: string) =>
        baselineEngine.assess(stage, items, feedback),
    )
    const engine: StateAssessmentEngine = { assess }
    const service = new StateService(
      schoolRepository(),
      judgments,
      new MemoryStageRepository(),
      states,
      engine,
    )

    const initial = await service.getWorkspace(school.id)
    expect(initial.state).toBe('draft')
    expect(states.records).toHaveLength(0)

    const adjusted = await service.adjust({
      schoolId: school.id,
      feedback: '领导力这部分先别判断，还需要更多观察',
    })
    expect(adjusted.state).toBe('draft')
    expect(states.records).toHaveLength(0)

    const confirmed = await service.confirm({ schoolId: school.id })
    expect(confirmed.state).toBe('baseline')
    expect(states.records[0]?.snapshot.sequence).toBe(1)
    expect(states.records[0]?.snapshot.isBaseline).toBe(true)
    expect(states.records[0]?.judgmentIds).toEqual(['judgment-2', 'judgment-1'])
    expect(states.saves).toBe(1)

    const repeated = await service.confirm({ schoolId: school.id })
    expect(repeated.state).toBe('baseline')
    expect(states.saves).toBe(1)
  })

  it('forms an update draft only when new judgments exist, compares it to baseline and confirms immutable snapshot #2', async () => {
    const states = new MemoryStateRepository()
    const judgments = new MemoryJudgmentRepository()
    const service = new StateService(
      schoolRepository(),
      judgments,
      new MemoryStageRepository(),
      states,
    )

    await service.getWorkspace(school.id)
    await service.confirm({ schoolId: school.id })
    expect((await service.getWorkspace(school.id)).state).toBe('baseline')

    judgments.items.unshift(
      judgment(
        'judgment-3',
        '中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。',
        '2026-08-17T03:00:00.000Z',
      ),
    )

    const update = await service.getWorkspace(school.id)
    expect(update.state).toBe('update_draft')
    if (update.state !== 'update_draft') throw new Error('expected update draft')
    expect(update.change.newJudgmentCount).toBe(1)
    expect(update.change.dimensions.find((item) => item.dimensionKey === 'leadership')?.kind).toBe(
      'improved',
    )
    expect(states.records).toHaveLength(1)

    const adjusted = await service.adjust({
      schoolId: school.id,
      feedback: '文化这部分先别判断，还需要更多观察',
    })
    expect(adjusted.state).toBe('update_draft')
    expect(states.records).toHaveLength(1)

    const confirmed = await service.confirm({ schoolId: school.id })
    expect(confirmed.state).toBe('current')
    expect(states.records).toHaveLength(2)
    expect(states.records[0]?.snapshot.sequence).toBe(1)
    expect(states.records[0]?.snapshot.isBaseline).toBe(true)
    expect(states.records[1]?.snapshot.sequence).toBe(2)
    expect(states.records[1]?.snapshot.previousSnapshotId).toBe(states.records[0]?.snapshot.id)
    expect(states.records[1]?.snapshot.isBaseline).toBe(false)
    expect(states.records[1]?.judgmentIds).toEqual(['judgment-3', 'judgment-2', 'judgment-1'])

    const repeated = await service.confirm({ schoolId: school.id })
    expect(repeated.state).toBe('current')
    expect(states.records).toHaveLength(2)
  })

  it('rejects a stale update draft when another judgment is accepted before confirmation', async () => {
    const states = new MemoryStateRepository()
    const judgments = new MemoryJudgmentRepository()
    const service = new StateService(
      schoolRepository(),
      judgments,
      new MemoryStageRepository(),
      states,
    )

    await service.getWorkspace(school.id)
    await service.confirm({ schoolId: school.id })
    judgments.items.unshift(
      judgment(
        'judgment-3',
        '中层已经能够独立完成关键任务拆解，校长开始授权。',
        '2026-08-17T03:00:00.000Z',
      ),
    )
    expect((await service.getWorkspace(school.id)).state).toBe('update_draft')

    judgments.items.unshift(
      judgment(
        'judgment-4',
        '团队已经开始公开讨论推进中的问题，并共同承担结果。',
        '2026-08-17T03:30:00.000Z',
      ),
    )
    await expect(service.confirm({ schoolId: school.id })).rejects.toThrow('新的正式判断')
    expect(states.records).toHaveLength(1)

    const refreshed = await service.getWorkspace(school.id)
    expect(refreshed.state).toBe('update_draft')
    if (refreshed.state === 'update_draft') expect(refreshed.change.newJudgmentCount).toBe(2)
  })
})
