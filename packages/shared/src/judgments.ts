import { z } from 'zod'
import { schoolIdSchema } from './schools'
import { stageDimensionKeySchema } from './stages'

export const evidenceReferenceViewSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceType: z.string().min(1),
  /** Plain-language name of where this came from, e.g. 「飞书文档」. */
  sourceLabel: z.string().min(1),
  /** A locatable original, when the source has one. */
  uri: z.string().min(1).nullable(),
  /** The material itself, when it was pasted rather than linked. */
  excerpt: z.string().min(1).nullable(),
})

export const observationFactViewSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  directness: z.enum(['low', 'medium', 'high']),
  /** Which registered piece of material this fact was read off. */
  evidenceId: z.string().min(1),
})

export const claimViewSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
})

/**
 * The methodology criterion a judgement was made against.
 *
 * PRD 5.7 requires every judgement to be traceable to the standard it rests on,
 * and SPEC freezes that standard as a versioned Pack criterion. Showing the
 * version is the point: a judgement made under `data-wise@3` must not silently
 * read as if it were made under a later revision.
 */
export const judgmentCriterionViewSchema = z.object({
  id: z.string().min(1),
  stableKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  packTitle: z.string().min(1),
  packVersion: z.string().min(1),
})

export const judgmentStageTargetViewSchema = z.object({
  id: z.string().min(1),
  dimensionKey: stageDimensionKeySchema,
  label: z.string().min(1),
  text: z.string().min(1),
})

/**
 * Where this judgement is anchored: which school, which confirmed stage target
 * it speaks to, and which versioned criteria it was measured against.
 */
export const judgmentGroundingViewSchema = z.object({
  schoolName: z.string().min(1),
  stageTitle: z.string().min(1),
  stageTargets: z.array(judgmentStageTargetViewSchema),
  criteria: z.array(judgmentCriterionViewSchema),
})

export const diagnosisProposalViewSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  interpretations: z.array(z.string()),
  provisionalJudgment: z.string().min(1),
  /** PRD 18「我认为背后的机制」. Absent when the assistant did not name one. */
  mechanism: z.string().min(1).nullable(),
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

/**
 * Who produced this pending judgement.
 *
 * Only an assistant can, today: the workbench has no path of its own that
 * creates a judgement. The field stays so the review surface can say so out
 * loud rather than letting the consultant assume.
 */
export const judgmentSourceSchema = z.enum(['assistant'])

export const judgmentReviewViewSchema = z.object({
  evidence: z.array(evidenceReferenceViewSchema),
  facts: z.array(observationFactViewSchema),
  /** Facts that point the other way. PRD 17 shows these next to the judgement. */
  counterFacts: z.array(observationFactViewSchema).default([]),
  claims: z.array(claimViewSchema),
  grounding: judgmentGroundingViewSchema,
  proposal: diagnosisProposalViewSchema,
  source: judgmentSourceSchema.default('assistant'),
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

/** Same review-view shape the consultant already sees, just more than one. */
export const judgmentReviewListSchema = z.array(judgmentReviewViewSchema)

export type JudgmentSource = z.infer<typeof judgmentSourceSchema>
export type EvidenceReferenceView = z.infer<typeof evidenceReferenceViewSchema>
export type JudgmentCriterionView = z.infer<typeof judgmentCriterionViewSchema>
export type JudgmentStageTargetView = z.infer<typeof judgmentStageTargetViewSchema>
export type JudgmentGroundingView = z.infer<typeof judgmentGroundingViewSchema>
export type JudgmentReviewView = z.infer<typeof judgmentReviewViewSchema>
export type ReviewDiagnosisInput = z.infer<typeof reviewDiagnosisInputSchema>
export type ReviewOutcomeView = z.infer<typeof reviewOutcomeViewSchema>
export type AcceptedJudgmentView = z.infer<typeof acceptedJudgmentViewSchema>

/**
 * The renderer can review a judgement, list ones still waiting, and list ones
 * already accepted. There is deliberately no channel that creates one: a
 * judgement can only enter the workbench through the assessment contract an
 * assistant submits against. `listPending` is a read of rows that already
 * exist.
 */
export const judgmentIpcChannels = {
  review: 'judgments:review',
  listPending: 'judgments:list-pending',
  listAccepted: 'judgments:list-accepted',
} as const
