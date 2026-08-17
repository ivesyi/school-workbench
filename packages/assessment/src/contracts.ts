import type { DeepReadonly } from '@school-workbench/methodology'
import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(200)
const shortTextSchema = z.string().trim().min(1).max(1000)
const longTextSchema = z.string().trim().min(1).max(20000)

export const assessmentProtocolVersion = 1 as const

export const schoolScopeSchema = z
  .object({
    kind: z.literal('school'),
    schoolId: idSchema,
  })
  .strict()

export const activeStageSchema = z
  .object({
    id: idSchema,
    schoolId: idSchema,
    title: shortTextSchema,
    status: z.literal('active'),
  })
  .strict()

export const confirmedStageTargetSchema = z
  .object({
    id: idSchema,
    stageId: idSchema,
    schoolId: idSchema,
    dimensionKey: z.enum(['leadership', 'key_tasks', 'structure', 'culture', 'capability']),
    title: shortTextSchema,
    description: longTextSchema,
    status: z.literal('confirmed'),
  })
  .strict()

export const assessmentEvidenceSchema = z
  .object({
    kind: z.literal('evidence'),
    id: idSchema,
    schoolId: idSchema,
    sourceType: z.enum([
      'feishu_doc',
      'feishu_minutes',
      'audio',
      'local_file',
      'observation',
      'pasted_text',
      'other',
    ]),
    title: shortTextSchema,
    uri: z.string().trim().min(1).max(4000).nullable(),
    inlineText: longTextSchema.nullable(),
    locator: z.string().trim().min(1).max(4000).nullable(),
    capturedAt: z.string().trim().min(1).nullable(),
  })
  .strict()

export const assessmentObservationFactSchema = z
  .object({
    kind: z.literal('observation_fact'),
    id: idSchema,
    schoolId: idSchema,
    evidenceId: idSchema,
    factType: z.enum(['learner', 'adult_practice', 'organization', 'context']),
    text: longTextSchema,
    locator: z.string().trim().min(1).max(4000),
    directness: z.enum(['low', 'medium', 'high']),
  })
  .strict()

export const assessmentClaimSchema = z
  .object({
    kind: z.literal('claim'),
    id: idSchema,
    schoolId: idSchema,
    statement: longTextSchema,
    predicateKey: idSchema,
    scope: schoolScopeSchema,
  })
  .strict()

export const assessmentClaimFactSchema = z
  .object({
    claimId: idSchema,
    factId: idSchema,
    stance: z.enum(['supporting', 'counter']),
  })
  .strict()

export const methodologyCriterionRefSchema = z
  .object({
    packKey: idSchema,
    version: idSchema,
    criterionId: idSchema,
  })
  .strict()

export const assessmentInputSchema = z
  .object({
    protocolVersion: z.literal(assessmentProtocolVersion),
    school: schoolScopeSchema,
    activeStage: activeStageSchema,
    confirmedStageTargets: z.array(confirmedStageTargetSchema).min(1),
    evidence: z.array(assessmentEvidenceSchema),
    observationFacts: z.array(assessmentObservationFactSchema),
    claims: z.array(assessmentClaimSchema),
    claimFacts: z.array(assessmentClaimFactSchema),
    methodologyContext: z.array(methodologyCriterionRefSchema),
  })
  .strict()

export const criterionMappingSchema = z
  .object({
    packKey: idSchema,
    version: idSchema,
    criterionId: idSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

export const counterEvidenceSearchSchema = z
  .object({
    completed: z.boolean(),
    summary: z.string().trim().min(1).max(700),
    searchedEvidenceRefs: z.array(idSchema),
    searchedFactRefs: z.array(idSchema),
  })
  .strict()

export const assessmentInterpretationSchema = z
  .object({
    kind: z.literal('interpretation'),
    id: idSchema,
    summary: z.string().trim().min(1).max(700),
    factRefs: z.array(idSchema),
  })
  .strict()

export const assessmentEvidenceQualitySchema = z
  .object({
    directness: z.enum(['low', 'medium', 'high']),
    triangulation: z.enum(['single_source', 'multiple_sources']),
    limitations: z.array(z.string().trim().min(1).max(700)),
  })
  .strict()

export const assessmentCandidateSchema = z
  .object({
    protocolVersion: z.literal(assessmentProtocolVersion),
    school: schoolScopeSchema,
    criterionMappings: z.array(criterionMappingSchema),
    stageTargetRefs: z.array(idSchema),
    supportingFactRefs: z.array(idSchema),
    counterFactRefs: z.array(idSchema),
    counterEvidenceSearch: counterEvidenceSearchSchema,
    interpretations: z.array(assessmentInterpretationSchema),
    provisionalJudgment: z.string().trim().min(1).max(1000).nullable(),
    mechanism: z.string().trim().min(1).max(1000).nullable(),
    alternativeHypotheses: z.array(z.string().trim().min(1).max(700)),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(700)),
    recommendedActions: z.array(z.string().trim().min(1).max(700)),
    nextObservations: z.array(z.string().trim().min(1).max(700)),
    impactEvidencePlan: z.array(z.string().trim().min(1).max(700)),
    evidenceQuality: assessmentEvidenceQualitySchema,
    confidence: z.enum(['low', 'medium', 'high']),
    status: z.enum(['proposed', 'insufficient_evidence']),
  })
  .strict()

export type SchoolScope = DeepReadonly<z.infer<typeof schoolScopeSchema>>
export type ActiveStage = DeepReadonly<z.infer<typeof activeStageSchema>>
export type ConfirmedStageTarget = DeepReadonly<z.infer<typeof confirmedStageTargetSchema>>
export type AssessmentEvidence = DeepReadonly<z.infer<typeof assessmentEvidenceSchema>>
export type AssessmentObservationFact = DeepReadonly<
  z.infer<typeof assessmentObservationFactSchema>
>
export type AssessmentClaim = DeepReadonly<z.infer<typeof assessmentClaimSchema>>
export type AssessmentClaimFact = DeepReadonly<z.infer<typeof assessmentClaimFactSchema>>
export type MethodologyCriterionRef = DeepReadonly<z.infer<typeof methodologyCriterionRefSchema>>
export type AssessmentInput = DeepReadonly<z.infer<typeof assessmentInputSchema>>
export type CriterionMapping = DeepReadonly<z.infer<typeof criterionMappingSchema>>
export type CounterEvidenceSearch = DeepReadonly<z.infer<typeof counterEvidenceSearchSchema>>
export type AssessmentInterpretation = DeepReadonly<z.infer<typeof assessmentInterpretationSchema>>
export type AssessmentEvidenceQuality = DeepReadonly<
  z.infer<typeof assessmentEvidenceQualitySchema>
>
export type AssessmentCandidate = DeepReadonly<z.infer<typeof assessmentCandidateSchema>>
