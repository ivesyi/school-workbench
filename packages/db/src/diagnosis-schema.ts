import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { methodologyCriteria } from './methodology-schema'
import { diagnosisProposals, stageTargets } from './schema'

export const diagnosisCriteria = sqliteTable(
  'diagnosis_criteria',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => diagnosisProposals.id, { onDelete: 'cascade' }),
    criterionId: text('criterion_id')
      .notNull()
      .references(() => methodologyCriteria.id),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.criterionId] })],
)

export const diagnosisStageTargets = sqliteTable(
  'diagnosis_stage_targets',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => diagnosisProposals.id, { onDelete: 'cascade' }),
    stageTargetId: text('stage_target_id')
      .notNull()
      .references(() => stageTargets.id),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.stageTargetId] })],
)
