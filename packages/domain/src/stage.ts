import { ulid } from 'ulid'

export const stageDimensionKeys = [
  'leadership',
  'key_tasks',
  'structure',
  'culture',
  'capability',
] as const

export type StageDimensionKey = (typeof stageDimensionKeys)[number]
export type StageStatus = 'planned' | 'active' | 'completed' | 'cancelled'
export type StageTargetStatus = 'draft' | 'confirmed' | 'retired'

export type Stage = {
  id: string
  schoolId: string
  title: string
  summary: string
  focus: string
  sequence: number
  status: StageStatus
  startsAt: string | null
  endsAt: string | null
  adjustmentFeedback: string | null
  createdAt: string
  updatedAt: string
}

export type StageTarget = {
  id: string
  stageId: string
  schoolId: string
  dimensionKey: StageDimensionKey
  title: string
  description: string
  status: StageTargetStatus
  sequence: number
  createdAt: string
  updatedAt: string
}

export type StageRecommendation = {
  stage: Stage
  targets: StageTarget[]
  judgmentIds: string[]
}

export type StageTargetDraft = {
  title: string
  description: string
}

export type StageRecommendationDraft = {
  title: string
  summary: string
  focus: string
  targets: Record<StageDimensionKey, StageTargetDraft>
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
  const sequences = new Set<number>()
  for (const target of targets) {
    if (target.stageId !== stage.id || target.schoolId !== stage.schoolId) {
      throw new Error('阶段目标不能跨学校或跨阶段')
    }
    if (dimensions.has(target.dimensionKey)) {
      throw new Error('阶段建议不能重复同一观察目标')
    }
    if (sequences.has(target.sequence)) throw new Error('阶段目标顺序不能重复')
    dimensions.add(target.dimensionKey)
    sequences.add(target.sequence)
  }

  if (stageDimensionKeys.some((dimension) => !dimensions.has(dimension))) {
    throw new Error('阶段建议缺少必要的观察目标')
  }
}

function buildStageRecommendation(
  schoolId: string,
  draft: StageRecommendationDraft,
  judgmentIds: string[],
  sequence: number,
  dependencies: StageFactoryDependencies,
): StageRecommendation {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('阶段顺序必须从 1 开始')

  const createdAt = dependencies.now().toISOString()
  const stageId = dependencies.createId()
  const stage: Stage = {
    id: stageId,
    schoolId,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    focus: draft.focus.trim(),
    sequence,
    status: 'planned',
    startsAt: null,
    endsAt: null,
    adjustmentFeedback: null,
    createdAt,
    updatedAt: createdAt,
  }

  const targets = stageDimensionKeys.map((dimensionKey, index) => ({
    id: dependencies.createId(),
    stageId,
    schoolId,
    dimensionKey,
    title: draft.targets[dimensionKey].title.trim(),
    description: draft.targets[dimensionKey].description.trim(),
    status: 'draft' as const,
    sequence: index + 1,
    createdAt,
    updatedAt: createdAt,
  }))

  assertTargetSet(targets, stage)
  return { stage, targets, judgmentIds: [...judgmentIds] }
}

export function createStageRecommendation(
  schoolId: string,
  draft: StageRecommendationDraft,
  judgmentIds: string[],
  sequence: number,
  dependencies: StageFactoryDependencies = defaultDependencies,
): StageRecommendation {
  if (judgmentIds.length === 0) throw new Error('没有正式判断时不能形成阶段建议')
  return buildStageRecommendation(schoolId, draft, judgmentIds, sequence, dependencies)
}

/**
 * An initial stage proposed by the Agent for a school that has no current stage
 * and no confirmed judgments yet (PRD 11).
 *
 * Unlike {@link createStageRecommendation} this carries no judgment links: on a
 * brand-new school there is nothing to link to. The provenance is the planned
 * stage itself — it stays a proposal until the consultant confirms it, exactly
 * like a judgment-derived recommendation.
 */
export function createAgentStageProposal(
  schoolId: string,
  draft: StageRecommendationDraft,
  sequence: number,
  dependencies: StageFactoryDependencies = defaultDependencies,
): StageRecommendation {
  return buildStageRecommendation(schoolId, draft, [], sequence, dependencies)
}

export function adjustStageRecommendation(
  recommendation: StageRecommendation,
  draft: StageRecommendationDraft,
  feedback: string,
  judgmentIds: string[],
  adjustedAt: Date = new Date(),
): StageRecommendation {
  if (recommendation.stage.status !== 'planned') throw new Error('已经确认的阶段不能再调整')
  if (recommendation.targets.some((target) => target.status !== 'draft')) {
    throw new Error('已经确认的阶段目标不能再调整')
  }

  const updatedAt = adjustedAt.toISOString()
  const stage: Stage = {
    ...recommendation.stage,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    focus: draft.focus.trim(),
    adjustmentFeedback: feedback.trim(),
    updatedAt,
  }
  const targets = recommendation.targets.map((target) => ({
    ...target,
    title: draft.targets[target.dimensionKey].title.trim(),
    description: draft.targets[target.dimensionKey].description.trim(),
    updatedAt,
  }))

  assertTargetSet(targets, stage)
  return { stage, targets, judgmentIds: [...judgmentIds] }
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

  const timestamp = activatedAt.toISOString()
  return {
    stage: {
      ...recommendation.stage,
      status: 'active',
      startsAt: timestamp,
      updatedAt: timestamp,
    },
    targets: recommendation.targets.map((target) => ({
      ...target,
      status: 'confirmed',
      updatedAt: timestamp,
    })),
    judgmentIds: [...recommendation.judgmentIds],
  }
}

export interface StageRepository {
  findActive(schoolId: string): Promise<StageRecommendation | null>
  findPlanned(schoolId: string): Promise<StageRecommendation | null>
  findById(stageId: string): Promise<StageRecommendation | null>
  nextSequence(schoolId: string): Promise<number>
  savePlanned(recommendation: StageRecommendation): Promise<void>
  replacePlanned(recommendation: StageRecommendation): Promise<void>
  activate(schoolId: string, stageId: string, activatedAt: Date): Promise<StageRecommendation>
}
