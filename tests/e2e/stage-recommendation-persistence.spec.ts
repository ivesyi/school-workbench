import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

async function createSchoolAndAcceptSituation(
  window: Page,
  schoolName: string,
  situation: string,
): Promise<void> {
  await window.getByRole('button', { name: '新建学校' }).click()
  await window.getByLabel('学校名称').fill(schoolName)
  await window.getByRole('button', { name: '创建' }).click()
  await window.getByPlaceholder(/例如：今天的中层会议里/).fill(situation)
  await window.getByRole('button', { name: '提交情况' }).click()
  await window.getByRole('button', { name: '认同', exact: true }).click()
  await expect(window.getByText(/我理解这个学校目前大致处于/)).toBeVisible()
}

test('confirmed stage appears on the school list and survives restart with its targets', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-stage-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const firstApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await firstApp.firstWindow()

    await createSchoolAndAcceptSituation(
      firstWindow,
      '南山实验学校',
      '今天的中层会议里，任务拆解还是主要由校长完成。',
    )
    await expect(firstWindow.getByText('这样理解基本对吗？')).toBeVisible()
    await firstWindow.getByRole('button', { name: '基本对' }).click()
    await expect(firstWindow.getByText('当前阶段')).toBeVisible()
    await expect(firstWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()

    await firstWindow.getByRole('link', { name: '所有学校' }).click()
    await expect(firstWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await expect(firstWindow.getByText('还没有形成当前阶段判断')).toHaveCount(0)
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await expect(secondWindow.getByText('建立共同推动改进的组织基础')).toBeVisible()
    await expect(secondWindow.getByText('还没有形成当前阶段判断')).toHaveCount(0)
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

test('natural-language adjustment overrides old context and remains planned after restart', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-stage-adjust-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const firstApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const firstWindow = await firstApp.firstWindow()

    await createSchoolAndAcceptSituation(
      firstWindow,
      '滨江学校',
      '最近学生学习结果已经出现变化，需要继续验证。',
    )
    await expect(firstWindow.getByText(/验证学生学习变化/)).toBeVisible()

    await firstWindow.getByRole('button', { name: '调整一下' }).click()
    await firstWindow.getByLabel('哪里需要调整？').fill('目前更需要稳定教研复盘机制')
    await firstWindow.getByRole('button', { name: '重新整理建议' }).click()
    await expect(firstWindow.getByText(/让改进进入教师实践/)).toBeVisible()
    await firstWindow.getByText('这个阶段我会重点看什么').click()
    await expect(
      firstWindow.getByText('教研、观察和复盘形成稳定节奏，能够支持教师持续试验和调整。'),
    ).toBeVisible()
    await firstApp.close()

    const secondApp = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const secondWindow = await secondApp.firstWindow()

    await expect(secondWindow.getByText('还没有形成当前阶段判断')).toBeVisible()
    await secondWindow.getByRole('link', { name: /滨江学校/ }).click()
    await expect(secondWindow.getByText(/让改进进入教师实践/)).toBeVisible()
    await expect(secondWindow.getByText('这样理解基本对吗？')).toBeVisible()
    await secondWindow.getByText('这个阶段我会重点看什么').click()
    await expect(
      secondWindow.getByText('教研、观察和复盘形成稳定节奏，能够支持教师持续试验和调整。'),
    ).toBeVisible()
    await secondApp.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
