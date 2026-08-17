import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteAgentRuntimeRepository } from './sqlite-agent-runtime-repository'

const migrationsFolder = resolve('packages/db/drizzle')

function agentRuntimeMigrationSql(): string {
  const file = readdirSync(migrationsFolder).find((name) => /^0008_.*\.sql$/u.test(name))
  if (!file) throw new Error('0008 agent runtime migration was not generated')
  return readFileSync(resolve(migrationsFolder, file), 'utf8')
}

function seedSchool(database: WorkbenchDatabase, id = 'school-1'): string {
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(id, '南山实验学校', '2026-08-17T00:00:00.000Z')
  return id
}

describe('agent runtime schema migration', () => {
  it('adds the three agent runtime tables on a fresh migrated database', () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const tables = database.client
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('runtime_profiles', 'agent_sessions', 'agent_runs')
            ORDER BY name`,
        )
        .all() as Array<{ name: string }>
      expect(tables.map((item) => item.name)).toEqual([
        'agent_runs',
        'agent_sessions',
        'runtime_profiles',
      ])
      expect(database.client.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('only adds tables and never seeds data', () => {
    // A migration that inserts rows would smuggle product content into schema
    // history, where it cannot be reviewed or corrected.
    const sql = agentRuntimeMigrationSql()
    expect(sql).not.toMatch(/\bINSERT\b/iu)
    expect(sql).not.toMatch(/\bDROP\b/iu)
    // `ON UPDATE no action` is part of a foreign key clause, so only a
    // statement-leading UPDATE counts as a data rewrite.
    for (const statement of sql.split('--> statement-breakpoint')) {
      expect(statement.trim()).not.toMatch(/^UPDATE\b/iu)
      expect(statement.trim()).not.toMatch(/^ALTER\b/iu)
    }
  })

  it('keeps the existing dangling agent_run_id columns untouched', () => {
    // `evidence.agent_run_id` and `observation_facts.agent_run_id` finally have
    // a table to point at, but this migration deliberately does not rebuild
    // either table to add a foreign key. SQLite cannot add one in place, and a
    // table rebuild would put existing consultant data at risk for a nullable
    // provenance pointer.
    const sql = agentRuntimeMigrationSql()
    expect(sql).not.toMatch(/evidence/iu)
    expect(sql).not.toMatch(/observation_facts/iu)

    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const evidenceColumns = database.client.pragma('table_info(evidence)') as Array<{
        name: string
        notnull: number
      }>
      expect(evidenceColumns.some((column) => column.name === 'agent_run_id')).toBe(true)
      expect(
        database.client.prepare("SELECT sql FROM sqlite_master WHERE name = 'evidence'").get(),
      ).toEqual({ sql: expect.not.stringContaining('agent_runs') })
    } finally {
      database.close()
    }
  })

  it('refuses any agent run status outside the frozen six', () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const schoolId = seedSchool(database)
      const insert = database.client.prepare(
        `INSERT INTO agent_runs (id, session_id, school_id, status, created_at, updated_at, started_at, ended_at)
         VALUES (?, NULL, ?, ?, '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z', NULL, NULL)`,
      )

      for (const status of [
        'queued',
        'running',
        'needs_input',
        'completed',
        'failed',
        'cancelled',
      ]) {
        expect(() => insert.run(`run-${status}`, schoolId, status)).not.toThrow()
      }

      // SPEC 39: the reason a run waits must never become a seventh state.
      for (const status of ['awaiting_feishu', 'needs_consultant_input', 'paused', '']) {
        expect(() => insert.run(`run-bad-${status}`, schoolId, status)).toThrowError(
          /CHECK constraint failed/u,
        )
      }
    } finally {
      database.close()
    }
  })

  it('refuses a runtime compatibility value outside the frozen three', () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const schoolId = seedSchool(database)
      database.client
        .prepare(
          `INSERT INTO runtime_profiles (id, key, display_name, transport, created_at, updated_at)
           VALUES ('rp-1', 'codex', 'Codex', 'acp', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z')`,
        )
        .run()

      const insert = database.client.prepare(
        `INSERT INTO agent_sessions (
           id, school_id, runtime_profile_id, acp_session_id, cwd, compatibility,
           protocol_version, agent_name, agent_version, created_at, closed_at
         ) VALUES (?, ?, 'rp-1', NULL, '/tmp/x', ?, 1, NULL, NULL, '2026-08-17T00:00:00.000Z', NULL)`,
      )
      for (const compatibility of ['verified', 'compatible', 'unsupported']) {
        expect(() => insert.run(`s-${compatibility}`, schoolId, compatibility)).not.toThrow()
      }
      expect(() => insert.run('s-bad', schoolId, 'partially')).toThrowError(
        /CHECK constraint failed/u,
      )
    } finally {
      database.close()
    }
  })

  it('refuses a runtime profile that is not driven over ACP', () => {
    // SPEC 0 / SPEC 3: agents are only ever driven over ACP.
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      expect(() =>
        database.client
          .prepare(
            `INSERT INTO runtime_profiles (id, key, display_name, transport, created_at, updated_at)
             VALUES ('rp-x', 'sdk', 'Direct SDK', 'sdk', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z')`,
          )
          .run(),
      ).toThrowError(/CHECK constraint failed/u)
    } finally {
      database.close()
    }
  })
})

