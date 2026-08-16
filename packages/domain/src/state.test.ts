import { describe, expect, it } from 'vitest'
import { createBaselineState, createNextState, type StateAssessmentDraft } from './state'

const draft: StateAssessmentDraft = {
  stageId: 'stage-1',
  summary: '目前有四个方面可以形成初步判断，一个方面还需要更多观察。',
  limitations: ['文化方面目前证据还不足。'],
  judgmentIds: ['judgment-1', 'judgment-2'],
  adjustmentFeedback: null,
  assessments: [
    {
      dimensionKey: 'leadership',
      status: 'far_below',
      summary: '领导责任仍然过度集中。',
      judgmentIds: ['judgment-1'],
    },
    {
      dimensionKey: 'key_tasks',
      status: 'partial',
      summary: '关键任务已经开始被拆解。',
      judgmentIds: ['judgment-1'],
    },
    {
      dimensionKey: 'structure',
      status: 'mostly',
      summary: '教研复盘正在形成稳定节奏。',
      judgmentIds: ['judgment-2'],
    },
    {
      dimensionKey: 'culture',
      status: 'unverified',
      summary: '目前还没有足够判断。',
      judgmentIds: [],
    },
    {
      dimensionKey: 'capability',
      status: 'partial',
      summary: '中层和教师的独立推进能力开始出现。',
      judgmentIds: ['judgment-1', 'judgment-2'],
    },
  ],
}

function dependencies(start = 0) {
  let index = start
  return {
    createId: () => `id-${++index}`,
    now: () => new Date('2026-08-17T05:00:00.000Z'),
  }
}

describe('school state records', () => {
  it('creates immutable baseline snapshot #1 with five canonical assessments', () => {
    const record = createBaselineState('school-1', draft, dependencies())

    expect(record.snapshot.sequence).toBe(1)
    expect(record.snapshot.previousSnapshotId).toBeNull()
    expect(record.snapshot.isBaseline).toBe(true)
    expect(record.snapshot.stageId).toBe('stage-1')
    expect(record.assessments.map((item) => item.assessment.dimensionKey)).toEqual([
      'leadership',
      'key_tasks',
      'structure',
      'culture',
      'capability',
    ])
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.snapshot)).toBe(true)
    expect(Object.isFrozen(record.assessments)).toBe(true)
  })

  it('creates immutable snapshot #2 linked to #1 and refuses to drop provenance or advance without new judgments', () => {
    const baseline = createBaselineState('school-1', draft, dependencies())
    const nextDraft: StateAssessmentDraft = {
      ...draft,
      summary: '学校现在的状态已经根据新判断重新整理。',
      judgmentIds: ['judgment-3', ...draft.judgmentIds],
      assessments: draft.assessments.map((item) =>
        item.dimensionKey === 'leadership'
          ? {
              ...item,
              status: 'partial' as const,
              summary: '中层开始承担真实责任。',
              judgmentIds: ['judgment-3', 'judgment-1'],
            }
          : item,
      ),
    }

    const next = createNextState('school-1', baseline, nextDraft, dependencies(20))
    expect(next.snapshot.sequence).toBe(2)
    expect(next.snapshot.previousSnapshotId).toBe(baseline.snapshot.id)
    expect(next.snapshot.isBaseline).toBe(false)
    expect(Object.isFrozen(next)).toBe(true)
    expect(Object.isFrozen(baseline)).toBe(true)
    expect(baseline.snapshot.sequence).toBe(1)

    const missingPreviousProvenance: StateAssessmentDraft = {
      ...nextDraft,
      judgmentIds: ['judgment-3'],
      assessments: nextDraft.assessments.map((item) =>
        item.dimensionKey === 'leadership'
          ? { ...item, judgmentIds: ['judgment-3'] }
          : {
              ...item,
              status: 'unverified' as const,
              summary: '目前没有足够依据。',
              judgmentIds: [],
            },
      ),
    }
    expect(() =>
      createNextState('school-1', baseline, missingPreviousProvenance, dependencies(40)),
    ).toThrow('不能丢失上一份状态已经使用的正式判断')

    expect(() => createNextState('school-1', baseline, draft, dependencies(60))).toThrow(
      '没有新的正式判断',
    )
  })

  it('refuses incomplete, unsupported or duplicate provenance instead of inventing a status', () => {
    expect(() =>
      createBaselineState(
        'school-1',
        {
          ...draft,
          assessments: draft.assessments.slice(0, 4),
        },
        dependencies(),
      ),
    ).toThrow('完整覆盖五个方面')

    expect(() =>
      createBaselineState(
        'school-1',
        {
          ...draft,
          assessments: draft.assessments.map((item) =>
            item.dimensionKey === 'culture'
              ? { ...item, status: 'partial' as const, judgmentIds: [] }
              : item,
          ),
        },
        dependencies(),
      ),
    ).toThrow('至少需要一条正式判断')

    expect(() =>
      createBaselineState(
        'school-1',
        { ...draft, judgmentIds: ['judgment-1', 'judgment-1', 'judgment-2'] },
        dependencies(),
      ),
    ).toThrow('不能重复引用同一条正式判断')
  })
})
