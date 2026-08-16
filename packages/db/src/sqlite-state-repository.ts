import {
  dimensionAssessmentStatuses,
  stageDimensionKeys,
  type DimensionAssessment,
  type DimensionAssessmentStatus,
  type PersistedDimensionAssessment,
  type StageDimensionKey,
  type StateRecord,
  type StateRepository,
  type StateSnapshot,
} from '@school-workbench/domain'
import { desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  acceptedJudgments,
  assessmentJudgments,
  dimensionAssessments,
  snapshotJudgments,
  stageTargets,
  stages,
  stateSnapshots,
} from './schema'

function toSnapshot(row: typeof stateSnapshots.$inferSelect): StateSnapshot {
  if (!row.stageId) throw new Error('当前版本的学校状态必须对应一个阶段')
  return {
    id: row.id,
    schoolId: row.schoolId,
    stageId: row.stageId,
    previousSnapshotId: row.previousSnapshotId,
    sequence: row.sequence,
    summary: row.summary,
    isBaseline: row.isBaseline,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  }
}

function toAssessment(row: typeof dimensionAssessments.$inferSelect): DimensionAssessment {
  if (!stageDimensionKeys.includes(row.dimensionKey as StageDimensionKey)) {
    throw new Error(`Unsupported assessment dimension: ${row.dimensionKey}`)
  }
  if (!dimensionAssessmentStatuses.includes(row.status as DimensionAssessmentStatus)) {
    throw new Error(`Unsupported assessment status: ${row.status}`)
  }
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    dimensionKey: row.dimensionKey as StageDimensionKey,
    status: row.status as DimensionAssessmentStatus,
    summary: row.summary,
    createdAt: row.createdAt,
  }
}

function assertRecordShape(record: StateRecord): void {
  if (!record.snapshot.isBaseline || record.snapshot.sequence !== 1) {
    throw new Error('当前纵切只能保存第一份起点状态')
  }
  if (record.snapshot.previousSnapshotId !== null) throw new Error('起点状态不能有上一份状态')
  if (record.judgmentIds.length === 0) throw new Error('起点状态至少需要一条正式判断')
  if (record.assessments.length !== stageDimensionKeys.length) {
    throw new Error('起点状态必须完整覆盖五个方面')
  }

  const dimensions = new Set<StageDimensionKey>()
  const snapshotJudgmentIds = new Set(record.judgmentIds)
  for (const item of record.assessments) {
    if (item.assessment.snapshotId !== record.snapshot.id) {
      throw new Error('方面判断不能跨状态记录')
    }
    if (dimensions.has(item.assessment.dimensionKey)) throw new Error('不能重复同一个方面')
    dimensions.add(item.assessment.dimensionKey)
    if (item.assessment.status !== 'unverified' && item.judgmentIds.length === 0) {
      throw new Error('形成达到情况判断时至少需要一条正式判断')
    }
    if (item.judgmentIds.some((judgmentId) => !snapshotJudgmentIds.has(judgmentId))) {
      throw new Error('方面依据必须属于本轮状态使用的正式判断')
    }
  }

  if (stageDimensionKeys.some((dimensionKey) => !dimensions.has(dimensionKey))) {
    throw new Error('起点状态缺少必要的方面')
  }
}

export class SqliteStateRepository implements StateRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  private load(row: typeof stateSnapshots.$inferSelect | undefined): StateRecord | null {
    if (!row) return null
    const snapshot = toSnapshot(row)
    const assessmentRows = this.database
      .select()
      .from(dimensionAssessments)
      .where(eq(dimensionAssessments.snapshotId, snapshot.id))
      .all()
      .map(toAssessment)
      .sort(
        (left, right) =>
          stageDimensionKeys.indexOf(left.dimensionKey) - stageDimensionKeys.indexOf(right.dimensionKey),
      )

    const assessments: PersistedDimensionAssessment[] = assessmentRows.map((assessment) => {
      const links = this.database
        .select({ judgmentId: assessmentJudgments.judgmentId })
        .from(assessmentJudgments)
        .innerJoin(acceptedJudgments, eq(assessmentJudgments.judgmentId, acceptedJudgments.id))
        .where(eq(assessmentJudgments.assessmentId, assessment.id))
        .orderBy(desc(acceptedJudgments.createdAt))
        .all()
      return { assessment, judgmentIds: links.map((item) => item.judgmentId) }
    })

