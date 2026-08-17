import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('methodology content is loaded at startup and stays awaiting review', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const app = await electron.launch({
      args: [appDirectory],
      env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory },
    })
    const window = await app.firstWindow()

    await window.getByRole('link', { name: '设置' }).click()
    await window.getByText('高级设置').click()
    await window.getByRole('link', { name: /方法论内容审核/ }).click()

    await expect(
      window.getByRole('heading', { name: 'Schooling by Design Methodology Pack v1' }),
    ).toBeVisible()
    await expect(
      window.getByRole('heading', { name: 'Data Wise Third Edition Methodology Pack' }),
    ).toBeVisible()
    await expect(window.getByText('待审核').first()).toBeVisible()
    await expect(
      window.getByText('还没有人审核过这份内容，它不会用于正式判断。').first(),
    ).toBeVisible()

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('the workbench still works when methodology content cannot be loaded', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-e2e-'))
  const appDirectory = resolve('apps/desktop')

  try {
    const app = await electron.launch({
      args: [appDirectory],
      env: {
        ...process.env,
        SWB_E2E_USER_DATA_DIR: userDataDirectory,
        SWB_METHODOLOGY_ROOT: resolve(userDataDirectory, 'missing-methodology'),
      },
    })
    const window = await app.firstWindow()

    // The product flow is unaffected.
    await window.getByRole('button', { name: '新建学校' }).click()
    await window.getByLabel('学校名称').fill('南山实验学校')
    await window.getByRole('button', { name: '创建' }).click()
    await expect(window.getByRole('heading', { name: '南山实验学校' })).toBeVisible()

    // The review surface degrades quietly instead of crashing or alerting.
    await window.evaluate(() => {
      window.location.hash = '#/settings/methodology-review'
    })
    await expect(window.getByRole('heading', { name: '方法论内容审核' })).toBeVisible()
    await expect(window.getByText('暂时看不到方法论内容')).toBeVisible()

    await app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
