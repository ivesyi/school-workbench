import { workbenchMcpServerName } from './mcp-descriptor'

export type PermissionOptionLike = Readonly<{
  optionId: string
  kind: string
}>

export type PermissionDecision =
  | Readonly<{ outcome: 'selected'; optionId: string; reason: 'workbench_read_tool' }>
  | Readonly<{ outcome: 'selected'; optionId: string; reason: 'rejected_by_policy' }>
  | Readonly<{ outcome: 'cancelled'; reason: 'no_usable_option' }>

/**
 * Recognises a tool call that belongs to the workbench MCP server.
 *
 * Agents namespace MCP tools by server. codex-acp reports them as
 * `mcp.<server>.<tool>` in the tool call title and uses `mcp__<server>__<tool>`
 * for startup diagnostics, so both forms are accepted. Matching is anchored on
 * the server name, never on a bare tool name, so an unrelated server cannot
 * borrow the allowance by naming a tool `state_current`.
 */
export function isWorkbenchToolCall(title: string | null | undefined): boolean {
  if (!title) return false
  return (
    title.startsWith(`mcp.${workbenchMcpServerName}.`) ||
    title.startsWith(`mcp__${workbenchMcpServerName}__`)
  )
}

function findKind(
  options: readonly PermissionOptionLike[],
  kinds: readonly string[],
): string | null {
  for (const kind of kinds) {
    const match = options.find((option) => option.kind === kind)
    if (match) return match.optionId
  }
  return null
}

/**
 * Permission policy for the read slice.
 *
 * There is no consultant-facing permission surface yet (PRD 16 puts agent
 * progress and approvals in a later slice), so the host cannot ask a human.
 * The safe default therefore is:
 *
 *   - allow, once, a call into the workbench MCP server — those tools are
 *     read-only by construction, already bound to a scoped capability token,
 *     and SPEC 25 keeps the write tools off the surface entirely;
 *   - reject anything else, once, so nothing is granted for future turns;
 *   - cancel when the agent offered no option this policy can take.
 *
 * `allow_always` / `reject_always` are never selected: a standing grant would
 * outlive the run that justified it.
 */
export function decidePermission(
  input: Readonly<{ toolCallTitle?: string | null; options: readonly PermissionOptionLike[] }>,
): PermissionDecision {
  if (isWorkbenchToolCall(input.toolCallTitle)) {
    const allowOnce = findKind(input.options, ['allow_once'])
    if (allowOnce) {
      return Object.freeze({
        outcome: 'selected',
        optionId: allowOnce,
        reason: 'workbench_read_tool',
      })
    }
  }

  const rejectOnce = findKind(input.options, ['reject_once'])
  if (rejectOnce) {
    return Object.freeze({
      outcome: 'selected',
      optionId: rejectOnce,
      reason: 'rejected_by_policy',
    })
  }

  return Object.freeze({ outcome: 'cancelled', reason: 'no_usable_option' })
}
