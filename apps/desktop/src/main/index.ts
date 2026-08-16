import { JudgmentService, SchoolService, StageService } from '@school-workbench/application'
import {
  openWorkbenchDatabase,
  SqliteJudgmentRepository,
  SqliteSchoolRepository,
  SqliteStageRepository,
} from '@school-workbench/db'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJudgmentIpcHandlers, registerJudgmentIpc } from './judgment-ipc'
import { createSchoolIpcHandlers, registerSchoolIpc } from './school-ipc'
import { createStageIpcHandlers, registerStageIpc } from './stage-ipc'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

const testUserDataDirectory = process.env.SWB_E2E_USER_DATA_DIR
if (testUserDataDirectory && !app.isPackaged) {
  app.setPath('userData', testUserDataDirectory)
}

let closeDatabase: (() => void) | undefined

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f7f5',
    title: '学校变革陪跑工作台',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  const database = openWorkbenchDatabase(
    join(app.getPath('userData'), 'school-workbench.sqlite'),
    join(currentDirectory, 'drizzle'),
  )
  closeDatabase = database.close

  const schoolRepository = new SqliteSchoolRepository(database.db)
  const judgmentRepository = new SqliteJudgmentRepository(database.db)
  const stageRepository = new SqliteStageRepository(database.db)
  const schoolService = new SchoolService(schoolRepository, stageRepository)
  const judgmentService = new JudgmentService(schoolRepository, judgmentRepository)
  const stageService = new StageService(schoolRepository, judgmentRepository, stageRepository)

  registerSchoolIpc(ipcMain, createSchoolIpcHandlers(schoolService))
  registerJudgmentIpc(ipcMain, createJudgmentIpcHandlers(judgmentService))
  registerStageIpc(ipcMain, createStageIpcHandlers(stageService))

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDatabase?.()
  closeDatabase = undefined
})
