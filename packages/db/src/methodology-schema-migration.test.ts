import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'

function methodologyMigrationPath(): string {
  const file = readdirSync(resolve('packages/db/drizzle')).find((name) => /^0005_.*\.sql$/.test(name))
  if (!file) throw new Error('0005 methodology migration was not generated')
  return resolve('packages/db/drizzle', file)
}

function runMigration(client: Database.Database, path: string): void {
  const sql = readFileSync(path, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) client.exec(statement)
  }
}

describe('methodology registry schema migration', () => {
  it('is present on a fresh migrated database', () => {
    const database = openWorkbenchDatabase(':memory:', resolve('packages/db/drizzle'))
    try {
      const tables = database.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('methodology_packs', 'methodology_criteria', 'behavior_anchors') ORDER BY name",
        )
        .all() as Array<{ name: string }>
      expect(tables.map((item) => item.name)).toEqual([
        'behavior_anchors',
        'methodology_criteria',
        'methodology_packs',
      ])
      expect(database.client.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('applies forward over an existing database without changing prior rows', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    try {
      client.exec(`
        CREATE TABLE schools (
          id text PRIMARY KEY NOT NULL,
          name text NOT NULL,
          created_at text NOT NULL,
          archived_at text
        );
        INSERT INTO schools VALUES ('school-1', '南山实验学校', '2026-08-17T00:00:00.000Z', NULL);
      `)

      runMigration(client, methodologyMigrationPath())

      expect(client.prepare('SELECT name FROM schools WHERE id = ?').get('school-1')).toEqual({
        name: '南山实验学校',
      })
      const packColumns = client.pragma('table_info(methodology_packs)') as Array<{ name: string }>
      expect(packColumns.map((column) => column.name)).toEqual([
        'id',
        'key',
        'version',
        'title',
        'source_type',
        'source_ref',
        'source_fingerprint',
        'content_hash',
        'status',
        'created_at',
      ])
      expect(client.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.close()
    }
  })
})
