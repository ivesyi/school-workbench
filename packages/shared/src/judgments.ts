import { z } from 'zod'
import { schoolIdSchema } from './schools'

export const situationTextSchema = z.string().trim().min(1, '请先说说发生了什么').max(20000)

export const submitSituationInputSchema = z.object({
  schoolId: schoolIdSchema,
  text: situationTextSchema,
})

export const evidenceReferenceViewSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.string().min(1),
})

export const observationFactViewSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  directness: z.enum(['low', 'medium', 'high']),
})

export const claimViewSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
})

export const diagnosisProposalViewSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  interpretations: z.array(z.string()),
  provisionalJudgment: z.string().min(1),
  alternativeHypotheses: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  proposedActions: z.array(z.string()),
  recommendedObservations: z.array(z.string()),
  impactMeasures: z.array(z.string()),
  evidenceQuality: z.object({
    directness: z.enum(['low', 'medium', 'high']),
    triangulated: z.boolean(),
    notes: z.string().optional(),
  }),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceCount: z.number().int().nonnegative(),
  status: z.literal('proposed'),
  createdAt: z.string().datetime(),
})

export const judgmentReviewViewSchema = z.object({
  evidence: z.array(evidenceReferenceViewSchema),
  facts: z.array(observationFactViewSchema),
  claims: z.array(claimViewSchema),
  proposal: diagnosisProposalViewSchema,
})

const reviewDecisions = ['accepted', 'modified', 'rejected', 'needs_more_evidence'] as const

export const reviewDecisionSchema = z.enum(reviewDecisions)

export const reviewDiagnosisInputSchema = z
  .object({
    schoolId: schoolIdSchema,
    diagnosisId: z.string().min(1),
    decision: reviewDecisionSchema,
    feedback: z.string().trim().max(4000).optional(),
    finalText: z.string().trim().max(12000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'modified' && !value.finalText) {
      ctx.addIssue({
        code: 'custom',
        path: ['finalText'],
        message: '请写下你确认后的判断',
      })
    }
  })

export const acceptedJudgmentViewSchema = z.object({
  id: z.string().min(1),
  proposalId: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().datetime(),
})

export const reviewOutcomeViewSchema = z.object({
  decision: reviewDecisionSchema,
  acceptedJudgment: acceptedJudgmentViewSchema.nullable(),
})

export const acceptedJudgmentListSchema = z.array(acceptedJudgmentViewSchema)

export type SubmitSituationInput = z.infer<typeof submitSituationInputSchema>
export type JudgmentReviewView = z.infer<typeof judgmentReviewViewSchema>
export type ReviewDiagnosisInput = z.infer<typeof reviewDiagnosisInputSchema>
export type ReviewOutcomeView = z.infer<typeof reviewOutcomeViewSchema>
export type AcceptedJudgmentView = z.infer<typeof acceptedJudgmentViewSchema>

export const judgmentIpcChannels = {
  submitSituation: 'judgments:submit-situation',
  review: 'judgments:review',
  listAccepted: 'judgments:list-accepted',
} as const
