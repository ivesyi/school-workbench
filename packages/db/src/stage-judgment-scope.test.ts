import { SchoolService, StageService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'
import { SqliteStageRepository } from './sqlite-stage-repository'
import { insertAcceptedJudgmentFixture } from './test-support'

/**
 * A school that already carries an accepted judgement, written straight to the
 * tables. The assessment contract cannot build this starting position: it needs
 * a confirmed stage, and the stage is what this slice is about.
 */
async function acceptedJudgment(
  database: WorkbenchDatabase,
  schools: SchoolService,
  name: string,
  text: string,
  suffix: string,
) {
  const school = await schools.create({ name })
  const judgment = insertAcceptedJudgmentFixture(database, {
    schoolId: school.id,
    statement: text,
    suffix,
  })
  return { school, judgment }
}

describe('stage judgment scope', () => {
  it('rejects a stage-to-judgment relation when the judgment belongs to another school', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-stage-scope-'))
    const database = openWorkbenchDatabase(
      join(directory, 'workbench.sqlite'),
      resolve('packages/db/drizzle'),
    )
    try {
      const schoolRepository = new SqliteSchoolRepository(database.db)
      const judgmentRepository = new SqliteJudgmentRepository(database.db)
      const stageRepository = new SqliteStageRepository(database.db)
      const schoolService = new SchoolService(schoolRepository)
      const first = await acceptedJudgment(
        database,
        schoolService,
        '甲校',
        '中层仍依赖校长推进。',
        'first',
      )
      const second = await acceptedJudgment(
        database,
        schoolService,
        '乙校',
        '教师开始稳定教研复盘。',
        'second',
      )

      const stageService = new StageService(schoolRepository, judgmentRepository, stageRepository)
      const workspace = await stageService.getWorkspace(first.school.id)
      if (workspace.state !== 'suggested') throw new Error('expected suggestion')
      const planned = await stageRepository.findById(workspace.stage.id)
      if (!planned) throw new Error('expected persisted stage')

      await expect(
        stageRepository.replacePlanned({
          ...planned,
          judgmentIds: [second.judgment.id],
        }),
      ).rejects.toThrow('阶段不能引用其他学校的正式判断')
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
