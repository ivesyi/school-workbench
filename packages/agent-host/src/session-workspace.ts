import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AgentHostError } from './contracts'

export type SessionWorkspace = Readonly<{
  /** Absolute path handed to ACP `session/new` as `cwd`. */
  cwd: string
  dispose(): Promise<void>
}>

export type SessionWorkspaceInput = Readonly<{
  /** Directory the throwaway workspace is created under. Defaults to the OS temp dir. */
  root?: string
  /**
   * Directories the workspace must not live in or contain. The workbench user
   * data directory belongs here: it holds the SQLite database, and a session
   * cwd is a directory the agent is explicitly allowed to work in.
   */
  forbiddenRoots: readonly string[]
}>

function contains(parent: string, child: string): boolean {
  const relation = relative(parent, child)
  if (relation === '') return true
  if (relation === '..' || relation.startsWith(`..${sep}`)) return false
  return !isAbsolute(relation)
}

function overlapRejected(): never {
  throw new AgentHostError(
    'SESSION_WORKSPACE_INVALID',
    'An agent session workspace may not overlap the workbench data directory',
  )
}

/**
 * The invariant that actually matters: the directory handed to the agent must
 * neither live inside nor contain a protected directory.
 *
 * Exported so both directions stay directly testable. A workspace is always
 * created by `mkdtemp`, so the "workspace contains the data directory" half
 * cannot be produced by calling `createSessionWorkspace`, but it is still the
 * half that would matter most if it ever happened.
 */
export function workspaceOverlaps(cwd: string, forbiddenRoots: readonly string[]): boolean {
  const workspace = resolve(cwd)
  return forbiddenRoots.some((raw) => {
    if (!raw) return false
    const forbidden = resolve(raw)
    return contains(forbidden, workspace) || contains(workspace, forbidden)
  })
}

function assertWorkspaceIsolated(cwd: string, forbiddenRoots: readonly string[]): void {
  if (workspaceOverlaps(cwd, forbiddenRoots)) overlapRejected()
}

/**
 * Pre-check on the directory workspaces are created *under*.
 *
 * Only one direction is a defect here: a root that already sits inside a
 * protected directory can never produce an acceptable workspace, so it is worth
 * rejecting before creating anything.
 *
 * The other direction must NOT be rejected. A root routinely contains protected
 * directories without any workspace ever overlapping them — the OS temp
 * directory contains the workbench data directory in every end-to-end run, and
 * a sibling workspace created under it overlaps nothing. Rejecting that made
 * every agent run unreachable whenever the data directory happened to live
 * under the temp directory.
 */
function assertRootUsable(root: string, forbiddenRoots: readonly string[]): void {
  for (const raw of forbiddenRoots) {
    if (!raw) continue
    if (contains(resolve(raw), root)) overlapRejected()
  }
}

/**
 * Creates the one-shot working directory for a single Agent Run.
 *
 * Every run gets a fresh empty directory that is deleted when the run ends, and
 * it can never be the workbench user data directory — that is where the SQLite
 * database lives, and SPEC 0 keeps formal state under the workbench's control
 * rather than inside the agent's workspace.
 */
export async function createSessionWorkspace(
  input: SessionWorkspaceInput,
): Promise<SessionWorkspace> {
  const root = resolve(input.root ?? tmpdir())
  assertRootUsable(root, input.forbiddenRoots)

  const cwd = await mkdtemp(join(root, 'school-workbench-agent-run-'))
  try {
    assertWorkspaceIsolated(cwd, input.forbiddenRoots)
  } catch (error) {
    await rm(cwd, { recursive: true, force: true })
    throw error
  }

  let disposed = false
  return Object.freeze({
    cwd,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await rm(cwd, { recursive: true, force: true })
    },
  })
}
