import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const appDirectory = resolve('apps/desktop')

test('the consultant chooses an assistant once and the workbench remembers', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-assistant-e2e-'))

  try {
    const first = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await first.firstWindow()

    // Nothing is switched on until someone says so, so a fresh workbench never
    // waits or spends on the first sentence.
    await firstWindow.getByRole('link', { name: '设置' }).click()
    await expect(firstWindow.getByText('目前没有使用 AI 助手')).toBeVisible()
    await expect(firstWindow.getByRole('radio', { name: /Codex/ })).not.toBeChecked()

    await firstWindow.getByRole('radio', { name: /Codex/ }).click()
    await expect(firstWindow.getByRole('radio', { name: /Codex/ })).toBeChecked()
    await expect(firstWindow.getByText('目前没有使用 AI 助手')).toHaveCount(0)
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

test('a sentence is never lost when the assistant cannot finish', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-fallback-e2e-'))
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

    await window.getByRole('link', { name: '设置' }).click()
    await window.getByRole('radio', { name: /Codex/ }).click()
    await expect(window.getByRole('radio', { name: /Codex/ })).toBeChecked()

    await window.getByRole('link', { name: '学校', exact: true }).click()
    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()
    await expect(window.getByText(/AI 助手会先看一遍/)).toBeVisible()

    const situation = '今天的中层会议里，任务拆解还是主要由校长完成。'
    await window.getByPlaceholder(/例如：今天的中层会议里/).fill(situation)
    await window.getByRole('button', { name: '提交情况' }).click()

    // The assistant is told about in plain words, and the sentence still turns
    // into something the consultant can confirm.
    await expect(window.getByText(/AI 助手这次没能完成/)).toBeVisible({ timeout: 60_000 })
    await expect(window.getByText('我发现一个新的情况，想让你确认')).toBeVisible()
    await expect(window.getByRole('button', { name: '认同', exact: true })).toBeVisible()

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

    await window.getByRole('button', { name: '认同', exact: true }).click()
    await expect(window.getByText('已经记录这条判断。')).toBeVisible()

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
