import { describe, expect, it } from 'vitest'
import {
  activateStageRecommendation,
  adjustStageRecommendation,
  createStageRecommendation,
  stageDimensionKeys,
  type StageRecommendationDraft,
} from './stage'

const draft: StageRecommendationDraft = {
  title: '建立共同推动改进的组织基础',
  summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
  focus: '这个阶段现在最需要看到：中层开始独立承担关键任务，学校形成可重复的协作方式。',
  targets: {
    leadership: '校长从直接代办转向明确方向、授权和复盘。',
    critical_tasks: '至少一项关键改进任务由中层独立拆解并推进。',
    structure_systems: '形成稳定的任务分工、推进节奏和复盘机制。',
    culture: '中层能够公开讨论问题、提出判断并对结果负责。',
    capacity: '中层能够独立分析问题、制定行动并复盘。',
  },
}

function dependencies() {
  let index = 0
  return {
    createId: () => `id-${++index}`,
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  }
}

describe('stage recommendation', () => {
  it('creates one planned stage with five draft targets', () => {
    const recommendation = createStageRecommendation(
      'school-1',
      draft,
      ['judgment-1'],
      dependencies(),
    )

    expect(recommendation.stage.status).toBe('planned')
    expect(recommendation.targets).toHaveLength(5)
    expect(recommendation.targets.map((target) => target.dimensionKey)).toEqual(stageDimensionKeys)
    expect(recommendation.targets.every((target) => target.status === 'draft')).toBe(true)
  })

  it('keeps adjustment planned and atomically activates all targets', () => {
    const recommendation = createStageRecommendation(
      'school-1',
      draft,
      ['judgment-1'],
      dependencies(),
    )
    const adjusted = adjustStageRecommendation(
      recommendation,
      {
        ...draft,
        title: '让改进进入教师实践',
        focus: '这个阶段现在最需要看到：教师开始基于真实课堂证据调整实践。',
      },
      '中层已经比较稳定，现在更应该看教师实践。',
    )

    expect(adjusted.stage.status).toBe('planned')
    expect(adjusted.stage.adjustmentFeedback).toContain('教师实践')
    expect(adjusted.targets.every((target) => target.status === 'draft')).toBe(true)

    const active = activateStageRecommendation(adjusted, new Date('2026-08-17T01:00:00.000Z'))
    expect(active.stage.status).toBe('active')
    expect(active.targets.every((target) => target.status === 'confirmed')).toBe(true)
    expect(active.targets.every((target) => target.confirmedAt === active.stage.activatedAt)).toBe(true)
  })
})
