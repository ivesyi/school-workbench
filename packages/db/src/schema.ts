import { sql } from 'drizzle-orm'
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

export const schools = sqliteTable('schools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
})

export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    uri: text('uri'),
    inlineText: text('inline_text'),
    title: text('title').notNull(),
    locatorJson: text('locator_json'),
    contentHash: text('content_hash'),
    capturedAt: text('captured_at'),
    registeredBy: text('registered_by').notNull(),
    agentRunId: text('agent_run_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    // Decision L7: the same material registered twice in one school is one
    // Evidence. Rows written before content hashing keep a NULL hash, and
    // SQLite treats NULLs as distinct, so they are unaffected.
    uniqueIndex('evidence_school_content_hash_unique').on(table.schoolId, table.contentHash),
  ],
)

export const observationFacts = sqliteTable('observation_facts', {
  id: text('id').primaryKey(),
  schoolId: text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' }),
  evidenceId: text('evidence_id')
    .notNull()
    .references(() => evidence.id, { onDelete: 'cascade' }),
  factType: text('fact_type').notNull(),
  text: text('text').notNull(),
  locatorJson: text('locator_json').notNull(),
  directness: text('directness').notNull(),
  extractedBy: text('extracted_by').notNull(),
  agentRunId: text('agent_run_id'),
  createdAt: text('created_at').notNull(),
})

export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  schoolId: text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' }),
  subjectRefJson: text('subject_ref_json').notNull(),
  predicateKey: text('predicate_key').notNull(),
  objectRefJson: text('object_ref_json'),
  statement: text('statement').notNull(),
  validFrom: text('valid_from'),
  validTo: text('valid_to'),
  scopeJson: text('scope_json').notNull(),
  createdBy: text('created_by').notNull(),
  agentRunId: text('agent_run_id'),
  createdAt: text('created_at').notNull(),
})

export const claimFacts = sqliteTable(
  'claim_facts',
  {
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    factId: text('fact_id')
      .notNull()
      .references(() => observationFacts.id, { onDelete: 'cascade' }),
    stance: text('stance').notNull(),
    sequence: integer('sequence').notNull(),
  },
  (table) => [primaryKey({ columns: [table.claimId, table.factId, table.stance] })],
)

export const diagnosisProposals = sqliteTable('diagnosis_proposals', {
  id: text('id').primaryKey(),
  schoolId: text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' }),
  agentRunId: text('agent_run_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  scopeJson: text('scope_json').notNull(),
  interpretationsJson: text('interpretations_json').notNull(),
  provisionalJudgment: text('provisional_judgment'),
  mechanism: text('mechanism'),
  alternativeHypothesesJson: text('alternative_hypotheses_json').notNull(),
  unresolvedQuestionsJson: text('unresolved_questions_json').notNull(),
  recommendedActionsJson: text('recommended_actions_json').notNull(),
  nextObservationsJson: text('next_observations_json').notNull(),
  impactEvidencePlanJson: text('impact_evidence_plan_json').notNull(),
  evidenceQualityJson: text('evidence_quality_json').notNull(),
  confidence: text('confidence').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
})

export const diagnosisClaims = sqliteTable(
  'diagnosis_claims',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => diagnosisProposals.id, { onDelete: 'cascade' }),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.claimId] })],
)

export const humanReviews = sqliteTable('human_reviews', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id')
    .notNull()
    .unique()
    .references(() => diagnosisProposals.id, { onDelete: 'cascade' }),
  decision: text('decision').notNull(),
  feedback: text('feedback'),
  finalText: text('final_text'),
  reason: text('reason'),
  reviewedAt: text('reviewed_at').notNull(),
})

export const acceptedJudgments = sqliteTable('accepted_judgments', {
  id: text('id').primaryKey(),
  schoolId: text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' }),
  reviewId: text('review_id')
    .notNull()
    .unique()
    .references(() => humanReviews.id, { onDelete: 'cascade' }),
  statement: text('statement').notNull(),
  scopeJson: text('scope_json').notNull(),
  validFrom: text('valid_from'),
  validTo: text('valid_to'),
  createdAt: text('created_at').notNull(),
})

