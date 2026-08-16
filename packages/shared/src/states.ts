import { z } from 'zod'
import { schoolIdSchema } from './schools'
import { stageDimensionKeySchema } from './stages'

export const dimensionAssessmentStatusSchema = z.enum([
  'unverified',
  'far_below',
  'partial',
  'mostly',
  'stable',
])

export const stateDimensionViewSchema = z.object({
  dimensionKey: stageDimensionKeySchema,
  label: z.string().min(1),
  target: z.string().min(1),
  status: dimensionAssessmentStatusSchema,
  statusLabel: z.string().min(1),
  summary: z.string().min(1),
  basis: z.array(z.string().min(1)),
})

export const stateOverviewViewSchema = z.object({
  stage: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    focus: z.string().min(1),
  }),
  summary: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  dimensions: z.array(stateDimensionViewSchema).length(5),
})

export const stateWorkspaceViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('needs_stage') }),
  z.object({
    state: z.literal('needs_judgments'),
    stageTitle: z.string().min(1),
  }),
  z.object({
    state: z.literal('draft'),
    overview: stateOverviewViewSchema,
  }),
  z.object({
    state: z.literal('baseline'),
    overview: stateOverviewViewSchema,
  }),
])

export const adjustStateInputSchema = z.object({
  schoolId: schoolIdSchema,
  feedback: z.string().trim().min(1, '请说说哪里需要调整').max(4000),
})

export const confirmStateInputSchema = z.object({
  schoolId: schoolIdSchema,
})

export const stateIpcChannels = {
  getWorkspace: 'states:get-workspace',
  adjust: 'states:adjust',
  confirm: 'states:confirm',
} as const

export type DimensionAssessmentStatus = z.infer<typeof dimensionAssessmentStatusSchema>
export type StateDimensionView = z.infer<typeof stateDimensionViewSchema>
export type StateOverviewView = z.infer<typeof stateOverviewViewSchema>
export type StateWorkspaceView = z.infer<typeof stateWorkspaceViewSchema>
export type AdjustStateInput = z.infer<typeof adjustStateInputSchema>
export type ConfirmStateInput = z.infer<typeof confirmStateInputSchema>
