import {
  acceptedJudgmentListSchema,
  adjustStageInputSchema,
  confirmStageInputSchema,
  createSchoolInputSchema,
  judgmentIpcChannels,
  judgmentReviewViewSchema,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  schoolIpcChannels,
  schoolListSchema,
  schoolViewSchema,
  stageIpcChannels,
  stageWorkspaceViewSchema,
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
  stages: {
    async getWorkspace(schoolId) {
      const result: unknown = await ipcRenderer.invoke(
        stageIpcChannels.getWorkspace,
        schoolIdSchema.parse(schoolId),
      )
      return stageWorkspaceViewSchema.parse(result)
    },
    async adjust(input) {
      const result: unknown = await ipcRenderer.invoke(
        stageIpcChannels.adjust,
        adjustStageInputSchema.parse(input),
      )
      return stageWorkspaceViewSchema.parse(result)
    },
    async confirm(input) {
      const result: unknown = await ipcRenderer.invoke(
        stageIpcChannels.confirm,
        confirmStageInputSchema.parse(input),
      )
      return stageWorkspaceViewSchema.parse(result)
    },
  },
}

contextBridge.exposeInMainWorld('workbench', api)