describe('agent runtime repository', () => {
  it('records a run before a session exists and links them afterwards', async () => {
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const schoolId = seedSchool(database)
      const repository = new SqliteAgentRuntimeRepository(database)

      const profileId = await repository.ensureRuntimeProfile({
        key: 'codex',
        displayName: 'Codex',
      })
      expect(await repository.ensureRuntimeProfile({ key: 'codex', displayName: 'Codex' })).toBe(
        profileId,
      )
      expect(await repository.listRuntimeProfiles()).toHaveLength(1)

      const run = await repository.createRun({ schoolId })
      expect(run.status).toBe('queued')
      expect((await repository.getRun(run.id))?.sessionId).toBeNull()

      await repository.setRunStatus(run.id, 'running')
      await repository.setRunStatus(run.id, 'needs_input')
      await repository.setRunStatus(run.id, 'running')
      await repository.setRunStatus(run.id, 'completed')

      const sessionId = await repository.recordSession({
        schoolId,
        runtimeProfileId: profileId,
        acpSessionId: 'acp-session-1',
        cwd: '/tmp/agent-run',
        compatibility: 'verified',
        protocolVersion: 1,
        agentName: 'codex-acp',
        agentVersion: '1.4.0',
        closedAt: '2026-08-17T00:01:00.000Z',
      })
      await repository.attachRunToSession(run.id, sessionId)

      const stored = await repository.getRun(run.id)
      expect(stored?.status).toBe('completed')
      expect(stored?.sessionId).toBe(sessionId)
      expect(stored?.startedAt).not.toBeNull()
      expect(stored?.endedAt).not.toBeNull()
      expect((await repository.getSession(sessionId))?.compatibility).toBe('verified')
    } finally {
      database.close()
    }
  })

  it('stores no explanation of why a run is waiting', async () => {
    // SPEC 39 keeps the reason out of the database entirely.
    const database = openWorkbenchDatabase(':memory:', migrationsFolder)
    try {
      const columns = (
        database.client.pragma('table_info(agent_runs)') as Array<{ name: string }>
      ).map((column) => column.name)
      expect(columns).toEqual([
        'id',
        'session_id',
        'school_id',
        'status',
        'created_at',
        'updated_at',
        'started_at',
        'ended_at',
        // Added by the write-plane migration. A count of refused candidates,
        // never a reason (SPEC 39).
        'self_correction_rounds',
      ])
      expect(columns).not.toContain('reason')
      expect(columns).not.toContain('detail')
    } finally {
      database.close()
    }
  })
})
