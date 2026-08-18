import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'

const appDirectory = resolve('apps/desktop')

export async function launchWorkbench(
  userDataDirectory: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appDirectory],
    env: { ...process.env, SWB_E2E_USER_DATA_DIR: userDataDirectory, ...extraEnv },
  })
  return { app, window: await app.firstWindow() }
}

export async function createSchool(window: Page, schoolName: string): Promise<void> {
  await window.getByRole('button', { name: '新建学校' }).click()
  await window.getByLabel('学校名称').fill(schoolName)
  await window.getByRole('button', { name: '创建' }).click()
  await window.getByRole('heading', { name: schoolName }).waitFor()
}
