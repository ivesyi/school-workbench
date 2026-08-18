import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createSchool, launchWorkbench } from './support/app'
import { firstSchoolId, openWorkbenchSqlite, seedAcceptedJudgment } from './support/workbench-db'

function seed(
  userDataDirectory: string,
  entries: ReadonlyArray<{ statement: string; suffix: string; createdAt: string }>,
): void {
  const database = openWorkbenchSqlite(userDataDirectory)
  try {
    const schoolId = firstSchoolId(database)
    for (const entry of entries) seedAcceptedJudgment(database, { schoolId, ...entry })
  } finally {
    database.close()
  }
}

test('second confirmed school state compares with baseline and survives restart without creating a third state', async () => {
  test.setTimeout(120_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-state-change-e2e-'))

  try {
    const setup = await launchWorkbench(userDataDirectory)
    await createSchool(setup.window, '南山实验学校')
    await setup.app.close()

    // The judgements this flow rests on are seeded: producing one needs an
    // assistant working against the assessment contract, and the contract needs
    // the confirmed stage that this flow is about creating.
    seed(userDataDirectory, [
      {
        statement: '中层仍然依赖校长完成关键任务拆解。',
        suffix: 'first',
        createdAt: '2026-08-18T00:00:01.000Z',
      },
      {
        statement: '教师已经开始稳定教研复盘，能够根据课堂情况调整。',
        suffix: 'second',
        createdAt: '2026-08-18T00:00:02.000Z',
      },
    ])

    const baselineApp = await launchWorkbench(userDataDirectory)
    const baselineWindow = baselineApp.window
    await baselineWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(baselineWindow.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
    await baselineWindow.getByRole('button', { name: '基本对' }).click()
    await expect(baselineWindow.getByText('当前阶段')).toBeVisible()
    await baselineWindow.getByRole('link', { name: '学校状态' }).click()
    await baselineWindow.getByRole('button', { name: '确认现在的状态' }).click()
    await expect(baselineWindow.getByText('已经记录这所学校当前的起点状态。')).toBeVisible()
    await baselineApp.app.close()

    seed(userDataDirectory, [
      {
        statement: '中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。',
        suffix: 'third',
        createdAt: '2026-08-18T00:00:03.000Z',
      },
    ])

    const firstApp = await launchWorkbench(userDataDirectory)
    const firstWindow = firstApp.window
    await firstWindow.getByRole('link', { name: /南山实验学校/ }).click()
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
    await firstApp.app.close()

    const secondApp = await launchWorkbench(userDataDirectory)
    const secondWindow = secondApp.window

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await secondWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(secondWindow.getByText('现在的状态', { exact: true })).toBeVisible()
    await expect(secondWindow.getByText('和上一次相比', { exact: true })).toBeVisible()
    const restoredComparison = secondWindow.locator('section').filter({ hasText: '和上一次相比' })
    const restoredLeadership = restoredComparison.locator('article').filter({ hasText: '领导力' })
    await expect(restoredLeadership.getByText('改善', { exact: true })).toBeVisible()
    await restoredLeadership.getByText('看看这项变化', { exact: true }).click()
    await expect(restoredLeadership.getByText('上一次', { exact: true })).toBeVisible()
    await expect(
      restoredLeadership.getByText(/中层仍然依赖校长完成关键任务拆解/).first(),
    ).toBeVisible()
    await expect(secondWindow.getByRole('button', { name: '确认现在的状态' })).toHaveCount(0)

    const repeated = await secondWindow.evaluate(async () => {
      const api = (
        window as unknown as {
          workbench: {
            schools: { list(): Promise<Array<{ id: string; name: string }>> }
            states: { confirm(input: { schoolId: string }): Promise<{ state: string }> }
          }
        }
      ).workbench
      const schools = await api.schools.list()
      const target = schools.find((item) => item.name === '南山实验学校')
      if (!target) throw new Error('school not found')
      return api.states.confirm({ schoolId: target.id })
    })
    expect(repeated.state).toBe('current')

    await secondApp.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
