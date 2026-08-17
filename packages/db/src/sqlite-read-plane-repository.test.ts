import { MethodologyRegistry, type MethodologyRepository } from '@school-workbench/methodology'
import { WorkbenchReadCapabilityService } from '@school-workbench/workbench-read-plane'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import { SqliteReadPlaneRepository } from './sqlite-read-plane-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const dimensions = ['leadership', 'key_tasks', 'structure', 'culture', 'capability'] as const

function insertProposal(
  database: ReturnType<typeof openWorkbenchDatabase>,
  input: Readonly<{
    id: string
    schoolId: string
    createdAt: string
    title: string
  }>,
): void {
  database.client
    .prepare(
      `INSERT INTO diagnosis_proposals
       (id, school_id, agent_run_id, type, title, scope_json, interpretations_json,
        provisional_judgment, mechanism, alternative_hypotheses_json, unresolved_questions_json,
        recommended_actions_json, next_observations_json, impact_evidence_plan_json,
        evidence_quality_json, confidence, status, created_at)
       VALUES (?, ?, NULL, 'state', ?, ?, '[]', ?, NULL, '[]', '[]', '[]', '[]', '[]',
               ?, 'medium', 'proposed', ?)`,
    )
    .run(
      input.id,
      input.schoolId,
      input.title,
      JSON.stringify({ kind: 'school', schoolId: input.schoolId }),
      input.title,
      JSON.stringify({ directness: 'medium', triangulated: false }),
      input.createdAt,
    )
}

