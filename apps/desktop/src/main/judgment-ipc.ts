import type { JudgmentService } from '@school-workbench/application'
import {
  acceptedJudgmentListSchema,
  judgmentIpcChannels,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  type AcceptedJudgmentView,
  type ReviewOutcomeView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

/**
 * The judgement surface the renderer can reach.
 *
 * Reviewing and listing only. There is no channel that creates a judgement:
 * proposals arrive through the assessment contract an assistant submits
 * against, and nothing on this side of IPC can bypass it.
 */
export type JudgmentIpcHandlers = {
  review(input: unknown): Promise<ReviewOutcomeView>
  listAccepted(schoolId: unknown): Promise<AcceptedJudgmentView[]>
}

export function createJudgmentIpcHandlers(service: JudgmentService): JudgmentIpcHandlers {
  return {
    async review(input) {
      const parsed = reviewDiagnosisInputSchema.parse(input)
      return reviewOutcomeViewSchema.parse(await service.review(parsed))
    },
    async listAccepted(schoolId) {
      const parsedSchoolId = schoolIdSchema.parse(schoolId)
      return acceptedJudgmentListSchema.parse(await service.listAccepted(parsedSchoolId))
    },
  }
}

export function registerJudgmentIpc(ipcMain: IpcMain, handlers: JudgmentIpcHandlers): void {
  ipcMain.handle(judgmentIpcChannels.review, (_event, input: unknown) => handlers.review(input))
  ipcMain.handle(judgmentIpcChannels.listAccepted, (_event, schoolId: unknown) =>
    handlers.listAccepted(schoolId),
  )
}
