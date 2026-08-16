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

function sameSetContainsAll(container: readonly string[], required: readonly string[]): boolean {
  const ids = new Set(container)
  return required.every((id) => ids.has(id))
}

export function validateStateAssessmentDraft(draft: StateAssessmentDraft): void {
  if (!draft.stageId.trim()) throw new Error('状态整理必须对应一个当前阶段')
  if (!draft.summary.trim()) throw new Error('状态整理需要一句总体说明')
  if (draft.judgmentIds.length === 0) throw new Error('没有正式判断时不能确认学校状态')
  if (unique(draft.judgmentIds).length !== draft.judgmentIds.length) {
    throw new Error('学校状态不能重复引用同一条正式判断')
  }
  if (draft.assessments.length !== stageDimensionKeys.length) {
    throw new Error('学校状态必须完整覆盖五个方面')
  }

  const allowedJudgmentIds = new Set(draft.judgmentIds)
  const dimensions = new Set<StageDimensionKey>()
  for (const item of draft.assessments) {
    if (dimensions.has(item.dimensionKey)) throw new Error('学校状态不能重复同一个方面')
    dimensions.add(item.dimensionKey)
    if (!item.summary.trim()) throw new Error('每个方面都需要一句说明')
    if (unique(item.judgmentIds).length !== item.judgmentIds.length) {
      throw new Error('方面判断不能重复引用同一条正式判断')
    }
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

function createStateRecord(
  schoolId: string,
  draft: StateAssessmentDraft,
  snapshotShape: {
    previousSnapshotId: string | null
    sequence: number
    isBaseline: boolean
  },
  dependencies: StateFactoryDependencies,
): StateRecord {
  validateStateAssessmentDraft(draft)

  const confirmedAt = dependencies.now().toISOString()
  const snapshotId = dependencies.createId()
  const snapshot: StateSnapshot = Object.freeze({
    id: snapshotId,
    schoolId,
    stageId: draft.stageId,
    previousSnapshotId: snapshotShape.previousSnapshotId,
    sequence: snapshotShape.sequence,
    summary: draft.summary.trim(),
    isBaseline: snapshotShape.isBaseline,
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
      judgmentIds: Object.freeze([...item.judgmentIds]),
    })
  })

  return Object.freeze({
    snapshot,
    assessments: Object.freeze(assessments),
    judgmentIds: Object.freeze([...draft.judgmentIds]),
  })
}

export function createBaselineState(
  schoolId: string,
  draft: StateAssessmentDraft,
  dependencies: StateFactoryDependencies = defaultDependencies,
): StateRecord {
  return createStateRecord(
    schoolId,
    draft,
    { previousSnapshotId: null, sequence: 1, isBaseline: true },
    dependencies,
  )
}

export function createNextState(
  schoolId: string,
  previous: StateRecord,
  draft: StateAssessmentDraft,
  dependencies: StateFactoryDependencies = defaultDependencies,
): StateRecord {
  validateStateAssessmentDraft(draft)
  if (previous.snapshot.schoolId !== schoolId) throw new Error('上一份状态不属于这所学校')
  if (!sameSetContainsAll(draft.judgmentIds, previous.judgmentIds)) {
    throw new Error('新的状态不能丢失上一份状态已经使用的正式判断')
  }
  if (draft.judgmentIds.length === new Set(previous.judgmentIds).size) {
    throw new Error('没有新的正式判断时不能记录下一次状态')
  }

  return createStateRecord(
    schoolId,
    draft,
    {
      previousSnapshotId: previous.snapshot.id,
      sequence: previous.snapshot.sequence + 1,
      isBaseline: false,
    },
    dependencies,
  )
}

export interface StateRepository {
  findLatest(schoolId: string): Promise<StateRecord | null>
  findById(id: string): Promise<StateRecord | null>
  saveBaseline(record: StateRecord): Promise<void>
  saveNext(record: StateRecord, expectedPreviousSnapshotId: string): Promise<void>
}
