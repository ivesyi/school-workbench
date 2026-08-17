import { randomUUID } from 'node:crypto'
import type { WorkbenchDatabase } from './database'
import type { AgentRunRow, AgentSessionRow, RuntimeProfileRow } from './agent-runtime-schema'

export type AgentRunStatusValue =
  'queued' | 'running' | 'needs_input' | 'completed' | 'failed' | 'cancelled'

export type RuntimeCompatibilityValue = 'verified' | 'compatible' | 'unsupported'

export type RecordAgentSessionInput = Readonly<{
  schoolId: string
  runtimeProfileId: string
  acpSessionId: string | null
  cwd: string
  compatibility: RuntimeCompatibilityValue
  protocolVersion: number | null
  agentName: string | null
  agentVersion: string | null
  closedAt: string | null
}>

/**
 * Persistence for the Agent Runtime tables.
 *
 * Deliberately narrow: it records identity, the negotiated session and the
 * frozen run status, and nothing about *why* a run is waiting (SPEC 39) or what
 * the model produced (SPEC 24.1).
 */
export class SqliteAgentRuntimeRepository {
  constructor(
    private readonly database: WorkbenchDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => randomUUID(),
  ) {}

  /** Upserts the runtime identity row and returns its id. */
  async ensureRuntimeProfile(
    input: Readonly<{ key: string; displayName: string }>,
  ): Promise<string> {
    const existing = this.database.client
      .prepare('SELECT id FROM runtime_profiles WHERE key = ?')
      .get(input.key) as { id: string } | undefined
    const timestamp = this.now()
    if (existing) {
      this.database.client
        .prepare('UPDATE runtime_profiles SET display_name = ?, updated_at = ? WHERE id = ?')
        .run(input.displayName, timestamp, existing.id)
      return existing.id
    }

    const id = this.newId()
    this.database.client
      .prepare(
        `INSERT INTO runtime_profiles (id, key, display_name, transport, created_at, updated_at)
         VALUES (?, ?, ?, 'acp', ?, ?)`,
      )
      .run(id, input.key, input.displayName, timestamp, timestamp)
    return id
  }

  async createRun(
    input: Readonly<{ schoolId: string; runId?: string }>,
  ): Promise<Readonly<{ id: string; status: AgentRunStatusValue }>> {
    const id = input.runId ?? this.newId()
    const timestamp = this.now()
    this.database.client
      .prepare(
        `INSERT INTO agent_runs (id, session_id, school_id, status, created_at, updated_at, started_at, ended_at)
         VALUES (?, NULL, ?, 'queued', ?, ?, NULL, NULL)`,
      )
      .run(id, input.schoolId, timestamp, timestamp)
    return Object.freeze({ id, status: 'queued' as AgentRunStatusValue })
  }

  async setRunStatus(runId: string, status: AgentRunStatusValue): Promise<void> {
    const timestamp = this.now()
    const startedAt = status === 'running' ? timestamp : null
    const endedAt =
      status === 'completed' || status === 'failed' || status === 'cancelled' ? timestamp : null
    this.database.client
      .prepare(
        `UPDATE agent_runs
            SET status = ?,
                updated_at = ?,
                started_at = COALESCE(started_at, ?),
                ended_at = COALESCE(?, ended_at)
          WHERE id = ?`,
      )
      .run(status, timestamp, startedAt, endedAt, runId)
  }

  async recordSession(input: RecordAgentSessionInput): Promise<string> {
    const id = this.newId()
    this.database.client
      .prepare(
        `INSERT INTO agent_sessions (
           id, school_id, runtime_profile_id, acp_session_id, cwd, compatibility,
           protocol_version, agent_name, agent_version, created_at, closed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.schoolId,
        input.runtimeProfileId,
        input.acpSessionId,
        input.cwd,
        input.compatibility,
        input.protocolVersion,
        input.agentName,
        input.agentVersion,
        this.now(),
        input.closedAt,
      )
    return id
  }

  async attachRunToSession(runId: string, sessionId: string): Promise<void> {
    this.database.client
      .prepare('UPDATE agent_runs SET session_id = ?, updated_at = ? WHERE id = ?')
      .run(sessionId, this.now(), runId)
  }

  async getRun(runId: string): Promise<AgentRunRow | null> {
    const row = this.database.client.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as
      Record<string, unknown> | undefined
    return row ? (toAgentRunRow(row) as AgentRunRow) : null
  }

  async getSession(sessionId: string): Promise<AgentSessionRow | null> {
    const row = this.database.client
      .prepare('SELECT * FROM agent_sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined
    return row ? (toAgentSessionRow(row) as AgentSessionRow) : null
  }

  async listRuntimeProfiles(): Promise<readonly RuntimeProfileRow[]> {
    const rows = this.database.client
      .prepare('SELECT * FROM runtime_profiles ORDER BY key')
      .all() as Array<Record<string, unknown>>
    return Object.freeze(rows.map((row) => toRuntimeProfileRow(row) as RuntimeProfileRow))
  }
}

function toRuntimeProfileRow(row: Record<string, unknown>): unknown {
  return {
    id: row['id'],
    key: row['key'],
    displayName: row['display_name'],
    transport: row['transport'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  }
}

function toAgentSessionRow(row: Record<string, unknown>): unknown {
  return {
    id: row['id'],
    schoolId: row['school_id'],
    runtimeProfileId: row['runtime_profile_id'],
    acpSessionId: row['acp_session_id'],
    cwd: row['cwd'],
    compatibility: row['compatibility'],
    protocolVersion: row['protocol_version'],
    agentName: row['agent_name'],
    agentVersion: row['agent_version'],
    createdAt: row['created_at'],
    closedAt: row['closed_at'],
  }
}

function toAgentRunRow(row: Record<string, unknown>): unknown {
  return {
    id: row['id'],
    sessionId: row['session_id'],
    schoolId: row['school_id'],
    status: row['status'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
    startedAt: row['started_at'],
    endedAt: row['ended_at'],
  }
}
