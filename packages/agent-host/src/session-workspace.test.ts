import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionWorkspace } from './session-workspace'

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

  it('refuses a workspace root that would contain the data directory', async () => {
    const root = scratchRoot()
    await expect(
      createSessionWorkspace({ root, forbiddenRoots: [resolve(root, 'inner')] }),
    ).rejects.toThrowError(/may not overlap/u)
  })
})
