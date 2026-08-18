/**
 * Tolerant reader for ACP `session/update` notifications.
 *
 * SPEC 64 requires Codex to be able to ship on its own cadence. codex-acp emits
 * a large and growing set of update kinds (shell command, file change, MCP tool
 * call, terminal output, reasoning, plan, web search, image generation, token
 * usage, review, subagent, ...). If the workbench treated an unrecognised kind
 * as an error, every codex-acp release would be able to break the workbench.
 *
 * Therefore every function in this module is total: it never throws, and any
 * shape it does not recognise is reported as `unrecognised` and ignored by the
 * caller. This is fail-open by construction, not by a try/catch that happens to
 * be in the right place.
 */

export type WorkbenchToolCallObservation = Readonly<{
  toolCallId: string | null
  title: string | null
  status: string | null
  /**
   * codex-acp reports an MCP server that failed or was cancelled during startup
   * as a synthetic `tool_call` with id `mcp_startup.<urlencoded server name>`
   * and status `failed`. That is the one protocol-visible signal a client gets
   * about MCP wiring, so it is surfaced instead of being swallowed.
   */
  mcpStartupServerName: string | null
  /**
   * Raw text content of the synthetic startup report. codex-acp writes the real
   * reason here — "failed to start: ..." versus "startup was cancelled." — which
   * is what separates a genuine wiring failure from a server the runtime chose
   * to cancel.
   */
  contentText: string
}>

export type ObservedSessionUpdate =
  | Readonly<{ kind: 'agent_message'; text: string }>
  | Readonly<{ kind: 'agent_thought' }>
  | Readonly<{ kind: 'user_message' }>
  | Readonly<{ kind: 'tool_call'; toolCall: WorkbenchToolCallObservation }>
  | Readonly<{ kind: 'tool_call_update'; toolCall: WorkbenchToolCallObservation }>
  | Readonly<{ kind: 'ignored'; tag: string }>
  | Readonly<{ kind: 'unrecognised'; tag: string | null }>

const MCP_STARTUP_TOOL_CALL_PREFIX = 'mcp_startup.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Pulls `{ sessionId, update }` out of a raw notification payload without
 * validating either side. Returns `null` when the payload is not shaped like a
 * session notification at all.
 */
export function readSessionNotification(
  raw: unknown,
): Readonly<{ sessionId: string | null; update: unknown }> | null {
  if (!isRecord(raw)) return null
  if (!('update' in raw)) return null
  return Object.freeze({ sessionId: readString(raw['sessionId']), update: raw['update'] })
}

function readTextContent(update: Record<string, unknown>): string {
  const content = update['content']
  if (!isRecord(content)) return ''
  if (content['type'] !== 'text') return ''
  return readString(content['text']) ?? ''
}

function readMcpStartupServerName(toolCallId: string | null): string | null {
  if (!toolCallId || !toolCallId.startsWith(MCP_STARTUP_TOOL_CALL_PREFIX)) return null
  const encoded = toolCallId.slice(MCP_STARTUP_TOOL_CALL_PREFIX.length)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function readToolCall(update: Record<string, unknown>): WorkbenchToolCallObservation {
  const toolCallId = readString(update['toolCallId'])
  let contentText = ''
  const content = update['content']
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) continue
      const nested = item['content']
      if (!isRecord(nested) || nested['type'] !== 'text') continue
      const text = readString(nested['text'])
      if (text) contentText = text
    }
  }
  return Object.freeze({
    toolCallId,
    title: readString(update['title']),
    status: readString(update['status']),
    mcpStartupServerName: readMcpStartupServerName(toolCallId),
    contentText,
  })
}

/**
 * Update kinds that are understood well enough to be deliberately skipped.
 * Keeping them separate from `unrecognised` means a diagnostic can distinguish
 * "a kind we chose not to act on" from "a kind this build has never seen".
 */
const knownIgnoredTags = new Set([
  'plan',
  'plan_update',
  'plan_removed',
  'available_commands_update',
  'current_mode_update',
  'config_option_update',
  'session_info_update',
  'usage_update',
])

