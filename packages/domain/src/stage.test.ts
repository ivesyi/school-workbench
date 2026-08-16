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
    leadership: { title: '领导力', description: '领导目标' },
    key_tasks: { title: '关键任务', description: '关键工作目标' },
    structure: { title: '结构与机制', description: '机制目标' },
    culture: { title: '文化', description: '文化目标' },
    capability: { title: '能力', description: '能力目标' },
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
  it('creates one planned stage with canonical five-dimension draft targets', () => {
    const recommendation = createStageRecommendation(
      'school-1',
      draft,
      ['judgment-1'],
      2,
      dependencies(),
    )

    expect(recommendation.stage.status).toBe('planned')
    expect(recommendation.stage.sequence).toBe(2)
    expect(recommendation.stage.startsAt).toBeNull()
    expect(recommendation.targets).toHaveLength(5)
    expect(recommendation.targets.map((target) => target.dimensionKey)).toEqual(stageDimensionKeys)
    expect(recommendation.targets.map((target) => target.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(recommendation.targets.every((target) => target.status === 'draft')).toBe(true)
  })

  it('keeps adjustment planned and atomically activates all targets', () => {
    const recommendation = createStageRecommendation(
      'school-1',
      draft,
      ['judgment-1'],
      1,
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
      new Date('2026-08-17T00:30:00.000Z'),
    )

    expect(adjusted.stage.status).toBe('planned')
    expect(adjusted.stage.adjustmentFeedback).toContain('教师实践')
    expect(adjusted.stage.updatedAt).toBe('2026-08-17T00:30:00.000Z')
    expect(adjusted.targets.every((target) => target.status === 'draft')).toBe(true)

    const active = activateStageRecommendation(adjusted, new Date('2026-08-17T01:00:00.000Z'))
    expect(active.stage.status).toBe('active')
    expect(active.stage.startsAt).toBe('2026-08-17T01:00:00.000Z')
    expect(active.targets.every((target) => target.status === 'confirmed')).toBe(true)
    expect(active.targets.every((target) => target.updatedAt === active.stage.updatedAt)).toBe(true)
  })
})
