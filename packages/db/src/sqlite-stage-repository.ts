import {
  activateStageRecommendation,
  stageDimensionKeys,
  type Stage,
  type StageDimensionKey,
  type StageRecommendation,
  type StageRepository,
  type StageStatus,
  type StageTarget,
  type StageTargetStatus,
} from '@school-workbench/domain'
import { acceptedJudgments, stageJudgments, stageTargets, stages } from './schema'
import { and, eq, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const stageStatuses: StageStatus[] = ['planned', 'active', 'completed', 'cancelled']
const targetStatuses: StageTargetStatus[] = ['draft', 'confirmed', 'retired']

function toStage(row: typeof stages.$inferSelect): Stage {
  if (!stageStatuses.includes(row.status as StageStatus)) {
    throw new Error(`Unsupported stage status: ${row.status}`)
  }
  return {
    id: row.id,
    schoolId: row.schoolId,
    title: row.title,
    summary: row.summary,
    focus: row.focus,
    sequence: row.sequence,
    status: row.status as StageStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    adjustmentFeedback: row.adjustmentFeedback,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toTarget(row: typeof stageTargets.$inferSelect): StageTarget {
  if (!stageDimensionKeys.includes(row.dimensionKey as StageDimensionKey)) {
    throw new Error(`Unsupported stage dimension: ${row.dimensionKey}`)
  }
  if (!targetStatuses.includes(row.status as StageTargetStatus)) {
    throw new Error(`Unsupported stage target status: ${row.status}`)
  }
  return {
    id: row.id,
    stageId: row.stageId,
    schoolId: row.schoolId,
    dimensionKey: row.dimensionKey as StageDimensionKey,
    title: row.title,
    description: row.description,
    status: row.status as StageTargetStatus,
    sequence: row.sequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function assertScope(recommendation: StageRecommendation): void {
  const { stage, targets, judgmentIds } = recommendation
  if (targets.length !== stageDimensionKeys.length) throw new Error('阶段目标数量不完整')
  if (judgmentIds.length === 0) throw new Error('阶段建议必须关联至少一条正式判断')
  if (
    targets.some((target) => target.schoolId !== stage.schoolId || target.stageId !== stage.id)
  ) {
    throw new Error('阶段和目标不能跨学校保存')
  }
}

export class SqliteStageRepository implements StageRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  private load(row: typeof stages.$inferSelect | undefined): StageRecommendation | null {
    if (!row) return null
    const targets = this.database
      .select()
      .from(stageTargets)
      .where(eq(stageTargets.stageId, row.id))
      .orderBy(stageTargets.sequence)
      .all()
      .map(toTarget)
    const judgments = this.database
      .select({ judgmentId: stageJudgments.judgmentId })
      .from(stageJudgments)
      .where(eq(stageJudgments.stageId, row.id))
      .orderBy(stageJudgments.sequence)
      .all()
    const recommendation = {
      stage: toStage(row),
      targets,
      judgmentIds: judgments.map((item) => item.judgmentId),
    }
    assertScope(recommendation)
    return recommendation
  }

  private assertJudgmentScope(
    tx: Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0],
    schoolId: string,
    judgmentIds: string[],
  ): void {
    for (const judgmentId of judgmentIds) {
      const judgment = tx
        .select({ schoolId: acceptedJudgments.schoolId })
        .from(acceptedJudgments)
        .where(eq(acceptedJudgments.id, judgmentId))
        .get()
      if (!judgment || judgment.schoolId !== schoolId) {
        throw new Error('阶段不能引用其他学校的正式判断')
      }
    }
  }

  async findActive(schoolId: string): Promise<StageRecommendation | null> {
    return this.load(
      this.database
        .select()
        .from(stages)
        .where(and(eq(stages.schoolId, schoolId), eq(stages.status, 'active')))
        .get(),
    )
  }

  async findPlanned(schoolId: string): Promise<StageRecommendation | null> {
    return this.load(
      this.database
        .select()
        .from(stages)
        .where(and(eq(stages.schoolId, schoolId), eq(stages.status, 'planned')))
        .get(),
    )
  }

  async findById(stageId: string): Promise<StageRecommendation | null> {
    return this.load(this.database.select().from(stages).where(eq(stages.id, stageId)).get())
  }

  async nextSequence(schoolId: string): Promise<number> {
    const row = this.database
      .select({ maxSequence: sql<number>`coalesce(max(${stages.sequence}), 0)` })
      .from(stages)
      .where(eq(stages.schoolId, schoolId))
      .get()
    return Number(row?.maxSequence ?? 0) + 1
  }

  async savePlanned(recommendation: StageRecommendation): Promise<void> {
    assertScope(recommendation)
    if (recommendation.stage.status !== 'planned') throw new Error('只能保存待确认阶段建议')
    if (recommendation.targets.some((target) => target.status !== 'draft')) {
      throw new Error('待确认阶段的目标必须保持草稿状态')
    }

    this.database.transaction((tx) => {
      const blockingStage = tx
        .select({ status: stages.status })
        .from(stages)
        .where(eq(stages.schoolId, recommendation.stage.schoolId))
        .all()
        .some((item) => item.status === 'planned' || item.status === 'active')
      if (blockingStage) throw new Error('这所学校已经有待确认或当前阶段')

      this.assertJudgmentScope(tx, recommendation.stage.schoolId, recommendation.judgmentIds)

      tx.insert(stages)
        .values({
          id: recommendation.stage.id,
          schoolId: recommendation.stage.schoolId,
          title: recommendation.stage.title,
          summary: recommendation.stage.summary,
          focus: recommendation.stage.focus,
          sequence: recommendation.stage.sequence,
          status: recommendation.stage.status,
          startsAt: recommendation.stage.startsAt,
          endsAt: recommendation.stage.endsAt,
          adjustmentFeedback: recommendation.stage.adjustmentFeedback,
          createdAt: recommendation.stage.createdAt,
          updatedAt: recommendation.stage.updatedAt,
        })
        .run()

      for (const target of recommendation.targets) tx.insert(stageTargets).values(target).run()
      recommendation.judgmentIds.forEach((judgmentId, index) => {
        tx.insert(stageJudgments)
          .values({ stageId: recommendation.stage.id, judgmentId, sequence: index + 1 })
          .run()
      })
    })
  }

  async replacePlanned(recommendation: StageRecommendation): Promise<void> {
    assertScope(recommendation)
    if (recommendation.stage.status !== 'planned') throw new Error('只能调整待确认阶段')
    if (recommendation.targets.some((target) => target.status !== 'draft')) {
      throw new Error('调整阶段时目标必须保持草稿状态')
    }

    this.database.transaction((tx) => {
      const current = tx.select().from(stages).where(eq(stages.id, recommendation.stage.id)).get()
      if (!current || current.schoolId !== recommendation.stage.schoolId) {
        throw new Error('没有找到这个阶段建议')
      }
      if (current.status !== 'planned') throw new Error('已经确认的阶段不能再调整')

      this.assertJudgmentScope(tx, recommendation.stage.schoolId, recommendation.judgmentIds)

      const persistedTargets = tx
        .select()
        .from(stageTargets)
        .where(eq(stageTargets.stageId, recommendation.stage.id))
        .all()
      if (
        persistedTargets.length !== recommendation.targets.length ||
        persistedTargets.some(
          (target) =>
            target.schoolId !== recommendation.stage.schoolId || target.status !== 'draft',
        )
      ) {
        throw new Error('阶段目标状态不一致')
      }

      tx.update(stages)
        .set({
          title: recommendation.stage.title,
          summary: recommendation.stage.summary,
          focus: recommendation.stage.focus,
          adjustmentFeedback: recommendation.stage.adjustmentFeedback,
          updatedAt: recommendation.stage.updatedAt,
        })
        .where(and(eq(stages.id, recommendation.stage.id), eq(stages.schoolId, recommendation.stage.schoolId)))
        .run()

      for (const target of recommendation.targets) {
        tx.update(stageTargets)
          .set({
            title: target.title,
            description: target.description,
            updatedAt: target.updatedAt,
          })
          .where(and(eq(stageTargets.id, target.id), eq(stageTargets.schoolId, target.schoolId)))
          .run()
      }
    })
  }

  async activate(
    schoolId: string,
    stageId: string,
    activatedAt: Date,
  ): Promise<StageRecommendation> {
    return this.database.transaction((tx) => {
      const stageRow = tx.select().from(stages).where(eq(stages.id, stageId)).get()
      if (!stageRow || stageRow.schoolId !== schoolId) throw new Error('没有找到这个阶段建议')

      const existingActive = tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.schoolId, schoolId), eq(stages.status, 'active')))
        .get()
      if (existingActive && existingActive.id !== stageId) {
        throw new Error('这所学校已经有当前阶段')
      }

      const targetRows = tx
        .select()
        .from(stageTargets)
        .where(eq(stageTargets.stageId, stageId))
        .orderBy(stageTargets.sequence)
        .all()
      const judgmentRows = tx
        .select({ judgmentId: stageJudgments.judgmentId })
        .from(stageJudgments)
        .where(eq(stageJudgments.stageId, stageId))
        .orderBy(stageJudgments.sequence)
        .all()
      const recommendation: StageRecommendation = {
        stage: toStage(stageRow),
        targets: targetRows.map(toTarget),
        judgmentIds: judgmentRows.map((item) => item.judgmentId),
      }
      assertScope(recommendation)

      if (recommendation.stage.status === 'active') return recommendation
      const active = activateStageRecommendation(recommendation, activatedAt)

      tx.update(stages)
        .set({
          status: 'active',
          startsAt: active.stage.startsAt,
          updatedAt: active.stage.updatedAt,
        })
        .where(and(eq(stages.id, stageId), eq(stages.schoolId, schoolId)))
        .run()
      for (const target of active.targets) {
        tx.update(stageTargets)
          .set({ status: 'confirmed', updatedAt: target.updatedAt })
          .where(and(eq(stageTargets.id, target.id), eq(stageTargets.schoolId, schoolId)))
          .run()
      }

      return active
    })
  }
}
