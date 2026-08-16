import { ulid } from 'ulid'

export const stageDimensionKeys = [
  'leadership',
  'critical_tasks',
  'structure_systems',
  'culture',
  'capacity',
] as const

export type StageDimensionKey = (typeof stageDimensionKeys)[number]

export type Stage = {
  id: string
  schoolId: string
  title: string
  summary: string
  focus: string
  status: 'planned' | 'active'
  sourceJudgmentIds: string[]
  adjustmentFeedback: string | null
  createdAt: string
  activatedAt: string | null
}

export type StageTarget = {
  id: string
  stageId: string
  schoolId: string
  dimensionKey: StageDimensionKey
  text: string
  status: 'draft' | 'confirmed'
  createdAt: string
  confirmedAt: string | null
}

export type StageRecommendation = {
  stage: Stage
  targets: StageTarget[]
}

export type StageRecommendationDraft = {
  title: string
  summary: string
  focus: string
  targets: Record<StageDimensionKey, string>
}

export type StageFactoryDependencies = {
  createId(): string
  now(): Date
}

const defaultDependencies: StageFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

function assertTargetSet(targets: StageTarget[], stage: Stage): void {
  if (targets.length !== stageDimensionKeys.length) {
    throw new Error('阶段建议必须包含完整的五个观察目标')
  }

  const dimensions = new Set<StageDimensionKey>()
  for (const target of targets) {
    if (target.stageId !== stage.id || target.schoolId !== stage.schoolId) {
      throw new Error('阶段目标不能跨学校或跨阶段')
    }
    if (dimensions.has(target.dimensionKey)) {
      throw new Error('阶段建议不能重复同一观察目标')
    }
    dimensions.add(target.dimensionKey)
  }

  if (stageDimensionKeys.some((dimension) => !dimensions.has(dimension))) {
    throw new Error('阶段建议缺少必要的观察目标')
  }
}

export function createStageRecommendation(
  schoolId: string,
  draft: StageRecommendationDraft,
  sourceJudgmentIds: string[],
  dependencies: StageFactoryDependencies = defaultDependencies,
): StageRecommendation {
  if (sourceJudgmentIds.length === 0) throw new Error('没有正式判断时不能形成阶段建议')

  const createdAt = dependencies.now().toISOString()
  const stageId = dependencies.createId()
  const stage: Stage = {
    id: stageId,
    schoolId,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    focus: draft.focus.trim(),
    status: 'planned',
    sourceJudgmentIds: [...sourceJudgmentIds],
    adjustmentFeedback: null,
    createdAt,
    activatedAt: null,
  }

  const targets = stageDimensionKeys.map((dimensionKey) => ({
    id: dependencies.createId(),
    stageId,
    schoolId,
    dimensionKey,
    text: draft.targets[dimensionKey].trim(),
    status: 'draft' as const,
    createdAt,
    confirmedAt: null,
  }))

  assertTargetSet(targets, stage)
  return { stage, targets }
}

export function adjustStageRecommendation(
  recommendation: StageRecommendation,
  draft: StageRecommendationDraft,
  feedback: string,
): StageRecommendation {
  if (recommendation.stage.status !== 'planned') throw new Error('已经确认的阶段不能再调整')
  if (recommendation.targets.some((target) => target.status !== 'draft')) {
    throw new Error('已经确认的阶段目标不能再调整')
  }

  const stage: Stage = {
    ...recommendation.stage,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    focus: draft.focus.trim(),
    adjustmentFeedback: feedback.trim(),
  }
  const targets = recommendation.targets.map((target) => ({
    ...target,
    text: draft.targets[target.dimensionKey].trim(),
  }))

  assertTargetSet(targets, stage)
  return { stage, targets }
}

export function activateStageRecommendation(
  recommendation: StageRecommendation,
  activatedAt: Date,
): StageRecommendation {
  if (recommendation.stage.status !== 'planned') throw new Error('这个阶段已经不是待确认状态')
  if (recommendation.targets.some((target) => target.status !== 'draft')) {
    throw new Error('阶段目标状态不一致')
  }
  assertTargetSet(recommendation.targets, recommendation.stage)

  const confirmedAt = activatedAt.toISOString()
  return {
    stage: {
      ...recommendation.stage,
      status: 'active',
      activatedAt: confirmedAt,
    },
    targets: recommendation.targets.map((target) => ({
      ...target,
      status: 'confirmed',
      confirmedAt,
    })),
  }
}

export interface StageRepository {
  findActive(schoolId: string): Promise<StageRecommendation | null>
  findPlanned(schoolId: string): Promise<StageRecommendation | null>
  findById(stageId: string): Promise<StageRecommendation | null>
  savePlanned(recommendation: StageRecommendation): Promise<void>
  replacePlanned(recommendation: StageRecommendation): Promise<void>
  activate(schoolId: string, stageId: string, activatedAt: Date): Promise<StageRecommendation>
}