function insertAcceptedJudgment(
  database: ReturnType<typeof openWorkbenchDatabase>,
  input: Readonly<{
    proposalId: string
    reviewId: string
    judgmentId: string
    schoolId: string
    createdAt: string
    statement: string
  }>,
): void {
  database.client
    .prepare(
      `INSERT INTO human_reviews
       (id, proposal_id, decision, feedback, final_text, reason, reviewed_at)
       VALUES (?, ?, 'accepted', NULL, NULL, NULL, ?)`,
    )
    .run(input.reviewId, input.proposalId, input.createdAt)
  database.client
    .prepare(
      `INSERT INTO accepted_judgments
       (id, school_id, review_id, statement, scope_json, valid_from, valid_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      input.judgmentId,
      input.schoolId,
      input.reviewId,
      input.statement,
      JSON.stringify({ kind: 'school', schoolId: input.schoolId }),
      input.createdAt,
      input.createdAt,
    )
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'school-workbench-read-plane-'))
  temporaryDirectories.push(directory)
  const database = openWorkbenchDatabase(
    join(directory, 'workbench.sqlite'),
    resolve('packages/db/drizzle'),
  )
  const db = database.client

  db.prepare(`INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)`).run(
    'school-a',
    'A 学校',
    '2026-08-17T00:00:00.000Z',
  )
  db.prepare(`INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)`).run(
    'school-b',
    'B 学校',
    '2026-08-17T00:00:00.000Z',
  )

  db.prepare(
    `INSERT INTO stages
     (id, school_id, title, summary, focus, sequence, status, starts_at, ends_at,
      adjustment_feedback, created_at, updated_at)
     VALUES ('stage-a', 'school-a', '当前阶段', '阶段摘要', '阶段焦点', 1, 'active', ?, NULL, NULL, ?, ?)`,
  ).run('2026-08-17T00:10:00.000Z', '2026-08-17T00:10:00.000Z', '2026-08-17T00:10:00.000Z')
  for (const [index, dimension] of dimensions.entries()) {
    db.prepare(
      `INSERT INTO stage_targets
       (id, stage_id, school_id, dimension_key, title, description, status, sequence, created_at, updated_at)
       VALUES (?, 'stage-a', 'school-a', ?, ?, ?, 'confirmed', ?, ?, ?)`,
    ).run(
      `target-${dimension}`,
      dimension,
      `目标-${dimension}`,
      `说明-${dimension}`,
      index + 1,
      '2026-08-17T00:10:00.000Z',
      '2026-08-17T00:10:00.000Z',
    )
  }

  insertProposal(database, {
    id: 'proposal-a-1',
    schoolId: 'school-a',
    createdAt: '2026-08-17T00:20:00.000Z',
    title: '判断一',
  })
  insertAcceptedJudgment(database, {
    proposalId: 'proposal-a-1',
    reviewId: 'review-a-1',
    judgmentId: 'judgment-a-1',
    schoolId: 'school-a',
    createdAt: '2026-08-17T00:21:00.000Z',
    statement: 'A 学校正式判断一',
  })
  insertProposal(database, {
    id: 'proposal-a-2',
    schoolId: 'school-a',
    createdAt: '2026-08-17T00:30:00.000Z',
    title: '判断二',
  })
  insertAcceptedJudgment(database, {
    proposalId: 'proposal-a-2',
    reviewId: 'review-a-2',
    judgmentId: 'judgment-a-2',
    schoolId: 'school-a',
    createdAt: '2026-08-17T00:31:00.000Z',
    statement: 'A 学校正式判断二',
  })
  insertProposal(database, {
    id: 'proposal-b-1',
    schoolId: 'school-b',
    createdAt: '2026-08-17T00:40:00.000Z',
    title: 'B 学校判断',
  })

  db.prepare(
    `INSERT INTO claims
     (id, school_id, subject_ref_json, predicate_key, object_ref_json, statement, valid_from,
      valid_to, scope_json, created_by, agent_run_id, created_at)
     VALUES (?, ?, ?, 'swb:test', NULL, ?, ?, NULL, ?, 'agent', NULL, ?)`,
  ).run(
    'claim-a-1',
    'school-a',
    JSON.stringify({ kind: 'school', schoolId: 'school-a' }),
    'A claim',
    '2026-08-17T00:20:00.000Z',
    JSON.stringify({ kind: 'school', schoolId: 'school-a' }),
    '2026-08-17T00:20:00.000Z',
  )
  db.prepare(`INSERT INTO diagnosis_claims (proposal_id, claim_id) VALUES (?, ?)`).run(
    'proposal-a-1',
    'claim-a-1',
  )

  db.prepare(
    `INSERT INTO methodology_packs
     (id, key, version, title, source_type, source_ref, source_fingerprint, content_hash, status, created_at)
     VALUES ('pack-fixture', 'fixture', '1', 'Fixture', 'framework', 'references/fixture', ?, ?, 'review', ?)`,
  ).run('f'.repeat(64), 'c'.repeat(64), '2026-08-17T00:00:00.000Z')
  db.prepare(
    `INSERT INTO methodology_criteria
     (id, pack_id, stable_key, parent_id, construct_key, dimension_key, practice_type, title,
      description, evidence_guidance_json, counter_indicators_json, guardrails_json,
      source_locator_json, sequence)
     VALUES ('criterion-fixture', 'pack-fixture', 'FIX.C1', NULL, 'FIX.CONSTRUCT', 'leadership',
             'fixture_practice', 'Fixture C1', 'Fixture criterion', ?, '[]', ?, ?, 1)`,
  ).run(
    JSON.stringify({
      supportingIndicators: [],
      insufficientEvidence: [],
      counterexampleChecks: [],
      collectionPrinciples: [],
      adjustmentConditions: [],
    }),
    JSON.stringify({
      applicability: { appliesTo: ['fixture'], doesNotApplyTo: ['other'] },
      inferenceGuardrails: [],
    }),
    JSON.stringify({ label: 'fixture' }),
  )
  db.prepare(`INSERT INTO diagnosis_criteria (proposal_id, criterion_id) VALUES (?, ?)`).run(
    'proposal-a-1',
    'criterion-fixture',
  )
  db.prepare(
    `INSERT INTO diagnosis_stage_targets (proposal_id, stage_target_id) VALUES (?, ?)`,
  ).run('proposal-a-1', 'target-leadership')

  for (const [index, input] of [
    ['evidence-a-3', 'school-a', '2026-08-17T01:03:00.000Z', 'A3'],
    ['evidence-a-2', 'school-a', '2026-08-17T01:02:00.000Z', 'A2'],
    ['evidence-a-1', 'school-a', '2026-08-17T01:01:00.000Z', 'A1'],
    ['evidence-b-1', 'school-b', '2026-08-17T01:04:00.000Z', 'B1'],
  ] as const) {
    db.prepare(
      `INSERT INTO evidence
       (id, school_id, source_type, uri, inline_text, title, locator_json, content_hash,
        captured_at, registered_by, agent_run_id, created_at)
       VALUES (?, ?, 'pasted_text', NULL, ?, ?, ?, NULL, ?, 'human', NULL, ?)`,
    ).run(
      input[0],
      input[1],
      `${input[3]} ${'x'.repeat(400)}`,
      `Evidence ${index}`,
      JSON.stringify({ kind: 'fixture', row: index }),
      input[2],
      input[2],
    )
  }

  db.prepare(
    `INSERT INTO state_snapshots
     (id, school_id, stage_id, previous_snapshot_id, sequence, summary, is_baseline, confirmed_at, created_at)
     VALUES ('snapshot-1', 'school-a', 'stage-a', NULL, 1, '起点', 1, ?, ?)`,
  ).run('2026-08-17T02:00:00.000Z', '2026-08-17T02:00:00.000Z')
  db.prepare(
    `INSERT INTO state_snapshots
     (id, school_id, stage_id, previous_snapshot_id, sequence, summary, is_baseline, confirmed_at, created_at)
     VALUES ('snapshot-2', 'school-a', 'stage-a', 'snapshot-1', 2, '更新', 0, ?, ?)`,
  ).run('2026-08-17T03:00:00.000Z', '2026-08-17T03:00:00.000Z')
  db.prepare(`INSERT INTO snapshot_judgments (snapshot_id, judgment_id) VALUES (?, ?)`).run(
    'snapshot-1',
    'judgment-a-1',
  )
  for (const judgmentId of ['judgment-a-1', 'judgment-a-2']) {
    db.prepare(`INSERT INTO snapshot_judgments (snapshot_id, judgment_id) VALUES (?, ?)`).run(
      'snapshot-2',
      judgmentId,
    )
  }
  for (const snapshotId of ['snapshot-1', 'snapshot-2']) {
    for (const dimension of dimensions) {
      const assessmentId = `${snapshotId}-${dimension}`
      db.prepare(
        `INSERT INTO dimension_assessments
         (id, snapshot_id, dimension_key, status, summary, created_at)
         VALUES (?, ?, ?, 'partial', ?, ?)`,
      ).run(
        assessmentId,
        snapshotId,
        dimension,
        `${snapshotId} ${dimension}`,
        snapshotId === 'snapshot-1' ? '2026-08-17T02:00:00.000Z' : '2026-08-17T03:00:00.000Z',
      )
      db.prepare(`INSERT INTO assessment_judgments (assessment_id, judgment_id) VALUES (?, ?)`).run(
        assessmentId,
        snapshotId === 'snapshot-1' ? 'judgment-a-1' : 'judgment-a-2',
      )
    }
  }

  return database
}

function emptyMethodologyRepository(): MethodologyRepository {
  return {
    listPacks: async () => [],
    getPack: async () => null,
    getCriterion: async () => null,
    findCriteria: async () => [],
  }
}

describe('SqliteReadPlaneRepository', () => {
  it('keeps school scope isolated and returns current stage/state with five-dimensional provenance', async () => {
    const database = fixture()
    const repository = new SqliteReadPlaneRepository(database)
    const service = new WorkbenchReadCapabilityService(
      repository,
      new MethodologyRegistry([]),
      emptyMethodologyRepository(),
    )

    const context = await service.schoolContext('school-a', {})
    expect(context.school.id).toBe('school-a')
    expect(context.activeStage?.id).toBe('stage-a')
    expect(context.latestSnapshot?.sequence).toBe(2)
    expect(context.recentJudgments.map((item) => item.id)).toEqual(['judgment-a-2', 'judgment-a-1'])

    const stage = await service.stageCurrent('school-a', {})
    expect(stage.status).toBe('present')
    if (stage.status !== 'present') throw new Error('expected active stage')
    expect(stage.stage.targets).toHaveLength(5)
    expect(stage.stage.targets.map((target) => target.dimensionKey)).toEqual(dimensions)

    const current = await service.stateCurrent('school-a', {})
    expect(current.status).toBe('present')
    if (current.status !== 'present') throw new Error('expected current state')
    expect(current.state.snapshot.sequence).toBe(2)
    expect(current.state.assessments).toHaveLength(5)
    expect(current.state.assessments.map((item) => item.dimensionKey)).toEqual(dimensions)
    expect(current.state.judgmentIds).toEqual(['judgment-a-2', 'judgment-a-1'])
    expect(current.state.assessments.every((item) => item.judgmentIds[0] === 'judgment-a-2')).toBe(
      true,
    )

    await expect(service.stageCurrent('school-b', {})).resolves.toEqual({
      status: 'absent',
      reason: 'no_active_stage',
    })
    await expect(service.stateCurrent('school-b', {})).resolves.toEqual({
      status: 'absent',
      reason: 'no_snapshot',
    })
    const bContext = await service.schoolContext('school-b', {})
    expect(bContext.recentJudgments).toEqual([])

    database.close()
  })

  it('paginates state history, Evidence, and Diagnosis deterministically without leaking another school', async () => {
    const database = fixture()
    const repository = new SqliteReadPlaneRepository(database)
    const service = new WorkbenchReadCapabilityService(
      repository,
      new MethodologyRegistry([]),
      emptyMethodologyRepository(),
    )

    const firstHistory = await service.stateHistory('school-a', { limit: 1 })
    expect(firstHistory.items.map((item) => item.snapshot.sequence)).toEqual([2])
    expect(firstHistory.nextBeforeSequence).toBe(2)
    const secondHistory = await service.stateHistory('school-a', {
      limit: 1,
      beforeSequence: firstHistory.nextBeforeSequence ?? undefined,
    })
    expect(secondHistory.items.map((item) => item.snapshot.sequence)).toEqual([1])
    expect(secondHistory.nextBeforeSequence).toBeNull()

    const evidencePage1 = await service.evidenceList('school-a', { limit: 2 })
    expect(evidencePage1.items.map((item) => item.id)).toEqual(['evidence-a-3', 'evidence-a-2'])
    expect(evidencePage1.items.every((item) => (item.preview?.length ?? 0) <= 240)).toBe(true)
    expect(JSON.stringify(evidencePage1)).not.toContain('evidence-b-1')
    const evidencePage2 = await service.evidenceList('school-a', {
      limit: 2,
      cursor: evidencePage1.nextCursor ?? undefined,
    })
    expect(evidencePage2.items.map((item) => item.id)).toEqual(['evidence-a-1'])
    expect(evidencePage2.nextCursor).toBeNull()

    const diagnosisPage1 = await service.diagnosisList('school-a', { limit: 1 })
    expect(diagnosisPage1.items.map((item) => item.id)).toEqual(['proposal-a-2'])
    const diagnosisPage2 = await service.diagnosisList('school-a', {
      limit: 1,
      cursor: diagnosisPage1.nextCursor ?? undefined,
    })
    expect(diagnosisPage2.items.map((item) => item.id)).toEqual(['proposal-a-1'])
    expect(diagnosisPage2.items[0]).toMatchObject({
      claimIds: ['claim-a-1'],
      stageTargetIds: ['target-leadership'],
      criteria: [
        {
          criterionId: 'criterion-fixture',
          stableKey: 'FIX.C1',
          packKey: 'fixture',
          version: '1',
        },
      ],
    })
    expect(JSON.stringify(diagnosisPage2)).not.toContain('proposal-b-1')
    expect(JSON.stringify(diagnosisPage2)).not.toContain('decision')

    database.close()
  })
})
