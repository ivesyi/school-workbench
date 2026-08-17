import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The workbench's first place to keep a consultant's choice.
 *
 * A key/value row rather than a column per preference: PRD 44/46 expect the
 * settings page to grow, and a column per setting would mean a schema change
 * every time. The keys themselves are not open — `preferenceKeys` in
 * `@school-workbench/shared` freezes them, so adding one is still a deliberate
 * edit rather than something any caller can invent at runtime.
 *
 * Deliberately *not* `runtime_profiles`: that table records which runtimes the
 * workbench knows how to drive, which is discovered rather than chosen. Putting
 * a person's preference there would make every future runtime row carry it.
 */
export const appPreferences = sqliteTable('app_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export type AppPreferenceRow = typeof appPreferences.$inferSelect
