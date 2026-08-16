import { z } from 'zod'
import { schoolIdSchema } from './schools'

export const stageDimensionKeySchema = z.enum([
  'leadership',
  'critical_tasks',
  'structure_systems',
  'culture',
  'capacity',
])

export const stageTargetViewSchema = z.object({
  id: z.string().min(1),
  dimensionKey: stageDimensionKeySchema,
  label: z.string().min(1),
  text: z.string().min(1),
})

export const stageSummaryViewSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  focus: z.string().min(1),
  targets: z.array(stageTargetViewSchema).length(5),
})

export const stageWorkspaceViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({
    state: z.literal('suggested'),
    stage: stageSummaryViewSchema,
  }),
  z.object({
    state: z.literal('active'),
    stage: stageSummaryViewSchema,
  }),
])

export const adjustStageInputSchema = z.object({
  schoolId: schoolIdSchema,
  stageId: z.string().min(1),
  feedback: z.string().trim().min(1, '请说说哪里需要调整').max(4000),
})

export const confirmStageInputSchema = z.object({
  schoolId: schoolIdSchema,
  stageId: z.string().min(1),
})

export const stageIpcChannels = {
  getWorkspace: 'stages:get-workspace',
  adjust: 'stages:adjust',
  confirm: 'stages:confirm',
} as const

export type StageWorkspaceView = z.infer<typeof stageWorkspaceViewSchema>
export type StageSummaryView = z.infer<typeof stageSummaryViewSchema>
export type AdjustStageInput = z.infer<typeof adjustStageInputSchema>
export type ConfirmStageInput = z.infer<typeof confirmStageInputSchema>
