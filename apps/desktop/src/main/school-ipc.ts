import type { SchoolService } from '@school-workbench/application'
import {
  archiveSchoolInputSchema,
  createSchoolInputSchema,
  schoolIdSchema,
  schoolIpcChannels,
  schoolListSchema,
  schoolViewSchema,
  type CreateSchoolInput,
  type SchoolView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

export type SchoolIpcHandlers = {
  list(): Promise<SchoolView[]>
  create(input: unknown): Promise<SchoolView>
  get(id: unknown): Promise<SchoolView | null>
  archive(input: unknown): Promise<void>
}

export function createSchoolIpcHandlers(service: SchoolService): SchoolIpcHandlers {
  return {
    async list() {
      return schoolListSchema.parse(await service.list())
    },
    async create(input) {
      const parsed: CreateSchoolInput = createSchoolInputSchema.parse(input)
      return schoolViewSchema.parse(await service.create(parsed))
    },
    async get(id) {
      const school = await service.get(schoolIdSchema.parse(id))
      return school ? schoolViewSchema.parse(school) : null
    },
    async archive(input) {
      await service.archive(archiveSchoolInputSchema.parse(input).schoolId)
    },
  }
}

export function registerSchoolIpc(ipcMain: IpcMain, handlers: SchoolIpcHandlers): void {
  ipcMain.handle(schoolIpcChannels.list, () => handlers.list())
  ipcMain.handle(schoolIpcChannels.create, (_event, input: unknown) => handlers.create(input))
  ipcMain.handle(schoolIpcChannels.get, (_event, id: unknown) => handlers.get(id))
  ipcMain.handle(schoolIpcChannels.archive, (_event, input: unknown) => handlers.archive(input))
}
