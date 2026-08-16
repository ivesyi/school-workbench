import { JudgmentService, SchoolService, StageService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import { stageTargets, stages } from './schema'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'
import { SqliteStageRepository } from './sqlite-stage-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function countRows(
  client: { prepare(sql: string): { get(): unknown } },
  table: string,
  where = '',
): number {
  const row = client.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as {
    count: number
  }
  return row.count
}

async function createAcceptedJudgment(
  schoolService: SchoolService,
  judgmentService: JudgmentService,
  name = '南山实验学校',
  text = '中层会议里仍由校长完成任务拆解。',
) {
  const school = await schoolService.create({ name })
  const proposal = await judgmentService.submitSituation({ schoolId: school.id, text })
  const outcome = await judgmentService.review({
    schoolId: school.id,
    diagnosisId: proposal.proposal.id,
    decision: 'accepted',
  })
  if (!outcome.acceptedJudgment) throw new Error('expected accepted judgment')
  return { school, judgment: outcome.acceptedJudgment }
}

describe('stage recommendation persistence', () => {
  it('persists canonical planned/draft data, join relations, atomic activation, and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-stage-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')

    const firstDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const schoolRepository = new SqliteSchoolRepository(firstDatabase.db)
    const judgmentRepository = new SqliteJudgmentRepository(firstDatabase.db)
    const stageRepository = new SqliteStageRepository(firstDatabase.db)
    const schoolService = new SchoolService(schoolRepository)
    const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)
    const { school } = await createAcceptedJudgment(schoolService, judgmentService)

    const stageService = new StageService(schoolRepository, judgmentRepository, stageRepository)
    const suggested = await stageService.getWorkspace(school.id)
    expect(suggested.state).toBe('suggested')
    if (suggested.state !== 'suggested') throw new Error('expected stage suggestion')
    expect(countRows(firstDatabase.client, 'stages', "WHERE status = 'planned'")).toBe(1)
    expect(countRows(firstDatabase.client, 'stage_targets', "WHERE status = 'draft'")).toBe(5)
    expect(countRows(firstDatabase.client, 'stage_judgments')).toBe(1)

    const dimensions = firstDatabase.client
      .prepare('SELECT dimension_key FROM stage_targets ORDER BY sequence')
      .all() as Array<{ dimension_key: string }>
    expect(dimensions.map((item) => item.dimension_key)).toEqual([
      'leadership',
      'key_tasks',
      'structure',
      'culture',
      'capability',
    ])

    const active = await stageService.confirm({ schoolId: school.id, stageId: suggested.stage.id })
    expect(active.state).toBe('active')
    expect(countRows(firstDatabase.client, 'stages', "WHERE status = 'active'")).toBe(1)
    expect(countRows(firstDatabase.client, 'stage_targets', "WHERE status = 'confirmed'")).toBe(5)
    expect(countRows(firstDatabase.client, 'stage_targets', "WHERE status = 'draft'")).toBe(0)
    firstDatabase.close()

    const secondDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const reopened = new StageService(
      new SqliteSchoolRepository(secondDatabase.db),
      new SqliteJudgmentRepository(secondDatabase.db),
      new SqliteStageRepository(secondDatabase.db),
    )
    const restored = await reopened.getWorkspace(school.id)
    expect(restored.state).toBe('active')
    if (restored.state === 'active') expect(restored.stage.targets).toHaveLength(5)
    secondDatabase.close()
  })

  it('enforces at most one active stage per school in repository and database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-stage-unique-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const schoolRepository = new SqliteSchoolRepository(database.db)
    const judgmentRepository = new SqliteJudgmentRepository(database.db)
    const stageRepository = new SqliteStageRepository(database.db)
    const schoolService = new SchoolService(schoolRepository)
    const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)
    const { school } = await createAcceptedJudgment(schoolService, judgmentService)
    const service = new StageService(schoolRepository, judgmentRepository, stageRepository)
    const suggested = await service.getWorkspace(school.id)
    if (suggested.state !== 'suggested') throw new Error('expected suggestion')
    await service.confirm({ schoolId: school.id, stageId: suggested.stage.id })

    expect(() =>
      database.db
        .insert(stages)
        .values({
          id: 'second-active',
          schoolId: school.id,
          title: '另一个当前阶段',
          summary: '不应保存',
          focus: '不应保存',
          sequence: 2,
          status: 'active',
          startsAt: '2026-08-17T02:00:00.000Z',
          endsAt: null,
          adjustmentFeedback: null,
          createdAt: '2026-08-17T02:00:00.000Z',
          updatedAt: '2026-08-17T02:00:00.000Z',
        })
        .run(),
    ).toThrow()

    database.db
      .insert(stages)
      .values({
        id: 'second-planned',
        schoolId: school.id,
        title: '另一个建议',
        summary: '用于验证 repository guard',
        focus: '用于验证 repository guard',
        sequence: 2,
        status: 'planned',
        startsAt: null,
        endsAt: null,
        adjustmentFeedback: null,
        createdAt: '2026-08-17T03:00:00.000Z',
        updatedAt: '2026-08-17T03:00:00.000Z',
      })
      .run()

    await expect(
      stageRepository.activate(school.id, 'second-planned', new Date('2026-08-17T03:10:00.000Z')),
    ).rejects.toThrow('已经有当前阶段')
    database.close()
  })

  it('allows a new planned stage after completed history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-stage-history-'))
    temporaryDirectories.push(directory)
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    const schoolRepository = new SqliteSchoolRepository(database.db)
    const judgmentRepository = new SqliteJudgmentRepository(database.db)
    const stageRepository = new SqliteStageRepository(database.db)
    const schoolService = new SchoolService(schoolRepository)
    const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)
    const { school } = await createAcceptedJudgment(schoolService, judgmentService)
    const service = new StageService(schoolRepository, judgmentRepository, stageRepository)
    const first = await service.getWorkspace(school.id)
    if (first.state !== 'suggested') throw new Error('expected suggestion')
    await service.confirm({ schoolId: school.id, stageId: first.stage.id })

    const completedAt = '2026-08-17T04:00:00.000Z'
    database.db
      .update(stages)
      .set({ status: 'completed', endsAt: completedAt, updatedAt: completedAt })
      .run()
    database.db.update(stageTargets).set({ status: 'retired', updatedAt: completedAt }).run()

    const next = await service.getWorkspace(school.id)
    expect(next.state).toBe('suggested')
    const rows = database.client
      .prepare('SELECT sequence, status FROM stages ORDER BY sequence')
      .all() as Array<{ sequence: number; status: string }>
    expect(rows).toEqual([
      { sequence: 1, status: 'completed' },
      { sequence: 2, status: 'planned' },
    ])
    database.close()
  })
})
