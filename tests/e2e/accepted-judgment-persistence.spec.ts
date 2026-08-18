import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createSchool, launchWorkbench } from './support/app'
import { firstSchoolId, openWorkbenchSqlite, seedAcceptedJudgment } from './support/workbench-db'

/**
 * A judgement the consultant confirmed is part of the school's formal record,
 * so it has to be there after a restart. The judgement itself is produced by an
 * assistant against the assessment contract; this school starts with one
 * already accepted, because that is the state being checked.
 */
test('an accepted judgment remains after the desktop app restarts', async () => {
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'school-workbench-judgment-e2e-'))
  const statement = '今天的中层会议里，任务拆解还是主要由校长完成。'

  try {
    const first = await launchWorkbench(userDataDirectory)
    await createSchool(first.window, '南山实验学校')
    await expect(first.window.getByText('还没有正式判断。')).toBeVisible()
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

    const second = await launchWorkbench(userDataDirectory)
    await second.window.getByRole('link', { name: /南山实验学校/ }).click()
    await expect(second.window.getByText(statement)).toBeVisible()
    await expect(second.window.getByText('已由你确认')).toBeVisible()
    await second.app.close()
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
