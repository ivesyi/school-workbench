import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

function collectStderr(app: ElectronApplication): () => string {
  let buffer = ''
  const stream = app.process().stderr
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk: string) => {
    buffer += chunk
  })
  return () => buffer
}

async function waitForLine(readBuffer: () => string, line: string): Promise<void> {
  await expect.poll(() => readBuffer().includes(line), { timeout: 15_000 }).toBe(true)
}

test('the loopback read plane starts even when methodology content cannot be loaded', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-read-plane-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        SWB_METHODOLOGY_ROOT: resolve(userDataDirectory, 'missing-methodology'),
      },
    })
    const readStderr = collectStderr(app)
    const window = await app.firstWindow()

    // The agent's only route into workbench domain capability comes up even
    // though the methodology runtime failed: only `standards_get` needs
    // methodology content.
    await waitForLine(readStderr, 'workbench read plane ready')
    expect(readStderr()).toContain('methodology runtime unavailable')
    expect(readStderr()).not.toContain('workbench read plane unavailable')

    // Readiness is all that is reported. The port and the capability tokens
    // never leave the main process.
    expect(readStderr()).not.toMatch(/127\.0\.0\.1:\d+/u)

    // And the product flow is unaffected.
    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('an agent run is refused with a clear reason when no runtime is installed', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-agent-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        // Point the runtime discovery at something that is definitely not there
        // so the run fails at discovery instead of contacting a real Codex.
        SWB_CODEX_ACP_ENTRY: resolve(userDataDirectory, 'no-such-codex-acp.js'),
      },
    })
    const readStderr = collectStderr(app)
    const window = await app.firstWindow()
    await waitForLine(readStderr, 'workbench read plane ready')

    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()

    const outcome = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          workbench: {
            schools: { list(): Promise<Array<{ id: string; name: string }>> }
            agent: {
              run(input: { schoolId: string; message: string }): Promise<{
                runId: string
                status: string
                failureCode: string | null
                failureMessage: string | null
                usedWorkbenchTools: boolean
              }>
            }
          }
        }
      ).workbench
      const schools = await api.schools.list()
      const target = schools.find((item) => item.name === '南山实验学校')
      if (!target) throw new Error('school not found')
      return api.agent.run({ schoolId: target.id, message: '中层还是依赖校长拆解任务。' })
    })

    // A run that cannot reach a runtime is recorded as failed, not silently
    // dropped, and it never claims to have read anything.
    expect(outcome.status).toBe('failed')
    expect(outcome.usedWorkbenchTools).toBe(false)
    expect(outcome.runId.length).toBeGreaterThan(0)

    // The failure must be the one this test set up. The workbench data
    // directory is a temp directory here, which is also where session
    // workspaces are created — a run that never got past that guard would be
    // reported as `SESSION_WORKSPACE_INVALID`, and this assertion is what
    // keeps the runtime discovery path genuinely covered.
    expect(outcome.failureCode).toBe('RUNTIME_NOT_FOUND')
    expect(outcome.failureCode).not.toBe('SESSION_WORKSPACE_INVALID')
    expect(outcome.failureMessage).toContain('SWB_CODEX_ACP_ENTRY')

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('a run reaches the agent runtime even though the workbench data directory is a temp directory', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-agent-ws-e2e-'))
  const appDirectory = resolve('apps/desktop')
  // A real, resolvable entry point that is not an ACP server. Runtime discovery
  // therefore succeeds and the run proceeds past the session workspace guard,
  // which is the part that used to reject every run whose data directory lived
  // under the temp directory.
  const inertRuntime = resolve(userDataDirectory, 'inert-runtime.js')

  try {
    await writeFile(inertRuntime, 'process.exit(0)\n', 'utf8')
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        SWB_CODEX_ACP_ENTRY: inertRuntime,
      },
    })
    const readStderr = collectStderr(app)
    const window = await app.firstWindow()
    await waitForLine(readStderr, 'workbench read plane ready')

    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()

    const outcome = await window.evaluate(async () => {
      const api = (
        window as unknown as {
          workbench: {
            schools: { list(): Promise<Array<{ id: string; name: string }>> }
            agent: {
              run(input: { schoolId: string; message: string }): Promise<{
                status: string
                failureCode: string | null
                usedWorkbenchTools: boolean
              }>
            }
          }
        }
      ).workbench
      const schools = await api.schools.list()
      const target = schools.find((item) => item.name === '南山实验学校')
      if (!target) throw new Error('school not found')
      return api.agent.run({ schoolId: target.id, message: '中层还是依赖校长拆解任务。' })
    })

    // `AGENT_RUN_FAILED` is the ACP handshake giving up, which is the last
    // thing that can go wrong here. Reaching it means the session workspace was
    // created and accepted, and that the workbench MCP contract test ran
    // against the live loopback and passed. The run still fails, because the
    // spawned process is not an agent — but for that reason, not this one.
    expect(outcome.failureCode).toBe('AGENT_RUN_FAILED')
    expect(outcome.status).toBe('failed')
    expect(outcome.usedWorkbenchTools).toBe(false)

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