    const judgments = this.database
      .select({ judgmentId: snapshotJudgments.judgmentId })
      .from(snapshotJudgments)
      .innerJoin(acceptedJudgments, eq(snapshotJudgments.judgmentId, acceptedJudgments.id))
      .where(eq(snapshotJudgments.snapshotId, snapshot.id))
      .orderBy(desc(acceptedJudgments.createdAt))
      .all()

    const record: StateRecord = {
      snapshot,
      assessments,
      judgmentIds: judgments.map((item) => item.judgmentId),
    }
    assertRecordShape(record)
    return record
  }

  private assertJudgmentScope(
    tx: Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0],
    schoolId: string,
    judgmentIds: readonly string[],
  ): void {
    for (const judgmentId of judgmentIds) {
      const judgment = tx
        .select({ schoolId: acceptedJudgments.schoolId })
        .from(acceptedJudgments)
        .where(eq(acceptedJudgments.id, judgmentId))
        .get()
      if (!judgment || judgment.schoolId !== schoolId) {
        throw new Error('学校状态不能引用其他学校的正式判断')
      }
    }
  }

  async findLatest(schoolId: string): Promise<StateRecord | null> {
    return this.load(
      this.database
        .select()
        .from(stateSnapshots)
        .where(eq(stateSnapshots.schoolId, schoolId))
        .orderBy(desc(stateSnapshots.sequence))
        .get(),
    )
  }

  async saveBaseline(record: StateRecord): Promise<void> {
    assertRecordShape(record)

    this.database.transaction((tx) => {
      const existing = tx
        .select({ id: stateSnapshots.id })
        .from(stateSnapshots)
        .where(eq(stateSnapshots.schoolId, record.snapshot.schoolId))
        .get()
      if (existing) throw new Error('这所学校已经记录了起点状态')

      const stage = tx.select().from(stages).where(eq(stages.id, record.snapshot.stageId)).get()
      if (!stage || stage.schoolId !== record.snapshot.schoolId || stage.status !== 'active') {
        throw new Error('起点状态必须对应这所学校的当前阶段')
      }

      const targets = tx
        .select({
          schoolId: stageTargets.schoolId,
          dimensionKey: stageTargets.dimensionKey,
          status: stageTargets.status,
        })
        .from(stageTargets)
        .where(eq(stageTargets.stageId, record.snapshot.stageId))
        .all()
      if (
        targets.length !== stageDimensionKeys.length ||
        targets.some(
          (target) =>
            target.schoolId !== record.snapshot.schoolId ||
            target.status !== 'confirmed' ||
            !stageDimensionKeys.includes(target.dimensionKey as StageDimensionKey),
        )
      ) {
        throw new Error('起点状态只能使用当前阶段已经确认的五个目标')
      }

      this.assertJudgmentScope(tx, record.snapshot.schoolId, record.judgmentIds)
      for (const item of record.assessments) {
        this.assertJudgmentScope(tx, record.snapshot.schoolId, item.judgmentIds)
      }

      tx.insert(stateSnapshots)
        .values({
          id: record.snapshot.id,
          schoolId: record.snapshot.schoolId,
          stageId: record.snapshot.stageId,
          previousSnapshotId: record.snapshot.previousSnapshotId,
          sequence: record.snapshot.sequence,
          summary: record.snapshot.summary,
          isBaseline: record.snapshot.isBaseline,
          confirmedAt: record.snapshot.confirmedAt,
          createdAt: record.snapshot.createdAt,
        })
        .run()

      for (const item of record.assessments) {
        tx.insert(dimensionAssessments).values(item.assessment).run()
        for (const judgmentId of item.judgmentIds) {
          tx.insert(assessmentJudgments)
            .values({ assessmentId: item.assessment.id, judgmentId })
            .run()
        }
      }
      for (const judgmentId of record.judgmentIds) {
        tx.insert(snapshotJudgments)
          .values({ snapshotId: record.snapshot.id, judgmentId })
          .run()
      }
    })
  }
}
