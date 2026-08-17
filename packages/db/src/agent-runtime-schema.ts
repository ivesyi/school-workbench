import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schools } from './schema'

/**
 * Agent Runtime tables (`docs/data/DATABASE_SCHEMA.md` §11).
 *
 * The schema document freezes only `agent_runs.status`; the column lists below
 * are the minimum this slice actually reads and writes, deliberately kept
 * narrow so that nothing speculative is persisted.
 *
 * Notably absent, on purpose:
 *   - no reason/detail column on `agent_runs`. SPEC 39 keeps the reason a run
 *     is waiting out of the database entirely; it belongs to the Experience
 *     Layer as transient state. A free-text column here would quietly become a
 *     third copy of that state.
 *   - no cached prompt, transcript or model output. SPEC 24.1 keeps hidden
 *     model reasoning out of the workbench.
 */

/**
 * A runtime the workbench knows how to drive over ACP (SPEC 8: Codex,
 * DeepSeek Harness). Identity only — capability is re-derived per connection.
 */
export const runtimeProfiles = sqliteTable(
  'runtime_profiles',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    /** Frozen at `acp` by SPEC 0 / SPEC 3: agents are only ever driven over ACP. */
    transport: text('transport').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('runtime_profiles_key_unique').on(table.key),
    check('runtime_profiles_transport_acp', sql`${table.transport} = 'acp'`),
  ],
)

/**
 * One negotiated ACP session.
 *
 * SPEC 62 judges compatibility from `ACP initialize + required capability +
 * contract test`, all of which are properties of a specific negotiation — so
 * the verdict is stored on the session that produced it, never on the profile,
 * and never derived from a version string.
 */
export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    runtimeProfileId: text('runtime_profile_id')
      .notNull()
      .references(() => runtimeProfiles.id),
    /** Session id returned by the agent. Null when `session/new` never succeeded. */
    acpSessionId: text('acp_session_id'),
    /** The one-shot working directory handed to the agent for this session. */
    cwd: text('cwd').notNull(),
    compatibility: text('compatibility').notNull(),
    protocolVersion: integer('protocol_version'),
    agentName: text('agent_name'),
    agentVersion: text('agent_version'),
    createdAt: text('created_at').notNull(),
    closedAt: text('closed_at'),
  },
  (table) => [
    check(
      'agent_sessions_compatibility_frozen',
      sql`${table.compatibility} IN ('verified', 'compatible', 'unsupported')`,
    ),
  ],
)

/**
 * One Agent Run.
 *
 * SPEC 61 freezes the six states and SPEC 39 forbids adding a seventh, so the
 * set is enforced in SQL rather than only in TypeScript. `needs_input` covers
 * every wait — Feishu authorization, the agent asking the consultant for more
 * information, any other future human action — and the concrete reason never
 * enters this table.
 */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    /**
     * Null until an ACP session was actually negotiated. A run that failed at
     * runtime discovery or during `initialize` never has one, and inventing a
     * placeholder session would misreport what happened.
     */
    sessionId: text('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    /**
     * How many times the assessment protocol refused a candidate in this run
     * before it either succeeded or gave up (decision L5). A count, not a
     * reason: why a candidate was refused stays in the structured errors the
     * Agent already received.
     */
    selfCorrectionRounds: integer('self_correction_rounds').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
  },
  (table) => [
    check(
      'agent_runs_status_frozen',
      sql`${table.status} IN ('queued', 'running', 'needs_input', 'completed', 'failed', 'cancelled')`,
    ),
  ],
)

export type RuntimeProfileRow = typeof runtimeProfiles.$inferSelect
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type AgentRunRow = typeof agentRuns.$inferSelect
