import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
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
  return !relation.startsWith(`..${sep}`) && relation !== '..' && !relation.startsWith('..')
}

function assertIsolated(cwd: string, forbiddenRoots: readonly string[]): void {
  for (const raw of forbiddenRoots) {
    if (!raw) continue
    const forbidden = resolve(raw)
    if (contains(forbidden, cwd) || contains(cwd, forbidden)) {
      throw new AgentHostError(
        'SESSION_WORKSPACE_INVALID',
        'An agent session workspace may not overlap the workbench data directory',
      )
    }
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
  assertIsolated(root, input.forbiddenRoots)

  const cwd = await mkdtemp(join(root, 'school-workbench-agent-run-'))
  try {
    assertIsolated(cwd, input.forbiddenRoots)
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
