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

async function createBaseline(window: Page): Promise<void> {
  await createSchool(window, '南山实验学校')
  await acceptSituation(window, '中层仍然依赖校长完成关键任务拆解。')
  await expect(window.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
  await acceptSituation(window, '教师已经开始稳定教研复盘，能够根据课堂情况调整。')
  await window.getByRole('button', { name: '基本对' }).click()
  await expect(window.getByText('当前阶段')).toBeVisible()
  await window.getByRole('link', { name: '学校状态' }).click()
  await window.getByRole('button', { name: '确认现在的状态' }).click()
  await expect(window.getByText('已经记录这所学校当前的起点状态。')).toBeVisible()
}

test('second confirmed school state compares with baseline and survives restart without creating a third state', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-state-change-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const firstApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await firstApp.firstWindow()

    await createBaseline(firstWindow)
    await firstWindow.getByRole('link', { name: '工作台' }).click()
    await acceptSituation(
      firstWindow,
      '中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。',
    )

    await firstWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(
      firstWindow.getByText('这轮你已经确认了 1 个新的变化，我重新整理了一下学校现在的状态。'),
    ).toBeVisible()
    await expect(firstWindow.getByText('和上一次相比', { exact: true })).toBeVisible()
    const comparisonSection = firstWindow.locator('section').filter({ hasText: '和上一次相比' })
    const leadershipChange = comparisonSection.locator('article').filter({ hasText: '领导力' })
    await expect(leadershipChange.getByText('改善', { exact: true })).toBeVisible()

    await firstWindow.getByRole('button', { name: '我想调整' }).click()
    await firstWindow.getByLabel('哪里需要调整？').fill('文化这部分先别判断，还需要更多观察')
    await firstWindow.getByRole('button', { name: '重新整理当前状态' }).click()
    await expect(firstWindow.getByText('已经记录这所学校现在的状态。')).toHaveCount(0)

    await firstWindow.getByRole('button', { name: '确认现在的状态' }).click()
    await expect(firstWindow.getByText('已经记录这所学校现在的状态。')).toBeVisible()
    await expect(firstWindow.getByText('和上一次相比', { exact: true })).toBeVisible()
    await expect(firstWindow.getByRole('button', { name: '确认现在的状态' })).toHaveCount(0)
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await secondWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(secondWindow.getByText('现在的状态', { exact: true })).toBeVisible()
    await expect(secondWindow.getByText('和上一次相比', { exact: true })).toBeVisible()
    const restoredComparison = secondWindow.locator('section').filter({ hasText: '和上一次相比' })
    const restoredLeadership = restoredComparison.locator('article').filter({ hasText: '领导力' })
    await expect(restoredLeadership.getByText('改善', { exact: true })).toBeVisible()
    await restoredLeadership.getByText('看看这项变化', { exact: true }).click()
    await expect(restoredLeadership.getByText('上一次', { exact: true })).toBeVisible()
    await expect(restoredLeadership.getByText(/中层仍然依赖校长完成关键任务拆解/)).toBeVisible()
    await expect(secondWindow.getByRole('button', { name: '确认现在的状态' })).toHaveCount(0)

    const repeated = await secondWindow.evaluate(async () => {
      const api = (window as typeof window & { workbench: Window['workbench'] }).workbench
      return api.states.confirm({ schoolId: '南山实验学校' })
    }).catch(() => null)
    expect(repeated).toBeNull()

    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
