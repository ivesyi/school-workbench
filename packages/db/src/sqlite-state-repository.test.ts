import {
  BaselineStateAssessmentEngine,
  JudgmentService,
  SchoolService,
  StageService,
  StateService,
} from '@school-workbench/application'
import { createBaselineState, createNextState } from '@school-workbench/domain'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import {
  assessmentJudgments,
  dimensionAssessments,
  snapshotJudgments,
  stateSnapshots,
} from './schema'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'
import { SqliteStageRepository } from './sqlite-stage-repository'
import { SqliteStateRepository } from './sqlite-state-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function countRows(
  client: { prepare(sql: string): { get(...params: unknown[]): unknown } },
  table: string,
  where = '',
  params: unknown[] = [],
): number {
  const row = client.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as {
    count: number
  }
  return row.count
}

async function addAcceptedJudgment(
  judgmentService: JudgmentService,
  schoolId: string,
  text: string,
) {
  const proposal = await judgmentService.submitSituation({ schoolId, text })
  const outcome = await judgmentService.review({
    schoolId,
    diagnosisId: proposal.proposal.id,
    decision: 'accepted',
  })
  if (!outcome.acceptedJudgment) throw new Error('expected accepted judgment')
  return outcome.acceptedJudgment
}

async function prepareSchoolWithActiveStage(database: ReturnType<typeof openWorkbenchDatabase>) {
  const schoolRepository = new SqliteSchoolRepository(database.db)
  const judgmentRepository = new SqliteJudgmentRepository(database.db)
  const stageRepository = new SqliteStageRepository(database.db)
  const schoolService = new SchoolService(schoolRepository, stageRepository)
  const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)
  const stageService = new StageService(schoolRepository, judgmentRepository, stageRepository)
  const school = await schoolService.create({ name: '南山实验学校' })
  const first = await addAcceptedJudgment(
    judgmentService,
    school.id,
    '中层仍然依赖校长完成关键任务拆解。',
  )
  const suggestion = await stageService.getWorkspace(school.id)
  if (suggestion.state !== 'suggested') throw new Error('expected stage suggestion')
  const second = await addAcceptedJudgment(
    judgmentService,
    school.id,
    '教师已经开始稳定教研复盘，能够根据课堂情况调整。',
  )
  await stageService.confirm({ schoolId: school.id, stageId: suggestion.stage.id })
  return {
    school,
    first,
    second,
    schoolRepository,
    judgmentRepository,
    stageRepository,
    schoolService,
    judgmentService,
  }
}

async function confirmBaseline(
  prepared: Awaited<ReturnType<typeof prepareSchoolWithActiveStage>>,
  stateRepository: SqliteStateRepository,
) {
  const stateService = new StateService(
    prepared.schoolRepository,
    prepared.judgmentRepository,
    prepared.stageRepository,
    stateRepository,
  )
  const draft = await stateService.getWorkspace(prepared.school.id)
  if (draft.state !== 'draft') throw new Error('expected baseline draft')
  await stateService.confirm({ schoolId: prepared.school.id })
  const baseline = await stateRepository.findLatest(prepared.school.id)
  if (!baseline) throw new Error('expected baseline')
  return { stateService, baseline }
}

