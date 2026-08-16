import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const schools = sqliteTable('schools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
})

export type SchoolRow = typeof schools.$inferSelect
