import { z } from 'zod'

export const canonicalDimensionKeys = [
  'leadership',
  'key_tasks',
  'structure',
  'culture',
  'capability',
] as const

export type CanonicalDimensionKey = (typeof canonicalDimensionKeys)[number]

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T

const sha256Schema = z
  .object({
    algorithm: z.literal('sha256'),
    value: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const sourceLocatorSchema = z
  .object({
    label: z.string().trim().min(1),
    chapter: z.string().trim().min(1).optional(),
    printedPages: z.string().trim().min(1).optional(),
    figure: z.string().trim().min(1).optional(),
  })
  .strict()

export const applicabilitySchema = z
  .object({
    appliesTo: z.array(z.string().trim().min(1)).min(1),
    doesNotApplyTo: z.array(z.string().trim().min(1)).min(1),
    notes: z.array(z.string().trim().min(1)).optional(),
  })
  .strict()

export const constructSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    assessmentQuestion: z.string().trim().min(1),
    parentId: z.string().trim().min(1).optional(),
    sourceLocator: sourceLocatorSchema,
  })
  .strict()

export const criterionSchema = z
  .object({
    id: z.string().trim().min(1),
    constructId: z.string().trim().min(1),
    parentId: z.string().trim().min(1).optional(),
    dimensionKey: z.enum(canonicalDimensionKeys).nullable(),
    practiceType: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    applicability: applicabilitySchema,
    sourceLocator: sourceLocatorSchema,
  })
  .strict()

export const behaviorAnchorSchema = z
  .object({
    id: z.string().trim().min(1),
    criterionId: z.string().trim().min(1),
    levelKey: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
    sourceLocator: sourceLocatorSchema,
  })
  .strict()

export const evidenceGuidanceSchema = z
  .object({
    criterionId: z.string().trim().min(1),
    supportingIndicators: z.array(z.string().trim().min(1)),
    counterIndicators: z.array(z.string().trim().min(1)),
    insufficientEvidence: z.array(z.string().trim().min(1)),
    counterexampleChecks: z.array(z.string().trim().min(1)),
    collectionPrinciples: z.array(z.string().trim().min(1)),
    adjustmentConditions: z.array(z.string().trim().min(1)),
  })
  .strict()

export const inferenceGuardrailSchema = z
  .object({
    scope: z.enum(['pack', 'criterion']),
    criterionId: z.string().trim().min(1).optional(),
    statement: z.string().trim().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'criterion' && !value.criterionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['criterionId'],
        message: 'criterion-scoped guardrail requires criterionId',
      })
    }
    if (value.scope === 'pack' && value.criterionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['criterionId'],
        message: 'pack-scoped guardrail must not set criterionId',
      })
    }
  })

export const persistenceEvidenceGuidanceSchema = evidenceGuidanceSchema.omit({
  criterionId: true,
  counterIndicators: true,
})

export const criterionGuardrailEnvelopeSchema = z
  .object({
    applicability: applicabilitySchema,
    inferenceGuardrails: z.array(inferenceGuardrailSchema),
  })
  .strict()

export const counterIndicatorsSchema = z.array(z.string().trim().min(1))

export const methodologyPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1),
    key: z.string().trim().min(1),
    version: z.string().trim().min(1),
    title: z.string().trim().min(1),
    status: z.enum(['draft', 'review', 'active', 'retired']),
    sourceType: z.enum(['book', 'framework', 'standard']),
    sourceRef: z.string().trim().regex(/^references\//),
    sourceFingerprint: sha256Schema,
    constructs: z.array(constructSchema),
    criteria: z.array(criterionSchema),
    behaviorAnchors: z.array(behaviorAnchorSchema),
    evidenceGuidance: z.array(evidenceGuidanceSchema),
    inferenceGuardrails: z.array(inferenceGuardrailSchema),
    canonicalContentHash: sha256Schema,
  })
  .strict()

export type SourceLocator = DeepReadonly<z.infer<typeof sourceLocatorSchema>>
export type Applicability = DeepReadonly<z.infer<typeof applicabilitySchema>>
export type Construct = DeepReadonly<z.infer<typeof constructSchema>>
export type Criterion = DeepReadonly<z.infer<typeof criterionSchema>>
export type BehaviorAnchor = DeepReadonly<z.infer<typeof behaviorAnchorSchema>>
export type EvidenceGuidance = DeepReadonly<z.infer<typeof evidenceGuidanceSchema>>
export type InferenceGuardrail = DeepReadonly<z.infer<typeof inferenceGuardrailSchema>>
export type MethodologyPack = DeepReadonly<z.infer<typeof methodologyPackSchema>>
export type MethodologyPackStatus = MethodologyPack['status']
export type PersistenceEvidenceGuidance = DeepReadonly<z.infer<typeof persistenceEvidenceGuidanceSchema>>
export type CriterionGuardrailEnvelope = DeepReadonly<z.infer<typeof criterionGuardrailEnvelopeSchema>>

export type ResolvedCriterion = DeepReadonly<{
  criterion: Criterion
  evidenceGuidance: EvidenceGuidance
  inferenceGuardrails: InferenceGuardrail[]
}>

export type MethodologyPackProjection = DeepReadonly<{
  id: string
  key: string
  version: string
  title: string
  status: MethodologyPackStatus
  sourceType: MethodologyPack['sourceType']
  sourceRef: string
  sourceFingerprint: string
  contentHash: string
  criteria: Array<{
    id: string
    stableKey: string
    parentStableKey: string | null
    constructKey: string
    dimensionKey: CanonicalDimensionKey | null
    practiceType: string | null
    title: string
    description: string
    applicability: Applicability
    evidenceGuidance: PersistenceEvidenceGuidance
    counterIndicators: readonly string[]
    guardrails: readonly InferenceGuardrail[]
    sourceLocator: SourceLocator
    sequence: number
  }>
  behaviorAnchors: Array<{
    id: string
    stableKey: string
    criterionStableKey: string
    levelKey: string
    label: string
    description: string
    sourceLocator: SourceLocator
    sequence: number
  }>
}>
