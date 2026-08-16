import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const schools = sqliteTable('schools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currentStageId: text('current_stage_id'),
  baselineSnapshotId: text('baseline_snapshot_id'),
  currentSnapshotId: text('current_snapshot_id'),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
})

export type SchoolRow = typeof schools.$inferSelect