export const judgmentClaims = sqliteTable(
  'judgment_claims',
  {
    judgmentId: text('judgment_id')
      .notNull()
      .references(() => acceptedJudgments.id, { onDelete: 'cascade' }),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.judgmentId, table.claimId] })],
)

export const stages = sqliteTable(
  'stages',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    focus: text('focus').notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull(),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    adjustmentFeedback: text('adjustment_feedback'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('stages_school_sequence_unique').on(table.schoolId, table.sequence),
    uniqueIndex('stages_one_active_per_school')
      .on(table.schoolId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('stages_one_planned_per_school')
      .on(table.schoolId)
      .where(sql`${table.status} = 'planned'`),
  ],
)

export const stageTargets = sqliteTable(
  'stage_targets',
  {
    id: text('id').primaryKey(),
    stageId: text('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'cascade' }),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    dimensionKey: text('dimension_key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('stage_targets_stage_dimension_unique').on(table.stageId, table.dimensionKey),
    uniqueIndex('stage_targets_stage_sequence_unique').on(table.stageId, table.sequence),
  ],
)

export const stageJudgments = sqliteTable(
  'stage_judgments',
  {
    stageId: text('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'cascade' }),
    judgmentId: text('judgment_id')
      .notNull()
      .references(() => acceptedJudgments.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.stageId, table.judgmentId] }),
    uniqueIndex('stage_judgments_stage_sequence_unique').on(table.stageId, table.sequence),
  ],
)

export const stateSnapshots = sqliteTable(
  'state_snapshots',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    stageId: text('stage_id').references(() => stages.id),
    previousSnapshotId: text('previous_snapshot_id').references(
      (): AnySQLiteColumn => stateSnapshots.id,
    ),
    sequence: integer('sequence').notNull(),
    summary: text('summary').notNull(),
    isBaseline: integer('is_baseline', { mode: 'boolean' }).notNull().default(false),
    confirmedAt: text('confirmed_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('state_snapshots_school_sequence_unique').on(table.schoolId, table.sequence),
    uniqueIndex('state_snapshots_one_baseline_per_school')
      .on(table.schoolId)
      .where(sql`${table.isBaseline} = 1`),
  ],
)

export const dimensionAssessments = sqliteTable(
  'dimension_assessments',
  {
    id: text('id').primaryKey(),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => stateSnapshots.id, { onDelete: 'cascade' }),
    dimensionKey: text('dimension_key').notNull(),
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('dimension_assessments_snapshot_dimension_unique').on(
      table.snapshotId,
      table.dimensionKey,
    ),
  ],
)

export const assessmentJudgments = sqliteTable(
  'assessment_judgments',
  {
    assessmentId: text('assessment_id')
      .notNull()
      .references(() => dimensionAssessments.id, { onDelete: 'cascade' }),
    judgmentId: text('judgment_id')
      .notNull()
      .references(() => acceptedJudgments.id),
  },
  (table) => [primaryKey({ columns: [table.assessmentId, table.judgmentId] })],
)

export const snapshotJudgments = sqliteTable(
  'snapshot_judgments',
  {
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => stateSnapshots.id, { onDelete: 'cascade' }),
    judgmentId: text('judgment_id')
      .notNull()
      .references(() => acceptedJudgments.id),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.judgmentId] })],
)

export type SchoolRow = typeof schools.$inferSelect
export type DiagnosisProposalRow = typeof diagnosisProposals.$inferSelect
export type AcceptedJudgmentRow = typeof acceptedJudgments.$inferSelect
export type StageRow = typeof stages.$inferSelect
export type StageTargetRow = typeof stageTargets.$inferSelect
export type StateSnapshotRow = typeof stateSnapshots.$inferSelect
export type DimensionAssessmentRow = typeof dimensionAssessments.$inferSelect
