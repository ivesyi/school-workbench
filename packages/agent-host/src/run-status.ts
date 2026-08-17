import { agentRunStatuses, AgentHostError, type AgentRunStatus } from './contracts'

/**
 * SPEC 61 Agent Run lifecycle.
 *
 * The six states are frozen. `needs_input` is re-enterable in both directions
 * because a run can pause for a human action, resume, and pause again without
 * the database learning anything about *why* it paused (SPEC 39).
 */
const allowedTransitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> =
  Object.freeze({
    queued: Object.freeze(['running', 'cancelled', 'failed'] as const),
    running: Object.freeze(['needs_input', 'completed', 'failed', 'cancelled'] as const),
    needs_input: Object.freeze(['running', 'completed', 'failed', 'cancelled'] as const),
    completed: Object.freeze([] as const),
    failed: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
  })

export const terminalAgentRunStatuses = Object.freeze([
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly AgentRunStatus[])

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && (agentRunStatuses as readonly string[]).includes(value)
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return (terminalAgentRunStatuses as readonly AgentRunStatus[]).includes(status)
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return allowedTransitions[from].includes(to)
}

export function assertTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransition(from, to)) {
    throw new AgentHostError(
      'RUN_TRANSITION_INVALID',
      `Agent run cannot move from ${from} to ${to}`,
    )
  }
}

/**
 * In-memory Agent Run state machine.
 *
 * The host owns the transitions; persistence is a separate concern so that the
 * lifecycle can be unit tested without SQLite and so that Agent Host stays free
 * of school domain logic (SPEC 7).
 */
export class AgentRunLifecycle {
  #status: AgentRunStatus = 'queued'
  readonly #history: AgentRunStatus[] = ['queued']

  constructor(private readonly onChange?: (status: AgentRunStatus) => void) {}

  get status(): AgentRunStatus {
    return this.#status
  }

  get history(): readonly AgentRunStatus[] {
    return Object.freeze([...this.#history])
  }

  get isTerminal(): boolean {
    return isTerminalAgentRunStatus(this.#status)
  }

  transition(to: AgentRunStatus): AgentRunStatus {
    assertTransition(this.#status, to)
    this.#status = to
    this.#history.push(to)
    this.onChange?.(to)
    return to
  }

  /**
   * Moves to a terminal state without throwing when the run is already
   * finished. Teardown paths use this so a late failure cannot mask an earlier
   * recorded outcome.
   */
  settle(to: 'completed' | 'failed' | 'cancelled'): AgentRunStatus {
    if (this.isTerminal) return this.#status
    return this.transition(to)
  }
}
