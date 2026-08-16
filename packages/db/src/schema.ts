import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const schools = sqliteTable('schools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
})

export const evidence = sqliteTable('evidence', {
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
})

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

export type SchoolRow = typeof schools.$inferSelect
export type DiagnosisProposalRow = typeof diagnosisProposals.$inferSelect
export type AcceptedJudgmentRow = typeof acceptedJudgments.$inferSelect
