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

describe('0003 stage schema reconciliation', () => {
  it('migrates an already-applied 0002 stage with canonical keys and FK judgment relations', () => {
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
          status text NOT NULL,
          source_judgment_ids_json text NOT NULL,
          adjustment_feedback text,
          created_at text NOT NULL,
          activated_at text,
          FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE cascade
        );
        CREATE TABLE stage_targets (
          id text PRIMARY KEY NOT NULL,
          stage_id text NOT NULL,
          school_id text NOT NULL,
          dimension_key text NOT NULL,
          text text NOT NULL,
          status text NOT NULL,
          created_at text NOT NULL,
          confirmed_at text,
          FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE cascade,
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
          '学生学习变化已出现。',
          '{"kind":"school"}',
          '2026-08-17T00:10:00.000Z',
        )
      client
        .prepare('INSERT INTO stages VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
        .run(
          'stage-1',
          'school-1',
          '验证学生学习变化',
          '阶段摘要',
          '阶段重点',
          'active',
          '["judgment-1"]',
          '2026-08-17T00:20:00.000Z',
          '2026-08-17T01:00:00.000Z',
        )

      const oldDimensions = [
        ['leadership', '领导目标'],
        ['critical_tasks', '关键任务目标'],
        ['structure_systems', '机制目标'],
        ['culture', '文化目标'],
        ['capacity', '能力目标'],
      ]
      oldDimensions.forEach(([dimension, text], index) => {
        client
          .prepare('INSERT INTO stage_targets VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            `target-${index + 1}`,
            'stage-1',
            'school-1',
            dimension,
            text,
            'confirmed',
            '2026-08-17T00:20:00.000Z',
            '2026-08-17T01:00:00.000Z',
          )
      })

      runMigration(client, resolve('packages/db/drizzle/0003_stage_schema_reconciliation.sql'))

      const stage = client
        .prepare('SELECT sequence, status, starts_at, ends_at, updated_at FROM stages WHERE id = ?')
        .get('stage-1') as Record<string, unknown>
      expect(stage).toEqual({
        sequence: 1,
        status: 'active',
        starts_at: '2026-08-17T01:00:00.000Z',
        ends_at: null,
        updated_at: '2026-08-17T01:00:00.000Z',
      })

      const targets = client
        .prepare(
          'SELECT dimension_key, title, description, sequence FROM stage_targets ORDER BY sequence',
        )
        .all() as Array<Record<string, unknown>>
      expect(targets.map((row) => row.dimension_key)).toEqual([
        'leadership',
        'key_tasks',
        'structure',
        'culture',
        'capability',
      ])
      expect(targets[1]).toMatchObject({
        title: '关键任务',
        description: '关键任务目标',
        sequence: 2,
      })

      expect(
        client.prepare('SELECT stage_id, judgment_id, sequence FROM stage_judgments').get(),
      ).toEqual({ stage_id: 'stage-1', judgment_id: 'judgment-1', sequence: 1 })
      expect(client.pragma('foreign_key_check')).toEqual([])

      const stageColumns = client.pragma('table_info(stages)') as Array<{ name: string }>
      expect(stageColumns.some((column) => column.name === 'source_judgment_ids_json')).toBe(false)
    } finally {
      client.close()
    }
  })
})
