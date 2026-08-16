import type { StateService } from '@school-workbench/application'
import {
  adjustStateInputSchema,
  confirmStateInputSchema,
  schoolIdSchema,
  stateIpcChannels,
  stateWorkspaceViewSchema,
  type StateWorkspaceView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

export type StateIpcHandlers = {
  getWorkspace(schoolId: unknown): Promise<StateWorkspaceView>
  adjust(input: unknown): Promise<StateWorkspaceView>
  confirm(input: unknown): Promise<StateWorkspaceView>
}

export function createStateIpcHandlers(service: StateService): StateIpcHandlers {
  return {
    async getWorkspace(schoolId) {
      const parsedSchoolId = schoolIdSchema.parse(schoolId)
      return stateWorkspaceViewSchema.parse(await service.getWorkspace(parsedSchoolId))
    },
    async adjust(input) {
      const parsed = adjustStateInputSchema.parse(input)
      return stateWorkspaceViewSchema.parse(await service.adjust(parsed))
    },
    async confirm(input) {
      const parsed = confirmStateInputSchema.parse(input)
      return stateWorkspaceViewSchema.parse(await service.confirm(parsed))
    },
  }
}

export function registerStateIpc(ipcMain: IpcMain, handlers: StateIpcHandlers): void {
  ipcMain.handle(stateIpcChannels.getWorkspace, (_event, schoolId: unknown) =>
    handlers.getWorkspace(schoolId),
  )
  ipcMain.handle(stateIpcChannels.adjust, (_event, input: unknown) => handlers.adjust(input))
  ipcMain.handle(stateIpcChannels.confirm, (_event, input: unknown) => handlers.confirm(input))
}
