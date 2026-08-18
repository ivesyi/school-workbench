import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createSchool, launchWorkbench } from './support/app'
import { firstSchoolId, openWorkbenchSqlite, seedAcceptedJudgment } from './support/workbench-db'

/**
 * The stage slice starts from judgements the school already carries. Those
 * cannot be produced through the interface here — an assistant produces a
 * judgement against the assessment contract, and the contract needs the very
 * confirmed stage this slice creates — so the starting position is seeded.
 */
async function schoolWithJudgment(
  userDataDirectory: string,
  schoolName: string,
  statement: string,
): Promise<void> {
  const first = await launchWorkbench(userDataDirectory)
  await createSchool(first.window, schoolName)
  await first.app.close()

  const database = openWorkbenchSqlite(userDataDirectory)
  try {
    seedAcceptedJudgment(database, {
      schoolId: firstSchoolId(database),
      statement,
      suffix: 'first',
    })
  } finally {
    database.close()
  }
}

test('confirmed stage appears on the school list and survives restart with its targets', async () => {
  test.setTimeout(90_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-stage-e2e-'))

  try {
    await schoolWithJudgment(
      userDataDirectory,
      '南山实验学校',
      '今天的中层会议里，任务拆解还是主要由校长完成。',
    )

    const firstApp = await launchWorkbench(userDataDirectory)
    const firstWindow = firstApp.window
    await firstWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(firstWindow.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
    await expect(firstWindow.getByText('这样理解基本对吗？')).toBeVisible()
    await firstWindow.getByRole('button', { name: '基本对' }).click()
    await expect(firstWindow.getByText('当前阶段')).toBeVisible()
    await expect(firstWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()

    await firstWindow.getByRole('link', { name: '所有学校' }).click()
    await expect(firstWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await expect(firstWindow.getByText('还没有形成当前阶段判断')).toHaveCount(0)
    await firstApp.app.close()

    const secondApp = await launchWorkbench(userDataDirectory)
    const secondWindow = secondApp.window

    await expect(secondWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await expect(secondWindow.getByText('还没有形成当前阶段判断')).toHaveCount(0)
    await secondWindow.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(secondWindow.getByText('当前阶段')).toBeVisible()
    await expect(secondWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await secondWindow.getByText('这个阶段重点看什么').click()
    await expect(
      secondWindow.getByText('校长从直接代办转向明确方向、授权和复盘，中层承担真实责任。'),
    ).toBeVisible()
    await secondApp.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('natural-language adjustment overrides old context and remains planned after restart', async () => {
  test.setTimeout(90_000)
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-stage-adjust-e2e-'))

  try {
    await schoolWithJudgment(
      userDataDirectory,
      '滨江学校',
      '最近学生学习结果已经出现变化，需要继续验证。',
    )

    const firstApp = await launchWorkbench(userDataDirectory)
    const firstWindow = firstApp.window
    await firstWindow.getByRole('link', { name: /滨江学校/ }).click()
    await expect(firstWindow.getByText(/验证学生学习变化/)).toBeVisible()

    await firstWindow.getByRole('button', { name: '调整一下' }).click()
    await firstWindow.getByLabel('哪里需要调整？').fill('目前更需要稳定教研复盘机制')
    await firstWindow.getByRole('button', { name: '重新整理建议' }).click()
    await expect(firstWindow.getByText(/让改进进入教师实践/)).toBeVisible()
    await firstWindow.getByText('这个阶段我会重点看什么').click()
    await expect(
      firstWindow.getByText('教研、观察和复盘形成稳定节奏，能够支持教师持续试验和调整。'),
    ).toBeVisible()
    await firstApp.app.close()

    const secondApp = await launchWorkbench(userDataDirectory)
    const secondWindow = secondApp.window

    await expect(secondWindow.getByText('还没有形成当前阶段判断')).toBeVisible()
    await secondWindow.getByRole('link', { name: /滨江学校/ }).click()
    await expect(secondWindow.getByText(/让改进进入教师实践/)).toBeVisible()
    await expect(secondWindow.getByText('这样理解基本对吗？')).toBeVisible()
    await secondWindow.getByText('这个阶段我会重点看什么').click()
    await expect(
      secondWindow.getByText('教研、观察和复盘形成稳定节奏，能够支持教师持续试验和调整。'),
    ).toBeVisible()
    await secondApp.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
