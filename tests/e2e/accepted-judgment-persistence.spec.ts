import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('an accepted judgment remains after the desktop app restarts', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-judgment-e2e-'))
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

    const situation = '今天的中层会议里，任务拆解还是主要由校长完成。'
    await firstWindow.getByPlaceholder(/例如：今天的中层会议里/).fill(situation)
    await firstWindow.getByRole('button', { name: '提交情况' }).click()
    await expect(firstWindow.getByText('我发现一个新的情况，想让你确认')).toBeVisible()
    await firstWindow.getByRole('button', { name: '认同' }).click()
    await expect(firstWindow.getByText('已经记录这条判断。')).toBeVisible()
    await expect(firstWindow.getByText(situation)).toBeVisible()
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(secondWindow.getByText(situation)).toBeVisible()
    await expect(secondWindow.getByText('已由你确认')).toBeVisible()
    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
