import { z } from 'zod'

export const packLifecycleStatusSchema = z.enum(['draft', 'review', 'active', 'retired'])
export const packReviewVerdictSchema = z.enum(['usable', 'needs_revision'])
export const packReviewDecisionSchema = z.enum(['approved', 'changes_requested'])

export const packSourceLocatorViewSchema = z.object({
  label: z.string().min(1),
  chapter: z.string().nullable(),
  printedPages: z.string().nullable(),
  figure: z.string().nullable(),
})

export const packConstructViewSchema = z.object({
  stableKey: z.string().min(1),
  title: z.string().min(1),
  assessmentQuestion: z.string().min(1),
  sourceLocator: packSourceLocatorViewSchema,
})

export const packCriterionVerdictViewSchema = z.object({
  verdict: packReviewVerdictSchema,
  note: z.string().nullable(),
})

export const packCriterionReviewViewSchema = z.object({
  stableKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  constructTitle: z.string().min(1),
  assessmentQuestion: z.string().min(1),
  practiceType: z.string().nullable(),
  dimensionLabel: z.string().nullable(),
  appliesTo: z.array(z.string().min(1)),
  doesNotApplyTo: z.array(z.string().min(1)),
  applicabilityNotes: z.array(z.string().min(1)),
  supportingIndicators: z.array(z.string().min(1)),
  counterIndicators: z.array(z.string().min(1)),
  insufficientEvidence: z.array(z.string().min(1)),
  counterexampleChecks: z.array(z.string().min(1)),
  collectionPrinciples: z.array(z.string().min(1)),
  adjustmentConditions: z.array(z.string().min(1)),
  guardrails: z.array(z.string().min(1)),
  behaviorAnchorCount: z.number().int().nonnegative(),
  sourceLocator: packSourceLocatorViewSchema,
  gaps: z.array(z.string().min(1)),
  lastVerdict: packCriterionVerdictViewSchema.nullable(),
})

export const packReviewRecordViewSchema = z.object({
  decision: packReviewDecisionSchema,
  decisionLabel: z.string().min(1),
  decidedAt: z.string().datetime(),
  note: z.string().nullable(),
  usableCount: z.number().int().nonnegative(),
  needsRevisionCount: z.number().int().nonnegative(),
  outdated: z.boolean(),
})

export const packReviewTechnicalViewSchema = z.object({
  packId: z.string().min(1),
  sourceRef: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  contentHash: z.string().min(1),
  fileStatus: packLifecycleStatusSchema,
  storedStatus: packLifecycleStatusSchema.nullable(),
  reviewedContentHash: z.string().min(1).nullable(),
})

export const packReviewViewSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  status: packLifecycleStatusSchema,
  statusLabel: z.string().min(1),
  statusDetail: z.string().min(1),
  inUse: z.boolean(),
  sourceLabel: z.string().min(1),
  constructs: z.array(packConstructViewSchema),
  criteria: z.array(packCriterionReviewViewSchema).min(1),
  packGuardrails: z.array(z.string().min(1)),
  behaviorAnchorCount: z.number().int().nonnegative(),
  review: packReviewRecordViewSchema.nullable(),
  technical: packReviewTechnicalViewSchema,
})

export const packReviewWorkbenchViewSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('unavailable'),
    message: z.string().min(1),
    detail: z.string().nullable(),
  }),
  z.object({
    state: z.literal('ready'),
    packs: z.array(packReviewViewSchema),
  }),
])

export const signOffPackInputSchema = z.object({
  packKey: z.string().min(1),
  packVersion: z.string().min(1),
  note: z.string().trim().max(4000).nullable(),
  verdicts: z
    .array(
      z.object({
        criterionStableKey: z.string().min(1),
        verdict: packReviewVerdictSchema,
        note: z.string().trim().max(2000).nullable(),
      }),
    )
    .min(1),
})

export const methodologyIpcChannels = {
  getReviewWorkbench: 'methodology:get-review-workbench',
  signOff: 'methodology:sign-off',
} as const

export type PackLifecycleStatus = z.infer<typeof packLifecycleStatusSchema>
export type PackReviewVerdictValue = z.infer<typeof packReviewVerdictSchema>
export type PackConstructView = z.infer<typeof packConstructViewSchema>
export type PackCriterionReviewView = z.infer<typeof packCriterionReviewViewSchema>
export type PackReviewView = z.infer<typeof packReviewViewSchema>
export type PackReviewWorkbenchView = z.infer<typeof packReviewWorkbenchViewSchema>
export type SignOffPackInput = z.infer<typeof signOffPackInputSchema>