export function classifySessionUpdate(rawUpdate: unknown): ObservedSessionUpdate {
  if (!isRecord(rawUpdate)) return Object.freeze({ kind: 'unrecognised', tag: null })
  const tag = readString(rawUpdate['sessionUpdate'])
  if (!tag) return Object.freeze({ kind: 'unrecognised', tag: null })

  switch (tag) {
    case 'agent_message_chunk':
      return Object.freeze({ kind: 'agent_message', text: readTextContent(rawUpdate) })
    case 'agent_thought_chunk':
      return Object.freeze({ kind: 'agent_thought' })
    case 'user_message_chunk':
      return Object.freeze({ kind: 'user_message' })
    case 'tool_call':
      return Object.freeze({ kind: 'tool_call', toolCall: readToolCall(rawUpdate) })
    case 'tool_call_update':
      return Object.freeze({ kind: 'tool_call_update', toolCall: readToolCall(rawUpdate) })
    default:
      return knownIgnoredTags.has(tag)
        ? Object.freeze({ kind: 'ignored', tag })
        : Object.freeze({ kind: 'unrecognised', tag })
  }
}

/**
 * Accumulates everything the host needs from one prompt turn. All inputs are
 * raw and untrusted; nothing here can throw.
 */
export type McpStartupReport = Readonly<{
  serverName: string
  /** The runtime's own wording, kept verbatim. Never shown to a consultant. */
  text: string
}>

export class SessionUpdateObserver {
  #text = ''
  readonly #unrecognisedTags: string[] = []
  readonly #failedMcpStartups: string[] = []
  readonly #mcpStartupReports: McpStartupReport[] = []
  readonly #toolCallTitles: string[] = []

  observe(rawUpdate: unknown): ObservedSessionUpdate {
    const observed = classifySessionUpdate(rawUpdate)
    switch (observed.kind) {
      case 'agent_message':
        this.#text += observed.text
        break
      case 'tool_call':
      case 'tool_call_update': {
        const { toolCall } = observed
        if (toolCall.mcpStartupServerName) {
          // codex-acp synthesises this "tool call" to report MCP startup; the
          // agent never made it. Counting it as a tool call would make a
          // *startup failure* look like proof that the server was used.
          if (
            toolCall.status === 'failed' &&
            !this.#failedMcpStartups.includes(toolCall.mcpStartupServerName)
          ) {
            this.#failedMcpStartups.push(toolCall.mcpStartupServerName)
          }
          // The report's own wording is kept as well, because "failed to
          // start" and "startup was cancelled" arrive with the same status and
          // are different problems. A later report replaces an earlier one for
          // the same server: codex-acp sends `tool_call` and then
          // `tool_call_update`, and the last word is the one that stands.
          if (toolCall.status === 'failed') {
            const at = this.#mcpStartupReports.findIndex(
              (report) => report.serverName === toolCall.mcpStartupServerName,
            )
            // An update carrying no text must not erase the reason an earlier
            // one gave.
            const previous = at >= 0 ? this.#mcpStartupReports[at] : undefined
            const report = Object.freeze({
              serverName: toolCall.mcpStartupServerName,
              text: toolCall.contentText || previous?.text || '',
            })
            if (at >= 0) this.#mcpStartupReports[at] = report
            else this.#mcpStartupReports.push(report)
          }
          break
        }
        if (toolCall.title) this.#toolCallTitles.push(toolCall.title)
        break
      }
      case 'unrecognised':
        if (observed.tag && !this.#unrecognisedTags.includes(observed.tag)) {
          this.#unrecognisedTags.push(observed.tag)
        }
        break
      default:
        break
    }
    return observed
  }

  get text(): string {
    return this.#text
  }

  /** Update kinds this build did not understand. Ignored, but reportable. */
  get unrecognisedTags(): readonly string[] {
    return Object.freeze([...this.#unrecognisedTags])
  }

  /** MCP servers codex-acp told us failed or cancelled startup. */
  get failedMcpStartups(): readonly string[] {
    return Object.freeze([...this.#failedMcpStartups])
  }

  /**
   * The same reports with the runtime's own wording attached, so a caller can
   * tell "failed to start" from "startup was cancelled". `failedMcpStartups`
   * deliberately stays a bare list: the Agent Host treats both the same way and
   * must keep doing so.
   */
  get mcpStartupReports(): readonly McpStartupReport[] {
    return Object.freeze([...this.#mcpStartupReports])
  }

  get toolCallTitles(): readonly string[] {
    return Object.freeze([...this.#toolCallTitles])
  }
}
