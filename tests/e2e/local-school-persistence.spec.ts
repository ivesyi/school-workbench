import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('a created school remains after the desktop app restarts', async () => {
  const testInfo = test.info()
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const firstApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await firstApp.firstWindow()

    await firstWindow.getByRole('button', { name: '新建学校' }).click()
    await firstWindow.getByLabel('学校名称').fill('南山实验学校')
    await firstWindow.getByRole('button', { name: '创建' }).click()
    await expect(firstWindow.getByRole('heading', { name: '南山实验学校' })).toBeVisible()
    await firstWindow.screenshot({ path: testInfo.outputPath('school-workspace.png') })
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await expect(secondWindow.getByText('南山实验学校')).toBeVisible()
    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
