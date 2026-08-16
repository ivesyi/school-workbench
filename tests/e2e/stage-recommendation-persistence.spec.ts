import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('a confirmed stage and its targets remain after the desktop app restarts', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-stage-e2e-'))
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

    await firstWindow
      .getByPlaceholder(/例如：今天的中层会议里/)
      .fill('今天的中层会议里，任务拆解还是主要由校长完成。')
    await firstWindow.getByRole('button', { name: '提交情况' }).click()
    await firstWindow.getByRole('button', { name: '认同', exact: true }).click()

    await expect(firstWindow.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
    await expect(firstWindow.getByText('这样理解基本对吗？')).toBeVisible()
    await firstWindow.getByRole('button', { name: '基本对' }).click()
    await expect(firstWindow.getByText('当前阶段')).toBeVisible()
    await expect(firstWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(secondWindow.getByText('当前阶段')).toBeVisible()
    await expect(secondWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await secondWindow.getByText('这个阶段重点看什么').click()
    await expect(
      secondWindow.getByText('校长从直接代办转向明确方向、授权和复盘，中层承担真实责任。'),
    ).toBeVisible()
    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
