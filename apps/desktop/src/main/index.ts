import {
  JudgmentService,
  SchoolService,
  StageService,
  StateService,
} from '@school-workbench/application'
import {
  openWorkbenchDatabase,
  SqliteAgentRuntimeRepository,
  SqlitePreferencesRepository,
  SqliteJudgmentRepository,
  SqliteSchoolRepository,
  SqliteStageRepository,
  SqliteStateRepository,
} from '@school-workbench/db'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentIpcHandlers, registerAgentIpc, type AgentRunner } from './agent-ipc'
import { assistantReadiness, runAgentOnce } from './agent-runtime'
import { agentIpcChannels, type AgentProgressEvent } from '@school-workbench/shared'
import { createJudgmentIpcHandlers, registerJudgmentIpc } from './judgment-ipc'
import { createMethodologyIpcHandlers, registerMethodologyIpc } from './methodology-ipc'
import {
  createMethodologyRuntime,
  resolveMethodologyPaths,
  type MethodologyRuntime,
} from './methodology-runtime'
import { startWorkbenchReadPlane, type ReadPlaneRuntime } from './read-plane-runtime'
import { createSchoolIpcHandlers, registerSchoolIpc } from './school-ipc'
import {
  createSettingsIpcHandlers,
  registerSettingsIpc,
  type AssistantReadiness,
} from './settings-ipc'
import { createStageIpcHandlers, registerStageIpc } from './stage-ipc'
import { createStateIpcHandlers, registerStateIpc } from './state-ipc'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

const testUserDataDirectory = process.env.SWB_E2E_USER_DATA_DIR
if (testUserDataDirectory && !app.isPackaged) {
  app.setPath('userData', testUserDataDirectory)
}

let closeDatabase: (() => void) | undefined
let readPlane: ReadPlaneRuntime | undefined
let agentRunner: AgentRunner | null = null

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
  const stateRepository = new SqliteStateRepository(database.db)
  const schoolService = new SchoolService(schoolRepository, stageRepository)
  const judgmentService = new JudgmentService(judgmentRepository)
  const stageService = new StageService(schoolRepository, judgmentRepository, stageRepository)
  const stateService = new StateService(
    schoolRepository,
    judgmentRepository,
    stageRepository,
    stateRepository,
  )

  // Methodology content is a read-only build input. Loading it must never block
  // or break the workbench, so the runtime is prepared off the startup path and
  // any failure resolves to a quiet unavailable state.
  const methodologyRuntime: Promise<MethodologyRuntime> = createMethodologyRuntime({
    database,
    paths: resolveMethodologyPaths(currentDirectory),
    onError: (message) => process.stderr.write(`${message}\n`),
  })

  // The loopback read plane is the Agent's only route into workbench domain
  // capability (SPEC 13/16). It starts independently of the methodology runtime:
  // only `standards_get` needs methodology content, and the other six read
  // capabilities must not be taken down by an unreadable pack file.
  const agentRuntimeRepository = new SqliteAgentRuntimeRepository(database)
  const preferencesRepository = new SqlitePreferencesRepository(database)

  function broadcastProgress(event: AgentProgressEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(agentIpcChannels.progress, event)
    }
  }

  // Whether an assistant could be started at all. It is a question about this
  // computer, not about a running agent, so it is answered from paths rather
  // than by starting anything.
  let readiness: AssistantReadiness = {
    ready: false,
    detail: '工作台还在启动，稍等一下再看。',
  }
  void startWorkbenchReadPlane({ database, methodology: methodologyRuntime })
    .then((runtime) => {
      readPlane = runtime
      readiness = assistantReadiness(currentDirectory)
      agentRunner = (input) =>
        runAgentOnce(
          {
            readPlane: runtime.plane,
            writeService: runtime.writeService,
            endpoint: runtime.endpoint,
            repository: agentRuntimeRepository,
            judgments: judgmentService,
            mainDirectory: currentDirectory,
            execPath: process.execPath,
            userDataDirectory: app.getPath('userData'),
            onDiagnostic: (message) => process.stderr.write(`${message}\n`),
            onProgress: (phase) => broadcastProgress({ schoolId: input.schoolId, phase }),
          },
          input,
        )
      // Deliberately reports readiness only. The port and the capability tokens
      // never leave this process.
      process.stderr.write('workbench read plane ready\n')
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`workbench read plane unavailable: ${detail}\n`)
    })

  registerSchoolIpc(ipcMain, createSchoolIpcHandlers(schoolService))
  registerJudgmentIpc(ipcMain, createJudgmentIpcHandlers(judgmentService))
  registerStageIpc(ipcMain, createStageIpcHandlers(stageService))
  registerStateIpc(ipcMain, createStateIpcHandlers(stateService))
  registerMethodologyIpc(
    ipcMain,
    createMethodologyIpcHandlers(() => methodologyRuntime),
  )
  registerAgentIpc(
    ipcMain,
    createAgentIpcHandlers(() => agentRunner),
  )
  registerSettingsIpc(
    ipcMain,
    createSettingsIpcHandlers({
      read: (key) => preferencesRepository.get(key),
      write: (key, value) => preferencesRepository.set(key, value),
      readiness: () => readiness,
    }),
  )

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false

/**
 * Shutting the loopback down is asynchronous, so the first quit is deferred
 * until the HTTP server has actually closed. The second pass through this
 * handler is allowed to proceed. A bounded wait keeps a stuck socket from
 * turning "quit" into "hang".
 */
app.on('before-quit', (event) => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  void (async () => {
    const stopping = readPlane?.stop().catch(() => undefined) ?? Promise.resolve()
    await Promise.race([
      stopping,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000).unref?.()),
    ])
    readPlane = undefined
    agentRunner = null
    closeDatabase?.()
    closeDatabase = undefined
    app.quit()
  })()
})
