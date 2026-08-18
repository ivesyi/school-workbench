import type { AgentRunOutcome } from '../agent-host'
import { workbenchToolName } from '../permission-policy'
import type { HarnessRunResult } from './contracts'

/**
 * The existing ACP path, seen through the Harness seam.
 *
 * This is a pure projection and nothing else. `AgentHost` is untouched, its
 * behaviour is unchanged, and every field below is read off the outcome it
 * already produced — so the Codex path cannot regress by this existing, while
 * the seam stops being a claim about the future and becomes something the
 * product actually routes through today.
 *
 * It also settles the question the seam was designed against: does an interface
 * shaped around an in-process harness still fit a subprocess-and-protocol one?
 * The three places the shapes differ are all places where the ACP path has
 * *more* to say, and each has somewhere to say it:
 *
 *  - a negotiated protocol version, an agent name and version → the session
 *    identity, whose fields are nullable precisely for the harness that has
 *    none;
 *  - `session/update` kinds this build did not recognise → the generic
 *    `unrecognisedRuntimeSignals`;
 *  - tool call *titles*, which are namespaced by MCP server → reduced to the
 *    bare workbench tool names every harness reports, using the same parser the
 *    progress line already uses.
 *
 * What does not survive the projection is `mcpStartupReportedFailure`, and it
 * should not: it is a claim one specific ACP bridge makes about one specific
 * subprocess. The Agent Host already acts on it and folds the outcome into
 * `failure`, so nothing above this line loses a decision — only a detail that
 * would be meaningless to any other harness.
 */
export function harnessResultFromAcpOutcome(outcome: AgentRunOutcome): HarnessRunResult {
  const workbenchToolCalls = outcome.toolCallTitles.flatMap((title) => {
    const tool = workbenchToolName(title)
    return tool ? [tool] : []
  })

  return Object.freeze({
    status: outcome.status,
    statusHistory: outcome.statusHistory,
    text: outcome.text,
    workbenchToolCalls: Object.freeze(workbenchToolCalls),
    usedWorkbenchTools: outcome.usedWorkbenchTools,
    unrecognisedRuntimeSignals: outcome.unrecognisedUpdateTags,
    session: Object.freeze({
      externalSessionId: outcome.acpSessionId,
      cwd: outcome.workspaceCwd,
      compatibility: outcome.compatibility.compatibility,
      protocolVersion: outcome.compatibility.protocolVersion,
      agentName: outcome.compatibility.agentName,
      agentVersion: outcome.compatibility.agentVersion,
    }),
    failure: outcome.failure,
  })
}
