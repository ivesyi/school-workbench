import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * A consultant sign-off is an immutable record of one review act. It is bound to
 * the exact pack key, version and canonical content hash that was reviewed, so a
 * later content change cannot silently inherit an earlier approval.
 */
export const methodologyPackSignOffs = sqliteTable(
  'methodology_pack_sign_offs',
  {
    id: text('id').primaryKey(),
    packKey: text('pack_key').notNull(),
    packVersion: text('pack_version').notNull(),
    contentHash: text('content_hash').notNull(),
    decision: text('decision').notNull(),
    note: text('note'),
    signedAt: text('signed_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('methodology_pack_sign_offs_pack_idx').on(
      table.packKey,
      table.packVersion,
      table.signedAt,
    ),
    index('methodology_pack_sign_offs_content_idx').on(
      table.packKey,
      table.packVersion,
      table.contentHash,
    ),
  ],
)

export const methodologyPackCriterionVerdicts = sqliteTable(
  'methodology_pack_criterion_verdicts',
  {
    id: text('id').primaryKey(),
    signOffId: text('sign_off_id')
      .notNull()
      .references(() => methodologyPackSignOffs.id, { onDelete: 'cascade' }),
    criterionStableKey: text('criterion_stable_key').notNull(),
    verdict: text('verdict').notNull(),
    note: text('note'),
    sequence: integer('sequence').notNull(),
  },
  (table) => [
    uniqueIndex('methodology_pack_criterion_verdicts_criterion_unique').on(
      table.signOffId,
      table.criterionStableKey,
    ),
    uniqueIndex('methodology_pack_criterion_verdicts_sequence_unique').on(
      table.signOffId,
      table.sequence,
    ),
  ],
)

export type MethodologyPackSignOffRow = typeof methodologyPackSignOffs.$inferSelect
export type MethodologyPackCriterionVerdictRow =
  typeof methodologyPackCriterionVerdicts.$inferSelect
