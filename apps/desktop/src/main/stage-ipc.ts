import type { StageService } from '@school-workbench/application'
import {
  adjustStageInputSchema,
  confirmStageInputSchema,
  schoolIdSchema,
  stageIpcChannels,
  stageWorkspaceViewSchema,
  type StageWorkspaceView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

export type StageIpcHandlers = {
  getWorkspace(schoolId: unknown): Promise<StageWorkspaceView>
  adjust(input: unknown): Promise<StageWorkspaceView>
  confirm(input: unknown): Promise<StageWorkspaceView>
}

export function createStageIpcHandlers(service: StageService): StageIpcHandlers {
  return {
    async getWorkspace(schoolId) {
      const parsedSchoolId = schoolIdSchema.parse(schoolId)
      return stageWorkspaceViewSchema.parse(await service.getWorkspace(parsedSchoolId))
    },
    async adjust(input) {
      const parsed = adjustStageInputSchema.parse(input)
      return stageWorkspaceViewSchema.parse(await service.adjust(parsed))
    },
    async confirm(input) {
      const parsed = confirmStageInputSchema.parse(input)
      return stageWorkspaceViewSchema.parse(await service.confirm(parsed))
    },
  }
}

export function registerStageIpc(ipcMain: IpcMain, handlers: StageIpcHandlers): void {
  ipcMain.handle(stageIpcChannels.getWorkspace, (_event, schoolId: unknown) =>
    handlers.getWorkspace(schoolId),
  )
  ipcMain.handle(stageIpcChannels.adjust, (_event, input: unknown) => handlers.adjust(input))
  ipcMain.handle(stageIpcChannels.confirm, (_event, input: unknown) => handlers.confirm(input))
}
