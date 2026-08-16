import {
  BaselineStateAssessmentEngine,
  JudgmentService,
  SchoolService,
  StageService,
  StateService,
} from '@school-workbench/application'
import { createBaselineState } from '@school-workbench/domain'
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

describe('baseline school state persistence', () => {
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
        countRows(
          firstDatabase.client,
          'assessment_judgments',
          'WHERE assessment_id = ?',
          [row.id],
        ),
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
    if (restored.state === 'baseline') {
      expect(restored.overview.dimensions).toHaveLength(5)
      expect(
        restored.overview.dimensions.find((item) => item.dimensionKey === 'leadership')?.status,
      ).toBe('unverified')
    }
    secondDatabase.close()
  })

  it('keeps the first snapshot immutable and repeated confirmation cannot create a second baseline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-immutable-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const prepared = await prepareSchoolWithActiveStage(database)
    const stateRepository = new SqliteStateRepository(database.db)
    const service = new StateService(
      prepared.schoolRepository,
      prepared.judgmentRepository,
      prepared.stageRepository,
      stateRepository,
    )

    await service.getWorkspace(prepared.school.id)
    await service.confirm({ schoolId: prepared.school.id })
    const before = await stateRepository.findLatest(prepared.school.id)
    if (!before) throw new Error('expected baseline')

    const repeated = await service.confirm({ schoolId: prepared.school.id })
    expect(repeated.state).toBe('baseline')
    expect(countRows(database.client, 'state_snapshots')).toBe(1)

    await expect(
      stateRepository.saveBaseline({
        ...before,
        snapshot: { ...before.snapshot, summary: '不应覆盖原来的起点状态' },
      }),
    ).rejects.toThrow('已经记录了起点状态')
    expect((await stateRepository.findLatest(prepared.school.id))?.snapshot.summary).toBe(
      before.snapshot.summary,
    )
    database.close()
  })

  it('rejects cross-school Stage/Judgment provenance before writing a baseline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-state-scope-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const prepared = await prepareSchoolWithActiveStage(database)
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
        index === 0
          ? { ...item, judgmentIds: [...item.judgmentIds, otherJudgment.id] }
          : item,
      ),
    }
    const record = createBaselineState(prepared.school.id, poisoned)
    const stateRepository = new SqliteStateRepository(database.db)

    await expect(stateRepository.saveBaseline(record)).rejects.toThrow(
      '不能引用其他学校的正式判断',
    )
    expect(countRows(database.client, 'state_snapshots')).toBe(0)
    database.close()
  })
})

void stateSnapshots
void dimensionAssessments
void assessmentJudgments
void snapshotJudgments
