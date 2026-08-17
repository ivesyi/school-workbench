import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'

function signOffMigrationPath(): string {
  const file = readdirSync(resolve('packages/db/drizzle')).find((name) =>
    /^0007_.*\.sql$/.test(name),
  )
  if (!file) throw new Error('0007 methodology sign-off migration was not generated')
  return resolve('packages/db/drizzle', file)
}

function runMigration(client: Database.Database, path: string): void {
  const sql = readFileSync(path, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) client.exec(statement)
  }
}

describe('methodology pack sign-off schema migration', () => {
  it('is present on a fresh migrated database', () => {
    const database = openWorkbenchDatabase(':memory:', resolve('packages/db/drizzle'))
    try {
      const tables = database.client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('methodology_pack_sign_offs', 'methodology_pack_criterion_verdicts') ORDER BY name",
        )
        .all() as Array<{ name: string }>
      expect(tables.map((item) => item.name)).toEqual([
        'methodology_pack_criterion_verdicts',
        'methodology_pack_sign_offs',
      ])
      expect(database.client.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('applies forward over an existing database without rewriting earlier methodology rows', () => {
    const client = new Database(':memory:')
    client.pragma('foreign_keys = ON')
    try {
      client.exec(`
        CREATE TABLE methodology_packs (
          id text PRIMARY KEY NOT NULL,
          key text NOT NULL,
          version text NOT NULL,
          title text NOT NULL,
          source_type text NOT NULL,
          source_ref text NOT NULL,
          source_fingerprint text NOT NULL,
          content_hash text NOT NULL,
          status text NOT NULL,
          created_at text NOT NULL
        );
        INSERT INTO methodology_packs VALUES (
          'schooling-by-design-v1', 'schooling-by-design', '1',
          'Schooling by Design Methodology Pack v1', 'book',
          'references/books/schooling-by-design-2007.pdf', '${'b'.repeat(64)}',
          '${'c'.repeat(64)}', 'review', '2026-08-17T00:00:00.000Z'
        );
      `)

      runMigration(client, signOffMigrationPath())

      expect(
        client
          .prepare('SELECT status, content_hash FROM methodology_packs WHERE id = ?')
          .get('schooling-by-design-v1'),
      ).toEqual({ status: 'review', content_hash: 'c'.repeat(64) })
      const signOffColumns = client.pragma('table_info(methodology_pack_sign_offs)') as Array<{
        name: string
      }>
      expect(signOffColumns.map((column) => column.name)).toEqual([
        'id',
        'pack_key',
        'pack_version',
        'content_hash',
        'decision',
        'note',
        'signed_at',
        'created_at',
      ])
      expect(client.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.close()
    }
  })
})
