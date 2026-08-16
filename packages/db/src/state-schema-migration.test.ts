import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function runMigration(client: Database.Database, path: string): void {
  const sql = readFileSync(path, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) client.exec(statement)
  }
}

describe('0004 baseline state schema', () => {
  it('applies forward over the existing stage schema without changing prior rows', () => {
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
        CREATE TABLE accepted_judgments (
          id text PRIMARY KEY NOT NULL,
          school_id text NOT NULL,
          review_id text NOT NULL,
          statement text NOT NULL,
          scope_json text NOT NULL,
          valid_from text,
          valid_to text,
          created_at text NOT NULL
        );
        CREATE TABLE stages (
          id text PRIMARY KEY NOT NULL,
          school_id text NOT NULL,
          title text NOT NULL,
          summary text NOT NULL,
          focus text NOT NULL,
          sequence integer NOT NULL,
          status text NOT NULL,
          starts_at text,
          ends_at text,
          adjustment_feedback text,
          created_at text NOT NULL,
          updated_at text NOT NULL,
          FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE cascade
        );
      `)
      client
        .prepare('INSERT INTO schools VALUES (?, ?, ?, NULL)')
        .run('school-1', '南山实验学校', '2026-08-17T00:00:00.000Z')
      client
        .prepare('INSERT INTO accepted_judgments VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
        .run(
          'judgment-1',
          'school-1',
          'review-1',
          '中层仍然依赖校长完成关键任务拆解。',
          '{"kind":"school"}',
          '2026-08-17T00:10:00.000Z',
        )
      client
        .prepare('INSERT INTO stages VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)')
        .run(
          'stage-1',
          'school-1',
          '建立共同推动改进的组织基础',
          '阶段摘要',
          '阶段重点',
          1,
          'active',
          '2026-08-17T01:00:00.000Z',
          '2026-08-17T00:20:00.000Z',
          '2026-08-17T01:00:00.000Z',
        )

      runMigration(client, resolve('packages/db/drizzle/0004_wise_tony_stark.sql'))

      expect(client.prepare('SELECT id, status FROM stages WHERE id = ?').get('stage-1')).toEqual({
        id: 'stage-1',
        status: 'active',
      })
      expect(
        client.prepare('SELECT id FROM accepted_judgments WHERE id = ?').get('judgment-1'),
      ).toEqual({
        id: 'judgment-1',
      })

      const tables = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('state_snapshots', 'dimension_assessments', 'assessment_judgments', 'snapshot_judgments') ORDER BY name",
        )
        .all() as Array<{ name: string }>
      expect(tables.map((item) => item.name)).toEqual([
        'assessment_judgments',
        'dimension_assessments',
        'snapshot_judgments',
        'state_snapshots',
      ])

      const snapshotColumns = client.pragma('table_info(state_snapshots)') as Array<{
        name: string
      }>
      expect(snapshotColumns.map((column) => column.name)).toEqual([
        'id',
        'school_id',
        'stage_id',
        'previous_snapshot_id',
        'sequence',
        'summary',
        'is_baseline',
        'confirmed_at',
        'created_at',
      ])
      expect(client.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.close()
    }
  })
})
