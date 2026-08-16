import {
  acceptedJudgmentListSchema,
  createSchoolInputSchema,
  judgmentIpcChannels,
  judgmentReviewViewSchema,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  schoolIpcChannels,
  schoolListSchema,
  schoolViewSchema,
  submitSituationInputSchema,
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
  judgments: {
    async submitSituation(input) {
      const result: unknown = await ipcRenderer.invoke(
        judgmentIpcChannels.submitSituation,
        submitSituationInputSchema.parse(input),
      )
      return judgmentReviewViewSchema.parse(result)
    },
    async review(input) {
      const result: unknown = await ipcRenderer.invoke(
        judgmentIpcChannels.review,
        reviewDiagnosisInputSchema.parse(input),
      )
      return reviewOutcomeViewSchema.parse(result)
    },
    async listAccepted(schoolId) {
      const result: unknown = await ipcRenderer.invoke(
        judgmentIpcChannels.listAccepted,
        schoolIdSchema.parse(schoolId),
      )
      return acceptedJudgmentListSchema.parse(result)
    },
  },
}

contextBridge.exposeInMainWorld('workbench', api)
