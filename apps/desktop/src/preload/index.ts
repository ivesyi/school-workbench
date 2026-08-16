import {
  createSchoolInputSchema,
  schoolIdSchema,
  schoolIpcChannels,
  schoolListSchema,
  schoolViewSchema,
  type WorkbenchApi,
} from '@school-workbench/shared'
import { contextBridge, ipcRenderer } from 'electron'

const api: WorkbenchApi = {
  schools: {
    async list() {
      return schoolListSchema.parse(await ipcRenderer.invoke(schoolIpcChannels.list))
    },
    async create(input) {
      const result: unknown = await ipcRenderer.invoke(
        schoolIpcChannels.create,
        createSchoolInputSchema.parse(input),
      )
      return schoolViewSchema.parse(result)
    },
    async get(id) {
      const result: unknown = await ipcRenderer.invoke(
        schoolIpcChannels.get,
        schoolIdSchema.parse(id),
      )
      return result === null ? null : schoolViewSchema.parse(result)
    },
  },
}

contextBridge.exposeInMainWorld('workbench', api)
