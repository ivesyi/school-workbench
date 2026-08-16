import type { JudgmentService } from '@school-workbench/application'
import {
  acceptedJudgmentListSchema,
  judgmentIpcChannels,
  judgmentReviewViewSchema,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  submitSituationInputSchema,
  type AcceptedJudgmentView,
  type JudgmentReviewView,
  type ReviewOutcomeView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

export type JudgmentIpcHandlers = {
  submitSituation(input: unknown): Promise<JudgmentReviewView>
  review(input: unknown): Promise<ReviewOutcomeView>
  listAccepted(schoolId: unknown): Promise<AcceptedJudgmentView[]>
}

export function createJudgmentIpcHandlers(service: JudgmentService): JudgmentIpcHandlers {
  return {
    async submitSituation(input) {
      const parsed = submitSituationInputSchema.parse(input)
      return judgmentReviewViewSchema.parse(await service.submitSituation(parsed))
    },
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
  ipcMain.handle(judgmentIpcChannels.submitSituation, (_event, input: unknown) =>
    handlers.submitSituation(input),
  )
  ipcMain.handle(judgmentIpcChannels.review, (_event, input: unknown) => handlers.review(input))
  ipcMain.handle(judgmentIpcChannels.listAccepted, (_event, schoolId: unknown) =>
    handlers.listAccepted(schoolId),
  )
}