describe('school state persistence', () => {
  it('persists snapshot #1 atomically with five assessments and exact judgment provenance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')
    const firstDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const prepared = await prepareSchoolWithActiveStage(firstDatabase)
    const stateRepository = new SqliteStateRepository(firstDatabase.db)
    const stateService = new StateService(
      prepared.schoolRepository,
      prepared.judgmentRepository,
      prepared.stageRepository,
      stateRepository,
    )

    const draft = await stateService.getWorkspace(prepared.school.id)
    expect(draft.state).toBe('draft')
    expect(countRows(firstDatabase.client, 'state_snapshots')).toBe(0)

    const adjusted = await stateService.adjust({
      schoolId: prepared.school.id,
      feedback: '领导力这部分先别判断，还需要更多观察',
    })
    expect(adjusted.state).toBe('draft')
    expect(countRows(firstDatabase.client, 'state_snapshots')).toBe(0)

    const confirmed = await stateService.confirm({ schoolId: prepared.school.id })
    expect(confirmed.state).toBe('baseline')
    expect(countRows(firstDatabase.client, 'state_snapshots')).toBe(1)
    expect(countRows(firstDatabase.client, 'dimension_assessments')).toBe(5)

    const snapshot = firstDatabase.client
      .prepare(
        'SELECT sequence, is_baseline, previous_snapshot_id, stage_id FROM state_snapshots WHERE school_id = ?',
      )
      .get(prepared.school.id) as Record<string, unknown>
    expect(snapshot).toMatchObject({
      sequence: 1,
      is_baseline: 1,
      previous_snapshot_id: null,
    })
    expect(snapshot.stage_id).toBeTruthy()

    const snapshotProvenance = firstDatabase.client
      .prepare('SELECT judgment_id FROM snapshot_judgments ORDER BY judgment_id')
      .all() as Array<{ judgment_id: string }>
    expect(snapshotProvenance.map((item) => item.judgment_id).sort()).toEqual(
      [prepared.first.id, prepared.second.id].sort(),
    )

    const nonUnverified = firstDatabase.client
      .prepare("SELECT id FROM dimension_assessments WHERE status <> 'unverified'")
      .all() as Array<{ id: string }>
    for (const row of nonUnverified) {
      expect(
        countRows(firstDatabase.client, 'assessment_judgments', 'WHERE assessment_id = ?', [
          row.id,
        ]),
      ).toBeGreaterThan(0)
    }

    firstDatabase.close()
    const secondDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const restored = await new StateService(
      new SqliteSchoolRepository(secondDatabase.db),
      new SqliteJudgmentRepository(secondDatabase.db),
      new SqliteStageRepository(secondDatabase.db),
      new SqliteStateRepository(secondDatabase.db),
    ).getWorkspace(prepared.school.id)
    expect(restored.state).toBe('baseline')
    secondDatabase.close()
  })

  it('persists snapshot #2 with continuous sequence, previous link, full provenance and immutable baseline history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-next-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')
    const database = openWorkbenchDatabase(databasePath, migrationsFolder)
    const prepared = await prepareSchoolWithActiveStage(database)
    const stateRepository = new SqliteStateRepository(database.db)
    const { stateService, baseline } = await confirmBaseline(prepared, stateRepository)
    const baselineSummary = baseline.snapshot.summary
    const baselineAssessments = baseline.assessments.map((item) => ({
      dimension: item.assessment.dimensionKey,
      status: item.assessment.status,
      summary: item.assessment.summary,
    }))

    const third = await addAcceptedJudgment(
      prepared.judgmentService,
      prepared.school.id,
      '中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。',
    )
    const update = await stateService.getWorkspace(prepared.school.id)
    expect(update.state).toBe('update_draft')
    if (update.state !== 'update_draft') throw new Error('expected update draft')
    expect(update.change.newJudgmentCount).toBe(1)
    expect(countRows(database.client, 'state_snapshots')).toBe(1)

    const adjusted = await stateService.adjust({
      schoolId: prepared.school.id,
      feedback: '文化这部分先别判断，还需要更多观察',
    })
    expect(adjusted.state).toBe('update_draft')
    expect(countRows(database.client, 'state_snapshots')).toBe(1)

    const confirmed = await stateService.confirm({ schoolId: prepared.school.id })
    expect(confirmed.state).toBe('current')
    expect(countRows(database.client, 'state_snapshots')).toBe(2)
    expect(countRows(database.client, 'dimension_assessments')).toBe(10)

    const rows = database.client
      .prepare(
        'SELECT id, sequence, is_baseline, previous_snapshot_id FROM state_snapshots WHERE school_id = ? ORDER BY sequence',
      )
      .all(prepared.school.id) as Array<{
      id: string
      sequence: number
      is_baseline: number
      previous_snapshot_id: string | null
    }>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ sequence: 1, is_baseline: 1, previous_snapshot_id: null })
    expect(rows[1]).toMatchObject({ sequence: 2, is_baseline: 0, previous_snapshot_id: rows[0]?.id })

    const secondProvenance = database.client
      .prepare('SELECT judgment_id FROM snapshot_judgments WHERE snapshot_id = ? ORDER BY judgment_id')
      .all(rows[1]?.id) as Array<{ judgment_id: string }>
    expect(secondProvenance.map((item) => item.judgment_id).sort()).toEqual(
      [prepared.first.id, prepared.second.id, third.id].sort(),
    )

    const restoredBaseline = await stateRepository.findById(baseline.snapshot.id)
    expect(restoredBaseline?.snapshot.summary).toBe(baselineSummary)
    expect(
      restoredBaseline?.assessments.map((item) => ({
        dimension: item.assessment.dimensionKey,
        status: item.assessment.status,
        summary: item.assessment.summary,
      })),
    ).toEqual(baselineAssessments)

    const repeated = await stateService.confirm({ schoolId: prepared.school.id })
    expect(repeated.state).toBe('current')
    expect(countRows(database.client, 'state_snapshots')).toBe(2)

    database.close()
    const reopened = openWorkbenchDatabase(databasePath, migrationsFolder)
    const restored = await new StateService(
      new SqliteSchoolRepository(reopened.db),
      new SqliteJudgmentRepository(reopened.db),
      new SqliteStageRepository(reopened.db),
      new SqliteStateRepository(reopened.db),
    ).getWorkspace(prepared.school.id)
    expect(restored.state).toBe('current')
    if (restored.state === 'current') {
      expect(restored.change.newJudgmentCount).toBe(1)
      expect(restored.change.dimensions).toHaveLength(5)
    }
    reopened.close()
  })

  it('rejects stale saveNext and keeps the history chain unchanged', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-stale-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const prepared = await prepareSchoolWithActiveStage(database)
    const stateRepository = new SqliteStateRepository(database.db)
    const { baseline } = await confirmBaseline(prepared, stateRepository)
    await addAcceptedJudgment(
      prepared.judgmentService,
      prepared.school.id,
      '中层已经能够独立完成关键任务拆解，校长开始授权。',
    )
    const stage = await prepared.stageRepository.findActive(prepared.school.id)
    if (!stage) throw new Error('expected active stage')
    const judgments = await prepared.judgmentRepository.listAcceptedJudgments(prepared.school.id)
    const engine = new BaselineStateAssessmentEngine()
    const draft = await engine.assess(stage, judgments)
    const firstCandidate = createNextState(prepared.school.id, baseline, draft)
    const staleCandidate = createNextState(prepared.school.id, baseline, draft)

    await stateRepository.saveNext(firstCandidate, baseline.snapshot.id)
    await expect(stateRepository.saveNext(staleCandidate, baseline.snapshot.id)).rejects.toThrow(
      '已经有更新',
    )
    expect(countRows(database.client, 'state_snapshots')).toBe(2)
    expect((await stateRepository.findLatest(prepared.school.id))?.snapshot.id).toBe(
      firstCandidate.snapshot.id,
    )
    database.close()
  })

  it('rejects cross-school Stage/Judgment provenance before writing a subsequent state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-scope-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const prepared = await prepareSchoolWithActiveStage(database)
    const stateRepository = new SqliteStateRepository(database.db)
    const { baseline } = await confirmBaseline(prepared, stateRepository)
    const ownNewJudgment = await addAcceptedJudgment(
      prepared.judgmentService,
      prepared.school.id,
      '中层已经能够独立完成关键任务拆解，校长开始授权。',
    )
    const otherSchool = await prepared.schoolService.create({ name: '滨江学校' })
    const otherJudgment = await addAcceptedJudgment(
      prepared.judgmentService,
      otherSchool.id,
      '滨江学校的教师已经稳定开展复盘。',
    )

    const activeStage = await prepared.stageRepository.findActive(prepared.school.id)
    if (!activeStage) throw new Error('expected active stage')
    const ownJudgments = await prepared.judgmentRepository.listAcceptedJudgments(prepared.school.id)
    const engine = new BaselineStateAssessmentEngine()
    const draft = await engine.assess(activeStage, ownJudgments)
    const poisoned = {
      ...draft,
      judgmentIds: [...draft.judgmentIds, otherJudgment.id],
      assessments: draft.assessments.map((item, index) =>
        index === 0 ? { ...item, judgmentIds: [...item.judgmentIds, otherJudgment.id] } : item,
      ),
    }
    expect(poisoned.judgmentIds).toContain(ownNewJudgment.id)
    const record = createNextState(prepared.school.id, baseline, poisoned)

    await expect(stateRepository.saveNext(record, baseline.snapshot.id)).rejects.toThrow(
      '不能引用其他学校的正式判断',
    )
    expect(countRows(database.client, 'state_snapshots')).toBe(1)
    database.close()
  })

  it('does not create a new state when there are no new accepted judgments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-nonew-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const prepared = await prepareSchoolWithActiveStage(database)
    const stateRepository = new SqliteStateRepository(database.db)
    const { stateService } = await confirmBaseline(prepared, stateRepository)

    const current = await stateService.getWorkspace(prepared.school.id)
    expect(current.state).toBe('baseline')
    const repeated = await stateService.confirm({ schoolId: prepared.school.id })
    expect(repeated.state).toBe('baseline')
    expect(countRows(database.client, 'state_snapshots')).toBe(1)
    database.close()
  })
})

void stateSnapshots
void dimensionAssessments
void assessmentJudgments
void snapshotJudgments
