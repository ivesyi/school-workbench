import { JudgmentService, SchoolService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function countRows(client: { prepare(sql: string): { get(): unknown } }, table: string): number {
  const row = client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

describe('Judgment vertical slice persistence', () => {
  it('persists the full epistemic chain across a database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-judgment-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')

    const firstDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const schoolRepository = new SqliteSchoolRepository(firstDatabase.db)
    const school = await new SchoolService(schoolRepository).create({ name: '南山实验学校' })
    const judgmentService = new JudgmentService(
      schoolRepository,
      new SqliteJudgmentRepository(firstDatabase.db),
    )

    const proposal = await judgmentService.submitSituation({
      schoolId: school.id,
      text: '中层会议里仍由校长完成任务拆解。',
    })

    for (const table of [
      'evidence',
      'observation_facts',
      'claims',
      'claim_facts',
      'diagnosis_proposals',
      'diagnosis_claims',
    ]) {
      expect(countRows(firstDatabase.client, table)).toBe(1)
    }

    const outcome = await judgmentService.review({
      schoolId: school.id,
      diagnosisId: proposal.proposal.id,
      decision: 'accepted',
    })
    expect(outcome.acceptedJudgment?.text).toContain('校长')
    expect(countRows(firstDatabase.client, 'human_reviews')).toBe(1)
    expect(countRows(firstDatabase.client, 'accepted_judgments')).toBe(1)
    expect(countRows(firstDatabase.client, 'judgment_claims')).toBe(1)
    firstDatabase.close()

    const secondDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const reopened = new JudgmentService(
      new SqliteSchoolRepository(secondDatabase.db),
      new SqliteJudgmentRepository(secondDatabase.db),
    )
    const judgments = await reopened.listAccepted(school.id)
    expect(judgments).toHaveLength(1)
    expect(judgments[0]?.proposalId).toBe(proposal.proposal.id)
    secondDatabase.close()
  })

  it('persists needs-more-evidence as HumanReview without AcceptedJudgment', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-needs-evidence-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')

    const database = openWorkbenchDatabase(databasePath, migrationsFolder)
    const schoolRepository = new SqliteSchoolRepository(database.db)
    const school = await new SchoolService(schoolRepository).create({ name: '南山实验学校' })
    const judgmentService = new JudgmentService(
      schoolRepository,
      new SqliteJudgmentRepository(database.db),
    )

    const proposal = await judgmentService.submitSituation({
      schoolId: school.id,
      text: '中层会议里仍由校长完成任务拆解。',
    })
    const outcome = await judgmentService.review({
      schoolId: school.id,
      diagnosisId: proposal.proposal.id,
      decision: 'needs_more_evidence',
    })

    expect(outcome.decision).toBe('needs_more_evidence')
    expect(outcome.acceptedJudgment).toBeNull()
    expect(countRows(database.client, 'human_reviews')).toBe(1)
    expect(countRows(database.client, 'accepted_judgments')).toBe(0)
    expect(countRows(database.client, 'judgment_claims')).toBe(0)
    expect(await judgmentService.listAccepted(school.id)).toEqual([])
    database.close()
  })
})
