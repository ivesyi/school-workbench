import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { countRows, openWorkbenchSqlite } from './support/workbench-db'

const appDirectory = resolve('apps/desktop')

/** Nothing may reach the tables when an assistant does not produce a judgement. */
function expectNothingRecorded(userDataDirectory: string): void {
  const database = openWorkbenchSqlite(userDataDirectory)
  try {
    expect(countRows(database, 'diagnosis_proposals')).toBe(0)
    expect(countRows(database, 'human_reviews')).toBe(0)
    expect(countRows(database, 'accepted_judgments')).toBe(0)
  } finally {
    database.close()
  }
}

test('the assistant is the default, and stays chosen across restarts', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-assistant-e2e-'))

  try {
    const first = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await first.firstWindow()

    await firstWindow.getByRole('link', { name: '设置' }).click()
    await expect(firstWindow.getByRole('radio', { name: /Codex/ })).toBeChecked()
    // Working without an assistant is not a mode the product offers.
    await expect(firstWindow.getByText(/暂不使用/)).toHaveCount(0)
    await first.close()

    const second = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await second.firstWindow()
    await secondWindow.getByRole('link', { name: '设置' }).click()
    await expect(secondWindow.getByRole('radio', { name: /Codex/ })).toBeChecked()
    await second.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('a stored choice that no longer exists still starts the workbench', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-legacy-e2e-'))

  try {
    // Create the database by starting once, then write the retired value.
    const warmup = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    await warmup.firstWindow()
    await warmup.close()

    const database = openWorkbenchSqlite(userDataDirectory)
    try {
      database
        .prepare(
          `INSERT INTO app_preferences (key, value, updated_at)
           VALUES ('default_assistant', 'none', '2026-08-18T00:00:00.000Z')
           ON CONFLICT(key) DO UPDATE SET value = 'none'`,
        )
        .run()
    } finally {
      database.close()
    }

    const app = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const window = await app.firstWindow()
    await window.getByRole('link', { name: '设置' }).click()
    await expect(window.getByRole('radio', { name: /Codex/ })).toBeChecked()
    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('no assistant on this computer means no new analysis, and nothing invented', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-unavailable-e2e-'))

  try {
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        SWB_CODEX_ACP_ENTRY: join(userDataDirectory, 'not-installed.js'),
      },
    })
    const window = await app.firstWindow()

    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()

    await expect(window.getByText('现在还不能开始新的分析')).toBeVisible()
    await expect(window.getByPlaceholder(/例如：今天的中层会议里/)).toBeDisabled()
    await expect(window.getByRole('button', { name: '提交情况' })).toBeDisabled()
    // What already exists is still reachable.
    await window.getByRole('link', { name: '学校状态' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()
    await app.close()

    expectNothingRecorded(userDataDirectory)
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('a failed assistant keeps the sentence and writes nothing down', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-failure-e2e-'))
  // A real, resolvable entry point that is not an agent. The run reaches the
  // handshake and gives up there, which is the shape of every assistant
  // failure the consultant can actually hit.
  const inertRuntime = resolve(userDataDirectory, 'inert-runtime.js')

  try {
    await writeFile(inertRuntime, 'setTimeout(() => process.exit(0), 800)\n', 'utf8')
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        SWB_CODEX_ACP_ENTRY: inertRuntime,
      },
    })
    const window = await app.firstWindow()

    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()
    await expect(window.getByText(/AI 助手会先看一遍/)).toBeVisible()

    const situation = '今天的中层会议里，任务拆解还是主要由校长完成。'
    await window.getByPlaceholder(/例如：今天的中层会议里/).fill(situation)
    await window.getByRole('button', { name: '提交情况' }).click()

    await expect(window.getByText(/AI 助手/).first()).toBeVisible({ timeout: 60_000 })
    // The sentence is still there to try again with, and nothing was made up.
    await expect(window.getByPlaceholder(/例如：今天的中层会议里/)).toHaveValue(situation)
    await expect(window.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(window.getByText('我发现一个新的情况，想让你确认')).toHaveCount(0)
    await expect(window.getByRole('button', { name: '认同', exact: true })).toHaveCount(0)

    // Nothing from inside the machinery reaches the screen.
    const shown = await window.locator('body').innerText()
    for (const leak of [
      'ACP',
      'MCP',
      'stdio',
      'loopback',
      'token',
      'Token',
      'scope',
      'SWB_',
      'node_modules',
      'AGENT_RUN_FAILED',
      'RUNTIME_NOT_FOUND',
      'Session',
      'Skill descriptions',
    ]) {
      expect(shown, leak).not.toContain(leak)
    }

    await app.close()
    expectNothingRecorded(userDataDirectory)
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
