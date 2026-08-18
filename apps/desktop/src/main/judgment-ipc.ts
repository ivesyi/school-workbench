import type { JudgmentService } from '@school-workbench/application'
import {
  acceptedJudgmentListSchema,
  judgmentIpcChannels,
  judgmentReviewListSchema,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  type AcceptedJudgmentView,
  type JudgmentReviewView,
  type ReviewOutcomeView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

/**
 * The judgement surface the renderer can reach.
 *
 * Reviewing and listing only. `listPending` re-reads proposed rows the
 * assistant already wrote; it does not create a judgement. Proposals arrive
 * through the assessment contract an assistant submits against, and nothing
 * on this side of IPC can bypass it.
 */
export type JudgmentIpcHandlers = {
  review(input: unknown): Promise<ReviewOutcomeView>
  listPending(schoolId: unknown): Promise<JudgmentReviewView[]>
  listAccepted(schoolId: unknown): Promise<AcceptedJudgmentView[]>
}

export function createJudgmentIpcHandlers(service: JudgmentService): JudgmentIpcHandlers {
  return {
    async review(input) {
      const parsed = reviewDiagnosisInputSchema.parse(input)
      return reviewOutcomeViewSchema.parse(await service.review(parsed))
    },
    async listPending(schoolId) {
      const parsedSchoolId = schoolIdSchema.parse(schoolId)
      return judgmentReviewListSchema.parse(await service.listPending(parsedSchoolId))
    },
    async listAccepted(schoolId) {
      const parsedSchoolId = schoolIdSchema.parse(schoolId)
      return acceptedJudgmentListSchema.parse(await service.listAccepted(parsedSchoolId))
    },
  }
}

export function registerJudgmentIpc(ipcMain: IpcMain, handlers: JudgmentIpcHandlers): void {
  ipcMain.handle(judgmentIpcChannels.review, (_event, input: unknown) => handlers.review(input))
  ipcMain.handle(judgmentIpcChannels.listPending, (_event, schoolId: unknown) =>
    handlers.listPending(schoolId),
  )
  ipcMain.handle(judgmentIpcChannels.listAccepted, (_event, schoolId: unknown) =>
    handlers.listAccepted(schoolId),
  )
}
