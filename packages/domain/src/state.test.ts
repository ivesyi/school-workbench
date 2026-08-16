import { describe, expect, it } from 'vitest'
import { createBaselineState, type StateAssessmentDraft } from './state'

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

function dependencies() {
  let index = 0
  return {
    createId: () => `id-${++index}`,
    now: () => new Date('2026-08-17T05:00:00.000Z'),
  }
}

describe('baseline state', () => {
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

  it('refuses incomplete or unsupported assessments instead of inventing a status', () => {
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
  })
})
