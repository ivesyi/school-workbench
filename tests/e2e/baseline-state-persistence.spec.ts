import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

async function createSchool(window: Page, schoolName: string): Promise<void> {
  await window.getByRole('button', { name: '新建学校' }).click()
  await window.getByLabel('学校名称').fill(schoolName)
  await window.getByRole('button', { name: '创建' }).click()
}

async function acceptSituation(window: Page, text: string): Promise<void> {
  await window.getByPlaceholder(/例如：今天的中层会议里/).fill(text)
  await window.getByRole('button', { name: '提交情况' }).click()
  await window.getByRole('button', { name: '认同', exact: true }).click()
  await expect(window.getByText('已经记录这条判断。')).toBeVisible()
}

test('baseline school state is confirmed once and survives restart with five assessments', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-state-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const firstApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await firstApp.firstWindow()

    await createSchool(firstWindow, '南山实验学校')
    await acceptSituation(firstWindow, '中层仍然依赖校长完成关键任务拆解。')
    await expect(firstWindow.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
    await acceptSituation(firstWindow, '教师已经开始稳定教研复盘，能够根据课堂情况调整。')

    await firstWindow.getByRole('button', { name: '基本对' }).click()
    await expect(firstWindow.getByText('当前阶段')).toBeVisible()

    await firstWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(firstWindow.getByText('现在的状态', { exact: true })).toBeVisible()
    for (const label of ['领导力', '关键任务', '结构与机制', '文化', '能力']) {
      await expect(firstWindow.getByRole('heading', { name: label, exact: true })).toBeVisible()
    }
    await expect(firstWindow.getByText('起点状态', { exact: true })).toHaveCount(0)

    await firstWindow.getByRole('button', { name: '我想调整' }).click()
    await firstWindow.getByLabel('哪里需要调整？').fill('领导力这部分先别判断，还需要更多观察')
    await firstWindow.getByRole('button', { name: '重新整理当前状态' }).click()

    const leadership = firstWindow.locator('article').filter({ hasText: '领导力' })
    await expect(leadership.getByText('还需要更多观察', { exact: true })).toBeVisible()
    await expect(firstWindow.getByText('已经记录这所学校当前的起点状态。')).toHaveCount(0)

    await firstWindow.getByRole('button', { name: '确认现在的状态' }).click()
    await expect(firstWindow.getByText('已经记录这所学校当前的起点状态。')).toBeVisible()
    await expect(firstWindow.getByText('起点状态', { exact: true })).toBeVisible()
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await secondWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(secondWindow.getByText('起点状态', { exact: true })).toBeVisible()
    for (const label of ['领导力', '关键任务', '结构与机制', '文化', '能力']) {
      await expect(secondWindow.getByRole('heading', { name: label, exact: true })).toBeVisible()
    }
    const restoredLeadership = secondWindow.locator('article').filter({ hasText: '领导力' })
    await expect(restoredLeadership.getByText('还需要更多观察', { exact: true })).toBeVisible()
    await expect(restoredLeadership.getByText(/领导力这部分先别判断，还需要更多观察/)).toBeVisible()
    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
