import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'

function diagnosisMigrationPath(): string {
  const file = readdirSync(resolve('packages/db/drizzle')).find((name) =>
    /^0006_.*\.sql$/.test(name),
  )
  if (!file) throw new Error('0006 grounded diagnosis migration was not generated')
  return resolve('packages/db/drizzle', file)
}

function runMigration(client: Database.Database, path: string): void {
  const sql = readFileSync(path, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) client.exec(statement)
  }
}

describe('validated diagnosis persistence migration', () => {
  it('is present with canonical FK relations on a fresh database', () => {
    const database = openWorkbenchDatabase(':memory:', resolve('packages/db/drizzle'))
    try {
      const tables = database.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('diagnosis_criteria', 'diagnosis_stage_targets') ORDER BY name",
        )
        .all() as Array<{ name: string }>
      expect(tables.map((item) => item.name)).toEqual([
        'diagnosis_criteria',
        'diagnosis_stage_targets',
      ])

      const criterionFks = database.client.pragma('foreign_key_list(diagnosis_criteria)') as Array<{
        table: string
        from: string
        to: string
      }>
      expect(criterionFks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'diagnosis_proposals',
            from: 'proposal_id',
            to: 'id',
          }),
          expect.objectContaining({
            table: 'methodology_criteria',
            from: 'criterion_id',
            to: 'id',
          }),
        ]),
      )

      const targetFks = database.client.pragma(
        'foreign_key_list(diagnosis_stage_targets)',
      ) as Array<{
        table: string
        from: string
        to: string
      }>
      expect(targetFks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'diagnosis_proposals',
            from: 'proposal_id',
            to: 'id',
          }),
          expect.objectContaining({
            table: 'stage_targets',
            from: 'stage_target_id',
            to: 'id',
          }),
        ]),
      )
      expect(database.client.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('applies forward over the previous schema without modifying existing rows', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    try {
      client.exec(`
        CREATE TABLE diagnosis_proposals (
          id text PRIMARY KEY NOT NULL,
          title text NOT NULL
        );
        CREATE TABLE methodology_criteria (
          id text PRIMARY KEY NOT NULL,
          stable_key text NOT NULL
        );
        CREATE TABLE stage_targets (
          id text PRIMARY KEY NOT NULL,
          title text NOT NULL
        );
        INSERT INTO diagnosis_proposals VALUES ('proposal-1', 'existing proposal');
        INSERT INTO methodology_criteria VALUES ('criterion-1', 'SBD.C4.SYSTEM_ALIGNMENT');
        INSERT INTO stage_targets VALUES ('target-1', 'existing target');
      `)

      runMigration(client, diagnosisMigrationPath())

      expect(
        client.prepare('SELECT title FROM diagnosis_proposals WHERE id = ?').get('proposal-1'),
      ).toEqual({
        title: 'existing proposal',
      })
      expect(
        client
          .prepare('SELECT stable_key AS stableKey FROM methodology_criteria WHERE id = ?')
          .get('criterion-1'),
      ).toEqual({ stableKey: 'SBD.C4.SYSTEM_ALIGNMENT' })
      expect(
        client.prepare('SELECT title FROM stage_targets WHERE id = ?').get('target-1'),
      ).toEqual({
        title: 'existing target',
      })

      client
        .prepare('INSERT INTO diagnosis_criteria (proposal_id, criterion_id) VALUES (?, ?)')
        .run('proposal-1', 'criterion-1')
      client
        .prepare('INSERT INTO diagnosis_stage_targets (proposal_id, stage_target_id) VALUES (?, ?)')
        .run('proposal-1', 'target-1')
      expect(client.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.close()
    }
  })
})
