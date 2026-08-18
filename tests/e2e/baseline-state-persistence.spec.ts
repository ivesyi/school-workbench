import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createSchool, launchWorkbench } from './support/app'
import { firstSchoolId, openWorkbenchSqlite, seedAcceptedJudgment } from './support/workbench-db'

test('baseline school state is confirmed once and survives restart with five assessments', async () => {
  test.setTimeout(90_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-state-e2e-'))

  try {
    // A school that already carries judgements. They are seeded rather than
    // typed in: a judgement comes from an assistant against the assessment
    // contract, and the contract needs the confirmed stage this flow creates.
    const setup = await launchWorkbench(userDataDirectory)
    await createSchool(setup.window, '南山实验学校')
    await setup.app.close()

    const database = openWorkbenchSqlite(userDataDirectory)
    try {
      const schoolId = firstSchoolId(database)
      seedAcceptedJudgment(database, {
        schoolId,
        statement: '中层仍然依赖校长完成关键任务拆解。',
        suffix: 'first',
        createdAt: '2026-08-18T00:00:01.000Z',
      })
      seedAcceptedJudgment(database, {
        schoolId,
        statement: '教师已经开始稳定教研复盘，能够根据课堂情况调整。',
        suffix: 'second',
        createdAt: '2026-08-18T00:00:02.000Z',
      })
    } finally {
      database.close()
    }

    const firstApp = await launchWorkbench(userDataDirectory)
    const firstWindow = firstApp.window
    await firstWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(firstWindow.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
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
    await firstApp.app.close()

    const secondApp = await launchWorkbench(userDataDirectory)
    const secondWindow = secondApp.window

    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await secondWindow.getByRole('link', { name: '学校状态' }).click()
    await expect(secondWindow.getByText('起点状态', { exact: true })).toBeVisible()
    for (const label of ['领导力', '关键任务', '结构与机制', '文化', '能力']) {
      await expect(secondWindow.getByRole('heading', { name: label, exact: true })).toBeVisible()
    }
    const restoredLeadership = secondWindow.locator('article').filter({ hasText: '领导力' })
    await expect(restoredLeadership.getByText('还需要更多观察', { exact: true })).toBeVisible()
    await expect(restoredLeadership.getByText(/领导力这部分先别判断，还需要更多观察/)).toBeVisible()
    await secondApp.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
