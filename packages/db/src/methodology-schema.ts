import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

export const methodologyPacks = sqliteTable(
  'methodology_packs',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('methodology_packs_key_version_unique').on(table.key, table.version)],
)

export const methodologyCriteria = sqliteTable(
  'methodology_criteria',
  {
    id: text('id').primaryKey(),
    packId: text('pack_id')
      .notNull()
      .references(() => methodologyPacks.id, { onDelete: 'cascade' }),
    stableKey: text('stable_key').notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => methodologyCriteria.id),
    constructKey: text('construct_key').notNull(),
    dimensionKey: text('dimension_key'),
    practiceType: text('practice_type'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    evidenceGuidanceJson: text('evidence_guidance_json').notNull(),
    counterIndicatorsJson: text('counter_indicators_json').notNull(),
    guardrailsJson: text('guardrails_json').notNull(),
    sourceLocatorJson: text('source_locator_json').notNull(),
    sequence: integer('sequence').notNull(),
  },
  (table) => [
    uniqueIndex('methodology_criteria_pack_stable_unique').on(table.packId, table.stableKey),
    uniqueIndex('methodology_criteria_pack_sequence_unique').on(table.packId, table.sequence),
  ],
)

export const behaviorAnchors = sqliteTable(
  'behavior_anchors',
  {
    id: text('id').primaryKey(),
    criterionId: text('criterion_id')
      .notNull()
      .references(() => methodologyCriteria.id, { onDelete: 'cascade' }),
    levelKey: text('level_key').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull(),
    sourceLocatorJson: text('source_locator_json').notNull(),
    sequence: integer('sequence').notNull(),
  },
  (table) => [
    uniqueIndex('behavior_anchors_criterion_level_unique').on(table.criterionId, table.levelKey),
    uniqueIndex('behavior_anchors_criterion_sequence_unique').on(table.criterionId, table.sequence),
  ],
)

export type MethodologyPackRow = typeof methodologyPacks.$inferSelect
export type MethodologyCriterionRow = typeof methodologyCriteria.$inferSelect
export type BehaviorAnchorRow = typeof behaviorAnchors.$inferSelect
