import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionWorkspace, workspaceOverlaps } from './session-workspace'

const created: string[] = []

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'agent-host-workspace-'))
  created.push(directory)
  return directory
}

afterEach(() => {
  while (created.length > 0) {
    const directory = created.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('agent session workspace', () => {
  it('gives each run its own empty directory and removes it afterwards', async () => {
    const root = scratchRoot()
    const userData = scratchRoot()

    const first = await createSessionWorkspace({ root, forbiddenRoots: [userData] })
    const second = await createSessionWorkspace({ root, forbiddenRoots: [userData] })

    expect(first.cwd).not.toBe(second.cwd)
    expect(readdirSync(first.cwd)).toEqual([])
    expect(existsSync(first.cwd)).toBe(true)

    await first.dispose()
    await first.dispose()
    expect(existsSync(first.cwd)).toBe(false)
    expect(existsSync(second.cwd)).toBe(true)

    await second.dispose()
  })

  it('refuses to place a workspace inside the workbench data directory', async () => {
    // That directory holds the SQLite database. A session cwd is a place the
    // agent is allowed to work in, so the two must never overlap.
    const userData = scratchRoot()
    await expect(
      createSessionWorkspace({ root: userData, forbiddenRoots: [userData] }),
    ).rejects.toThrowError(/may not overlap/u)

    await expect(
      createSessionWorkspace({
        root: join(userData, 'nested'),
        forbiddenRoots: [userData],
      }),
    ).rejects.toThrowError(/may not overlap/u)
  })

  it('rejects overlap in both directions and allows siblings', () => {
    // Both halves of the invariant, checked directly. `createSessionWorkspace`
    // can only ever produce the first half because it uses `mkdtemp`.
    const userData = '/data/school-workbench'

    expect(workspaceOverlaps('/data/school-workbench/run-1', [userData])).toBe(true)
    expect(workspaceOverlaps(userData, [userData])).toBe(true)
    expect(workspaceOverlaps('/data', [userData])).toBe(true)
    expect(workspaceOverlaps('/', [userData])).toBe(true)

    expect(workspaceOverlaps('/tmp/run-1', [userData])).toBe(false)
    expect(workspaceOverlaps('/data/school-workbench-other/run-1', [userData])).toBe(false)
    expect(workspaceOverlaps('/data/run-1', [userData])).toBe(false)
    expect(workspaceOverlaps('/tmp/run-1', [])).toBe(false)
    expect(workspaceOverlaps('/tmp/run-1', [''])).toBe(false)
  })

  it('works when the workbench data directory lives under the workspace root', async () => {
    // This is the shape every end-to-end run has: `SWB_E2E_USER_DATA_DIR` is a
    // `mkdtemp` directory under the OS temp directory, which is also the
    // default workspace root. A root that merely contains the data directory
    // must not block agent runs — only an actually overlapping workspace does.
    const root = scratchRoot()
    const userData = join(root, 'user-data')
    mkdirSync(userData, { recursive: true })

    const workspace = await createSessionWorkspace({ root, forbiddenRoots: [userData] })
    try {
      expect(existsSync(workspace.cwd)).toBe(true)
      expect(workspace.cwd.startsWith(root)).toBe(true)
      expect(relative(userData, workspace.cwd).startsWith('..')).toBe(true)
      expect(relative(workspace.cwd, userData).startsWith('..')).toBe(true)
    } finally {
      await workspace.dispose()
    }
  })

  it('works with the real default root even when the data directory is a temp directory', async () => {
    // The exact production-shaped call the end-to-end suite makes: no explicit
    // root, so `os.tmpdir()` is used, while the data directory is a temp
    // directory too.
    const userData = scratchRoot()
    const workspace = await createSessionWorkspace({ forbiddenRoots: [userData] })
    try {
      expect(existsSync(workspace.cwd)).toBe(true)
      expect(relative(userData, workspace.cwd).startsWith('..')).toBe(true)
    } finally {
      await workspace.dispose()
    }
  })
})
