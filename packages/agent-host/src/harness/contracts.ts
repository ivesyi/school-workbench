import type { AgentRunStatus, RuntimeCompatibility, WorkbenchToolName } from '../contracts'

/**
 * The Harness boundary.
 *
 * A *harness* is whatever actually drives a model through one Agent Run. Today
 * there are two shapes of it and they are not alike:
 *
 *  - **A host-layer harness.** Codex is a command-line tool the consultant
 *    installed, which the workbench talks to over ACP. Three moving parts —
 *    the CLI, the ACP bridge, the model backend — none of which this repository
 *    controls or can pin. When Codex 0.147.0 started sending a tool shape its
 *    own model backend rejected, the workbench found out by having a run fail
 *    (ledger §14).
 *  - **A controlled harness.** A library pinned to an exact version in this
 *    repository's lockfile, running inside the workbench process. It changes
 *    when somebody here edits the pin, and never on its own.
 *
 * This interface is the seam that lets both be an assistant without the
 * workbench above it knowing which kind it got. What crosses it is deliberately
 * small: a task, an already-issued capability grant, and progress. Everything
 * that differs — ACP sessions, subprocesses, Cordis contexts, provider SDKs —
 * stays on the driver's side of it.
 *
 * Two rules hold for every implementation:
 *
 *  - **The capability grant is the only route to workbench data.** A driver is
 *    handed a loopback endpoint and a scoped token and nothing else. It has no
 *    repository, no database handle and no school id of its own, so the
 *    governance in `packages/workbench-read-plane` cannot be gone around by
 *    adding a driver.
 *  - **Drivers are peers.** Nothing here ranks them, falls back between them,
 *    or retries one after another fails. Which assistant runs is the
 *    consultant's standing choice (PRD 15); a failure is reported, not routed
 *    around.
 */

/**
 * Internal ids of the harnesses this workbench can drive.
 *
 * These are the values `assistantChoiceSchema` in `@school-workbench/shared`
 * stores as a preference, restated here because `packages/agent-host` sits
 * below the shared contracts and must not import them (SPEC 7). A test in the
 * desktop app — which depends on both — holds the two lists to each other.
 *
 * `builtin` is deliberately not named after the library behind it. Which
 * library that is, is an implementation detail this seam exists to hide, and
 * the consultant-facing label never mentions one either.
 */
export const harnessKeys = ['codex', 'builtin'] as const

export type HarnessKey = (typeof harnessKeys)[number]

/**
 * A capability grant, already issued by the composition root.
 *
 * A driver receives this and never mints one: issuing is a decision about which
 * school and which run, which is school domain logic and does not belong below
 * this line (SPEC 7).
 */
export type HarnessCapabilityGrant = Readonly<{
  /** Scoped loopback endpoint, e.g. `http://127.0.0.1:1234/internal/v1`. */
  endpoint: string
  token: string
  schoolId: string
  agentRunId: string
}>

export type HarnessTask = Readonly<{
  grant: HarnessCapabilityGrant
  /** What the consultant actually said. Injected after the SPEC 26 bootstrap. */
  consultantMessage: string
  signal?: AbortSignal
}>

export type HarnessRunFailure = Readonly<{ code: string; message: string }>

/**
 * What the workbench records about the run in `agent_sessions`.
 *
 * Every field is nullable because the shapes genuinely differ: an in-process
 * harness has no negotiated protocol version and no throwaway working
 * directory, and inventing values for those would put a fiction in the
 * database. A driver reports null rather than a plausible number.
 */
export type HarnessSessionIdentity = Readonly<{
  /** The runtime's own session id, when it has one. */
  externalSessionId: string | null
  /** Working directory handed to the runtime, when it needed one. */
  cwd: string | null
  compatibility: RuntimeCompatibility
  protocolVersion: number | null
  agentName: string | null
  agentVersion: string | null
}>

export type HarnessRunResult = Readonly<{
  status: AgentRunStatus
  statusHistory: readonly AgentRunStatus[]
  /**
   * Free prose the assistant produced. The product drops it (PRD 16): what
   * survives a run is what passed the strict assessment contract. It is
   * reported so a maintainer and a connection check can see whether the model
   * answered at all.
   */
  text: string
  /** Bare workbench tool names the assistant actually called, in call order. */
  workbenchToolCalls: readonly string[]
  usedWorkbenchTools: boolean
  /**
   * Things the runtime reported that this build did not understand. Ignored,
   * never fatal — a newer runtime must not be able to break the workbench by
   * saying something new — but reported so it is visible.
   *
   * Always empty for a controlled harness: there is no protocol between the
   * workbench and a library it calls directly, so there is nothing to fail to
   * recognise.
   */
  unrecognisedRuntimeSignals: readonly string[]
  session: HarnessSessionIdentity
  failure: HarnessRunFailure | null
}>

/**
 * Everything a driver reports while it works.
 *
 * `onWorkbenchToolCall` is the only honest source for the consultant-facing
 * progress line: it follows what the assistant actually did rather than a
 * timer, and it carries only tools the workbench itself serves, so nothing a
 * runtime does on its own can be narrated to a consultant.
 */
export type HarnessObservers = Readonly<{
  onStatus?: (status: AgentRunStatus) => void
  /** For whoever maintains the workbench. Never shown to a consultant. */
  onDiagnostic?: (message: string) => void
  onWorkbenchToolCall?: (tool: WorkbenchToolName) => void
}>

export interface HarnessDriver {
  readonly key: HarnessKey
  run(task: HarnessTask, observers?: HarnessObservers): Promise<HarnessRunResult>
}
