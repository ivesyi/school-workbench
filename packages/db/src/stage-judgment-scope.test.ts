import { JudgmentService, SchoolService, StageService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'
import { SqliteStageRepository } from './sqlite-stage-repository'

async function acceptedJudgment(
  schools: SchoolService,
  judgments: JudgmentService,
  name: string,
  text: string,
) {
  const school = await schools.create({ name })
  const proposal = await judgments.submitSituation({ schoolId: school.id, text })
  const outcome = await judgments.review({
    schoolId: school.id,
    diagnosisId: proposal.proposal.id,
    decision: 'accepted',
  })
  if (!outcome.acceptedJudgment) throw new Error('expected accepted judgment')
  return { school, judgment: outcome.acceptedJudgment }
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
      const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)

      const first = await acceptedJudgment(
        schoolService,
        judgmentService,
        '甲校',
        '中层仍依赖校长推进。',
      )
      const second = await acceptedJudgment(
        schoolService,
        judgmentService,
        '乙校',
        '教师开始稳定教研复盘。',
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
