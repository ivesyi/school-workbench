import {
  activateStageRecommendation,
  stageDimensionKeys,
  type Stage,
  type StageDimensionKey,
  type StageRecommendation,
  type StageRepository,
  type StageTarget,
} from '@school-workbench/domain'
import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { stageTargets, stages } from './schema'

function parseJudgmentIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid persisted stage judgment ids')
  }
  return parsed
}

function toStage(row: typeof stages.$inferSelect): Stage {
  if (row.status !== 'planned' && row.status !== 'active') {
    throw new Error(`Unsupported stage status: ${row.status}`)
  }
  return {
    id: row.id,
    schoolId: row.schoolId,
    title: row.title,
    summary: row.summary,
    focus: row.focus,
    status: row.status,
    sourceJudgmentIds: parseJudgmentIds(row.sourceJudgmentIdsJson),
    adjustmentFeedback: row.adjustmentFeedback,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  }
}

function toTarget(row: typeof stageTargets.$inferSelect): StageTarget {
  if (!stageDimensionKeys.includes(row.dimensionKey as StageDimensionKey)) {
    throw new Error(`Unsupported stage dimension: ${row.dimensionKey}`)
  }
  if (row.status !== 'draft' && row.status !== 'confirmed') {
    throw new Error(`Unsupported stage target status: ${row.status}`)
  }
  return {
    id: row.id,
    stageId: row.stageId,
    schoolId: row.schoolId,
    dimensionKey: row.dimensionKey as StageDimensionKey,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  }
}

function assertScope(recommendation: StageRecommendation): void {
  const { stage, targets } = recommendation
  if (targets.length !== stageDimensionKeys.length) throw new Error('阶段目标数量不完整')
  if (
    targets.some(
      (target) => target.schoolId !== stage.schoolId || target.stageId !== recommendation.stage.id,
    )
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
      .all()
      .map(toTarget)
    const recommendation = { stage: toStage(row), targets }
    assertScope(recommendation)
    return recommendation
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

  async savePlanned(recommendation: StageRecommendation): Promise<void> {
    assertScope(recommendation)
    if (recommendation.stage.status !== 'planned') throw new Error('只能保存待确认阶段建议')
    if (recommendation.targets.some((target) => target.status !== 'draft')) {
      throw new Error('待确认阶段的目标必须保持草稿状态')
    }

    this.database.transaction((tx) => {
      const existing = tx
        .select({ id: stages.id })
        .from(stages)
        .where(eq(stages.schoolId, recommendation.stage.schoolId))
        .get()
      if (existing) throw new Error('这所学校已经有阶段记录')

      tx.insert(stages)
        .values({
          id: recommendation.stage.id,
          schoolId: recommendation.stage.schoolId,
          title: recommendation.stage.title,
          summary: recommendation.stage.summary,
          focus: recommendation.stage.focus,
          status: recommendation.stage.status,
          sourceJudgmentIdsJson: JSON.stringify(recommendation.stage.sourceJudgmentIds),
          adjustmentFeedback: recommendation.stage.adjustmentFeedback,
          createdAt: recommendation.stage.createdAt,
          activatedAt: recommendation.stage.activatedAt,
        })
        .run()

      for (const target of recommendation.targets) tx.insert(stageTargets).values(target).run()
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
          sourceJudgmentIdsJson: JSON.stringify(recommendation.stage.sourceJudgmentIds),
        })
        .where(eq(stages.id, recommendation.stage.id))
        .run()

      for (const target of recommendation.targets) {
        tx.update(stageTargets)
          .set({ text: target.text })
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
        .all()
      const recommendation: StageRecommendation = {
        stage: toStage(stageRow),
        targets: targetRows.map(toTarget),
      }
      assertScope(recommendation)

      if (recommendation.stage.status === 'active') return recommendation
      const active = activateStageRecommendation(recommendation, activatedAt)

      tx.update(stages)
        .set({ status: 'active', activatedAt: active.stage.activatedAt })
        .where(and(eq(stages.id, stageId), eq(stages.schoolId, schoolId)))
        .run()
      for (const target of active.targets) {
        tx.update(stageTargets)
          .set({ status: 'confirmed', confirmedAt: target.confirmedAt })
          .where(and(eq(stageTargets.id, target.id), eq(stageTargets.schoolId, schoolId)))
          .run()
      }

      return active
    })
  }
}
