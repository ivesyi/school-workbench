import { unavailableMethodologyWorkbench } from '@school-workbench/application'
import {
  methodologyIpcChannels,
  packReviewWorkbenchViewSchema,
  signOffPackInputSchema,
  type PackReviewWorkbenchView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'
import type { MethodologyRuntime } from './methodology-runtime'

export type MethodologyIpcHandlers = {
  getReviewWorkbench(): Promise<PackReviewWorkbenchView>
  signOff(input: unknown): Promise<PackReviewWorkbenchView>
}

export function createMethodologyIpcHandlers(
  runtime: () => Promise<MethodologyRuntime>,
): MethodologyIpcHandlers {
  return {
    async getReviewWorkbench() {
      const current = await runtime()
      if (current.state !== 'ready') return unavailableMethodologyWorkbench(current.detail)
      return packReviewWorkbenchViewSchema.parse(await current.service.getWorkbench())
    },
    async signOff(input) {
      const parsed = signOffPackInputSchema.parse(input)
      const current = await runtime()
      if (current.state !== 'ready') return unavailableMethodologyWorkbench(current.detail)
      return packReviewWorkbenchViewSchema.parse(await current.service.signOff(parsed))
    },
  }
}

export function registerMethodologyIpc(ipcMain: IpcMain, handlers: MethodologyIpcHandlers): void {
  ipcMain.handle(methodologyIpcChannels.getReviewWorkbench, () => handlers.getReviewWorkbench())
  ipcMain.handle(methodologyIpcChannels.signOff, (_event, input: unknown) =>
    handlers.signOff(input),
  )
}
