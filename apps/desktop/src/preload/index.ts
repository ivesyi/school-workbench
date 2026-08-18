import {
  acceptedJudgmentListSchema,
  archiveSchoolInputSchema,
  adjustStageInputSchema,
  agentIpcChannels,
  agentProgressEventSchema,
  agentRunViewSchema,
  assistantSettingsViewSchema,
  chooseAssistantInputSchema,
  runAgentInputSchema,
  settingsIpcChannels,
  adjustStateInputSchema,
  confirmStageInputSchema,
  confirmStateInputSchema,
  createSchoolInputSchema,
  judgmentIpcChannels,
  methodologyIpcChannels,
  packReviewWorkbenchViewSchema,
  reviewDiagnosisInputSchema,
  reviewOutcomeViewSchema,
  schoolIdSchema,
  schoolIpcChannels,
  schoolListSchema,
  schoolViewSchema,
  signOffPackInputSchema,
  stageIpcChannels,
  stageWorkspaceViewSchema,
  stateIpcChannels,
  stateWorkspaceViewSchema,
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
    async archive(input) {
      await ipcRenderer.invoke(schoolIpcChannels.archive, archiveSchoolInputSchema.parse(input))
    },
  },
  judgments: {
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
  states: {
    async getWorkspace(schoolId) {
      const result: unknown = await ipcRenderer.invoke(
        stateIpcChannels.getWorkspace,
        schoolIdSchema.parse(schoolId),
      )
      return stateWorkspaceViewSchema.parse(result)
    },
    async adjust(input) {
      const result: unknown = await ipcRenderer.invoke(
        stateIpcChannels.adjust,
        adjustStateInputSchema.parse(input),
      )
      return stateWorkspaceViewSchema.parse(result)
    },
    async confirm(input) {
      const result: unknown = await ipcRenderer.invoke(
        stateIpcChannels.confirm,
        confirmStateInputSchema.parse(input),
      )
      return stateWorkspaceViewSchema.parse(result)
    },
  },
  methodology: {
    async getReviewWorkbench() {
      const result: unknown = await ipcRenderer.invoke(methodologyIpcChannels.getReviewWorkbench)
      return packReviewWorkbenchViewSchema.parse(result)
    },
    async signOff(input) {
      const result: unknown = await ipcRenderer.invoke(
        methodologyIpcChannels.signOff,
        signOffPackInputSchema.parse(input),
      )
      return packReviewWorkbenchViewSchema.parse(result)
    },
  },
  settings: {
    async getAssistant() {
      const result: unknown = await ipcRenderer.invoke(settingsIpcChannels.getAssistant)
      return assistantSettingsViewSchema.parse(result)
    },
    async chooseAssistant(input) {
      const result: unknown = await ipcRenderer.invoke(
        settingsIpcChannels.chooseAssistant,
        chooseAssistantInputSchema.parse(input),
      )
      return assistantSettingsViewSchema.parse(result)
    },
  },
  agent: {
    async run(input) {
      const result: unknown = await ipcRenderer.invoke(
        agentIpcChannels.run,
        runAgentInputSchema.parse(input),
      )
      return agentRunViewSchema.parse(result)
    },
    onProgress(handler) {
      // Validated on the way in as well: the renderer only ever sees one of the
      // four steps the product is allowed to show.
      const listener = (_event: unknown, payload: unknown): void => {
        const parsed = agentProgressEventSchema.safeParse(payload)
        if (parsed.success) handler(parsed.data)
      }
      ipcRenderer.on(agentIpcChannels.progress, listener)
      return () => {
        ipcRenderer.off(agentIpcChannels.progress, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('workbench', api)
