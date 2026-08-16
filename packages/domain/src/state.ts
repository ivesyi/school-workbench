import { ulid } from 'ulid'
import { stageDimensionKeys, type StageDimensionKey } from './stage'

export const dimensionAssessmentStatuses = [
  'unverified',
  'far_below',
  'partial',
  'mostly',
  'stable',
] as const

export type DimensionAssessmentStatus = (typeof dimensionAssessmentStatuses)[number]

export type DimensionAssessmentDraft = {
  dimensionKey: StageDimensionKey
  status: DimensionAssessmentStatus
  summary: string
  judgmentIds: string[]
}

export type StateAssessmentDraft = {
  stageId: string
  summary: string
  limitations: string[]
  assessments: DimensionAssessmentDraft[]
  judgmentIds: string[]
  adjustmentFeedback: string | null
}

export type StateSnapshot = Readonly<{
  id: string
  schoolId: string
  stageId: string
  previousSnapshotId: string | null
  sequence: number
  summary: string
  isBaseline: boolean
  confirmedAt: string
  createdAt: string
}>

export type DimensionAssessment = Readonly<{
  id: string
  snapshotId: string
  dimensionKey: StageDimensionKey
  status: DimensionAssessmentStatus
  summary: string
  createdAt: string
}>

export type PersistedDimensionAssessment = Readonly<{
  assessment: DimensionAssessment
  judgmentIds: readonly string[]
}>

export type StateRecord = Readonly<{
  snapshot: StateSnapshot
  assessments: readonly PersistedDimensionAssessment[]
  judgmentIds: readonly string[]
}>

export type StateFactoryDependencies = {
  createId(): string
  now(): Date
}

const defaultDependencies: StateFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function validateStateAssessmentDraft(draft: StateAssessmentDraft): void {
  if (!draft.stageId.trim()) throw new Error('状态整理必须对应一个当前阶段')
  if (!draft.summary.trim()) throw new Error('状态整理需要一句总体说明')
  if (draft.judgmentIds.length === 0) throw new Error('没有正式判断时不能确认学校状态')
  if (draft.assessments.length !== stageDimensionKeys.length) {
    throw new Error('学校状态必须完整覆盖五个方面')
  }

  const allowedJudgmentIds = new Set(draft.judgmentIds)
  const dimensions = new Set<StageDimensionKey>()
  for (const item of draft.assessments) {
    if (dimensions.has(item.dimensionKey)) throw new Error('学校状态不能重复同一个方面')
    dimensions.add(item.dimensionKey)
    if (!item.summary.trim()) throw new Error('每个方面都需要一句说明')
    if (item.status !== 'unverified' && item.judgmentIds.length === 0) {
      throw new Error('形成达到情况判断时至少需要一条正式判断')
    }
    if (item.judgmentIds.some((judgmentId) => !allowedJudgmentIds.has(judgmentId))) {
      throw new Error('方面判断不能引用本轮未使用的正式判断')
    }
  }

  if (stageDimensionKeys.some((dimensionKey) => !dimensions.has(dimensionKey))) {
    throw new Error('学校状态缺少必要的方面')
  }
}

export function createBaselineState(
  schoolId: string,
  draft: StateAssessmentDraft,
  dependencies: StateFactoryDependencies = defaultDependencies,
): StateRecord {
  validateStateAssessmentDraft(draft)

  const confirmedAt = dependencies.now().toISOString()
  const snapshotId = dependencies.createId()
  const snapshot: StateSnapshot = Object.freeze({
    id: snapshotId,
    schoolId,
    stageId: draft.stageId,
    previousSnapshotId: null,
    sequence: 1,
    summary: draft.summary.trim(),
    isBaseline: true,
    confirmedAt,
    createdAt: confirmedAt,
  })

  const draftByDimension = new Map(draft.assessments.map((item) => [item.dimensionKey, item]))
  const assessments = stageDimensionKeys.map((dimensionKey) => {
    const item = draftByDimension.get(dimensionKey)
    if (!item) throw new Error('学校状态缺少必要的方面')
    const assessment: DimensionAssessment = Object.freeze({
      id: dependencies.createId(),
      snapshotId,
      dimensionKey,
      status: item.status,
      summary: item.summary.trim(),
      createdAt: confirmedAt,
    })
    return Object.freeze({
      assessment,
      judgmentIds: Object.freeze(unique(item.judgmentIds)),
    })
  })

  return Object.freeze({
    snapshot,
    assessments: Object.freeze(assessments),
    judgmentIds: Object.freeze(unique(draft.judgmentIds)),
  })
}

export interface StateRepository {
  findLatest(schoolId: string): Promise<StateRecord | null>
  saveBaseline(record: StateRecord): Promise<void>
}
