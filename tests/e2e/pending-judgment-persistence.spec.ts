import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createSchool, launchWorkbench } from './support/app'
import { firstSchoolId, openWorkbenchSqlite, seedProposedJudgment } from './support/workbench-db'

/**
 * A judgement an assistant already wrote must still be there when the
 * consultant leaves the school and comes back. The row is seeded as proposed
 * (not accepted): that is the state the workbench was dropping on remount.
 */
test('a proposed judgment still appears when the consultant returns to the school', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-pending-e2e-'))
  const statement = '今天的中层会议里，任务拆解还是主要由校长完成。'

  try {
    const first = await launchWorkbench(userDataDirectory)
    await createSchool(first.window, '南山实验学校')
    await expect(first.window.getByText('还没有正式判断。')).toBeVisible()
    await expect(first.window.getByText('我发现一个新的情况，想让你确认')).toHaveCount(0)
    await first.app.close()

    const database = openWorkbenchSqlite(userDataDirectory)
    try {
      seedProposedJudgment(database, {
        schoolId: firstSchoolId(database),
        statement,
        suffix: 'pending',
      })
    } finally {
      database.close()
    }

    const second = await launchWorkbench(userDataDirectory)
    await second.window.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(second.window.getByText('我发现一个新的情况，想让你确认')).toBeVisible()
    await expect(second.window.getByText(statement)).toBeVisible()
    await expect(second.window.getByRole('button', { name: /^认同$/ })).toBeVisible()
    await expect(second.window.getByRole('button', { name: '我想改一下' })).toBeVisible()
    await expect(second.window.getByRole('button', { name: /^不认同$/ })).toBeVisible()
    await second.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
