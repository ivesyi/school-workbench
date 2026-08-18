import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/**
 * Direct access to the workbench database a running app uses.
 *
 * Two jobs here, and both exist because the product deliberately has no way to
 * do them:
 *
 *  - **Counting.** "Nothing was written" is the point of several of these
 *    flows, and only the database can prove it.
 *  - **Seeding a starting position.** Slices that begin from judgements a
 *    school already carries (stage recommendation, school state) cannot create
 *    those through the interface any more: a judgement is produced by an
 *    assistant against the assessment contract, and the contract needs a
 *    confirmed stage, which is what those slices are for. So the starting
 *    position is written straight to the tables here — never by the product.
 */
const requireFromDb = createRequire(resolve('packages/db/package.json'))

type Statement = {
  run(...parameters: unknown[]): unknown
  get(...parameters: unknown[]): unknown
}

export type SqliteHandle = {
  prepare(sql: string): Statement
  close(): void
}

const FIXTURE_NOW = '2026-08-18T00:00:00.000Z'

export function openWorkbenchSqlite(userDataDirectory: string): SqliteHandle {
  const Database = requireFromDb('better-sqlite3') as new (path: string) => SqliteHandle
  return new Database(join(userDataDirectory, 'school-workbench.sqlite'))
}

export function countRows(database: SqliteHandle, table: string): number {
  return (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
    .count
}

export function firstSchoolId(database: SqliteHandle): string {
  return (database.prepare('SELECT id FROM schools LIMIT 1').get() as { id: string }).id
}

export function seedProposedJudgment(
  database: SqliteHandle,
  options: { schoolId: string; statement: string; suffix: string; createdAt?: string },
): string {
  const proposalId = `e2e-proposal-${options.suffix}`
  const scopeJson = JSON.stringify({ kind: 'school', schoolId: options.schoolId })
  const createdAt = options.createdAt ?? FIXTURE_NOW
  const empty = '[]'

  database
    .prepare(
      `INSERT INTO diagnosis_proposals (id, school_id, agent_run_id, type, title, scope_json,
         interpretations_json, provisional_judgment, mechanism, alternative_hypotheses_json,
         unresolved_questions_json, recommended_actions_json, next_observations_json,
         impact_evidence_plan_json, evidence_quality_json, confidence, status, created_at)
       VALUES (?, ?, NULL, 'state', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'medium', 'proposed', ?)`,
    )
    .run(
      proposalId,
      options.schoolId,
      options.statement,
      scopeJson,
      empty,
      options.statement,
      empty,
      empty,
      empty,
      empty,
      empty,
      JSON.stringify({ directness: 'high', triangulated: true }),
      createdAt,
    )
  return proposalId
}

export function seedAcceptedJudgment(
  database: SqliteHandle,
  options: { schoolId: string; statement: string; suffix: string; createdAt?: string },
): void {
  const proposalId = seedProposedJudgment(database, options)
  const reviewId = `e2e-review-${options.suffix}`
  const judgmentId = `e2e-judgment-${options.suffix}`
  const scopeJson = JSON.stringify({ kind: 'school', schoolId: options.schoolId })
  const createdAt = options.createdAt ?? FIXTURE_NOW
  database
    .prepare(
      `INSERT INTO human_reviews (id, proposal_id, decision, feedback, final_text, reason, reviewed_at)
       VALUES (?, ?, 'accepted', NULL, NULL, NULL, ?)`,
    )
    .run(reviewId, proposalId, createdAt)
  database
    .prepare(
      `INSERT INTO accepted_judgments (id, school_id, review_id, statement, scope_json,
         valid_from, valid_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(judgmentId, options.schoolId, reviewId, options.statement, scopeJson, createdAt, createdAt)
}
