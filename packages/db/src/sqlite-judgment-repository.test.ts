import { JudgmentService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { seedActiveStage, seedSchool, submitAssistantProposal } from './test-support'

const temporaryDirectories: string[] = []
const migrationsFolder = resolve('packages/db/drizzle')
const SCHOOL = 'school-1'
const RUN = 'run-1'

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function countRows(client: { prepare(sql: string): { get(): unknown } }, table: string): number {
  const row = client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

function temporaryDatabasePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return join(directory, 'workbench.sqlite')
}

async function seededProposal(database: WorkbenchDatabase): Promise<string> {
  seedSchool(database, { schoolId: SCHOOL })
  seedActiveStage(database, { schoolId: SCHOOL })
  const { proposalId } = await submitAssistantProposal(database, {
    schoolId: SCHOOL,
    agentRunId: RUN,
  })
  return proposalId
}

describe('Judgment vertical slice persistence', () => {
  it('persists the full epistemic chain across a database reopen', async () => {
    const databasePath = temporaryDatabasePath('school-workbench-judgment-')

    const firstDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const proposalId = await seededProposal(firstDatabase)

    for (const table of [
      'evidence',
      'diagnosis_proposals',
      'diagnosis_claims',
      'diagnosis_criteria',
      'diagnosis_stage_targets',
    ]) {
      expect(countRows(firstDatabase.client, table)).toBe(1)
    }
    expect(countRows(firstDatabase.client, 'observation_facts')).toBe(2)
    expect(countRows(firstDatabase.client, 'claims')).toBe(1)
    expect(countRows(firstDatabase.client, 'claim_facts')).toBe(2)

    const judgmentService = new JudgmentService(new SqliteJudgmentRepository(firstDatabase.db))
    const outcome = await judgmentService.review({
      schoolId: SCHOOL,
      diagnosisId: proposalId,
      decision: 'accepted',
    })
    expect(outcome.acceptedJudgment?.text).toContain('教研组')
    expect(countRows(firstDatabase.client, 'human_reviews')).toBe(1)
    expect(countRows(firstDatabase.client, 'accepted_judgments')).toBe(1)
    expect(countRows(firstDatabase.client, 'judgment_claims')).toBe(1)
    firstDatabase.close()

    const secondDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const reopened = new JudgmentService(new SqliteJudgmentRepository(secondDatabase.db))
    const judgments = await reopened.listAccepted(SCHOOL)
    expect(judgments).toHaveLength(1)
    expect(judgments[0]?.proposalId).toBe(proposalId)
    secondDatabase.close()
  })

  it('persists needs-more-evidence as HumanReview without AcceptedJudgment', async () => {
    const database = openWorkbenchDatabase(
      temporaryDatabasePath('school-workbench-needs-evidence-'),
      migrationsFolder,
    )
    const proposalId = await seededProposal(database)
    const judgmentService = new JudgmentService(new SqliteJudgmentRepository(database.db))

    const outcome = await judgmentService.review({
      schoolId: SCHOOL,
      diagnosisId: proposalId,
      decision: 'needs_more_evidence',
    })

    expect(outcome.decision).toBe('needs_more_evidence')
    expect(outcome.acceptedJudgment).toBeNull()
    expect(countRows(database.client, 'human_reviews')).toBe(1)
    expect(countRows(database.client, 'accepted_judgments')).toBe(0)
    expect(countRows(database.client, 'judgment_claims')).toBe(0)
    expect(await judgmentService.listAccepted(SCHOOL)).toEqual([])
    database.close()
  })

  it('has no repository route that stores a proposal outside the assessment contract', () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    const repository = new SqliteJudgmentRepository(database.db)
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repository) as object).sort()
    expect(surface).toEqual([
      'constructor',
      'findLatestProposalIdByAgentRun',
      'findPendingProposalReview',
      'findProposal',
      'listAcceptedJudgments',
      'saveReviewOutcome',
    ])
    database.close()
  })
})
