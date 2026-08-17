import { assessmentCandidateSchema } from '@school-workbench/assessment'
import { z } from 'zod'

/**
 * Write plane contracts.
 *
 * Two rules shape everything here:
 *
 *  - The Agent never supplies an `AssessmentInput`. It registers the grounds it
 *    actually used, and the Workbench assembles the Input from SQLite. An Agent
 *    that could hand over its own Input could invent Evidence and still pass
 *    every check (SPEC 24.1 requires the Input to be *verifiable*).
 *  - `diagnosis_propose` carries the frozen `AssessmentCandidate` itself. Its
 *    schema is derived from `assessmentCandidateSchema` rather than restated,
 *    so a second, looser DTO cannot drift into existence (SPEC 24).
 */

const idSchema = z.string().trim().min(1).max(200)
const shortTextSchema = z.string().trim().min(1).max(1000)
const longTextSchema = z.string().trim().min(1).max(20000)
const locatorSchema = z.string().trim().min(1).max(4000)

/** Local handles the Agent uses to wire facts to claims inside one call. */
const localRefSchema = z.string().trim().min(1).max(120)

export const evidenceSourceTypes = [
  'feishu_doc',
  'feishu_minutes',
  'audio',
  'local_file',
  'observation',
  'pasted_text',
  'other',
] as const

export const factTypes = ['learner', 'adult_practice', 'organization', 'context'] as const

export const factStances = ['supporting', 'counter'] as const

/**
 * One thing the Agent read off the material.
 *
 * SPEC 74 puts "Observation Fact extraction" immediately after "Evidence
 * acquisition", and `observation_facts.extracted_by` exists precisely so an
 * Agent can be recorded as the extractor. A fact is a plain observation with a
 * locator; anything interpretive belongs in the candidate instead, and the
 * assessment contracts reject an interpretation supplied as a fact.
 */
export const registerObservationFactSchema = z
  .object({
    ref: localRefSchema,
    factType: z.enum(factTypes),
    text: longTextSchema,
    locator: locatorSchema,
    directness: z.enum(['low', 'medium', 'high']),
  })
  .strict()

/** A fact this claim rests on, either registered in this call or already stored. */
export const registerClaimFactSchema = z
  .object({
    factRef: localRefSchema.optional(),
    factId: idSchema.optional(),
    stance: z.enum(factStances),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.factRef && !value.factId) {
      ctx.addIssue({ code: 'custom', message: 'Provide either factRef or factId' })
    }
    if (value.factRef && value.factId) {
      ctx.addIssue({ code: 'custom', message: 'Provide factRef or factId, not both' })
    }
  })

/**
 * An assertion the facts support or contradict.
 *
 * Claims are registered with the grounds rather than with the proposal so that
 * a rejected candidate writes nothing: the Agent can correct and resubmit
 * `diagnosis_propose` any number of times without multiplying rows.
 */
export const registerClaimSchema = z
  .object({
    ref: localRefSchema,
    statement: longTextSchema,
    predicateKey: idSchema.default('swb:claim.agent_assertion'),
    facts: z.array(registerClaimFactSchema).min(1).max(50),
  })
  .strict()

export const evidenceRegisterInputSchema = z
  .object({
    schoolId: idSchema.optional(),
    sourceType: z.enum(evidenceSourceTypes),
    title: shortTextSchema,
    uri: z.string().trim().min(1).max(4000).nullish(),
    inlineText: longTextSchema.nullish(),
    locator: locatorSchema.nullish(),
    capturedAt: z.string().trim().min(1).max(64).nullish(),
    observationFacts: z.array(registerObservationFactSchema).max(50).default([]),
    claims: z.array(registerClaimSchema).max(25).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.uri && !value.inlineText) {
      ctx.addIssue({
        code: 'custom',
        message: 'Evidence needs either a uri or the inline text it was read from',
      })
    }
    const factRefs = new Set<string>()
    for (const fact of value.observationFacts) {
      if (factRefs.has(fact.ref)) {
        ctx.addIssue({ code: 'custom', path: ['observationFacts'], message: 'duplicate fact ref' })
      }
      factRefs.add(fact.ref)
    }
    const claimRefs = new Set<string>()
    for (const claim of value.claims) {
      if (claimRefs.has(claim.ref)) {
        ctx.addIssue({ code: 'custom', path: ['claims'], message: 'duplicate claim ref' })
      }
      claimRefs.add(claim.ref)
      for (const link of claim.facts) {
        if (link.factRef && !factRefs.has(link.factRef)) {
          ctx.addIssue({
            code: 'custom',
            path: ['claims'],
            message: `claim references unknown factRef ${link.factRef}`,
          })
        }
      }
    }
  })

/**
 * The `AssessmentCandidate` minus its school scope.
 *
 * Derived, never restated: the school comes from the capability token, so the
 * Agent cannot choose it, and every other field stays exactly as
 * `packages/assessment` froze it.
 */
export const proposedCandidateSchema = assessmentCandidateSchema.omit({ school: true })

export const diagnosisProposeInputSchema = z
  .object({
    schoolId: idSchema.optional(),
    type: z.enum(['state', 'characteristic', 'mismatch', 'practice']),
    title: shortTextSchema,
    candidate: proposedCandidateSchema,
  })
  .strict()

export type EvidenceRegisterInput = z.infer<typeof evidenceRegisterInputSchema>
export type RegisterObservationFactInput = z.infer<typeof registerObservationFactSchema>
export type RegisterClaimInput = z.infer<typeof registerClaimSchema>
export type DiagnosisProposeInput = z.infer<typeof diagnosisProposeInputSchema>

export type RegisteredRef = Readonly<{
  /** The local handle the Agent used in this call. */
  ref: string
  /** The identifier the Workbench assigned, or the one it already had. */
  id: string
  /** True when an identical record already existed and was reused. */
  reused: boolean
}>

export type EvidenceRegistrationDto = Readonly<{
  evidenceId: string
  reused: boolean
  observationFacts: readonly RegisteredRef[]
  claims: readonly RegisteredRef[]
}>

export type DiagnosisProposalDto = Readonly<{
  proposalId: string
  status: 'proposed' | 'insufficient_evidence'
  claimIds: readonly string[]
  stageTargetIds: readonly string[]
  criteria: readonly Readonly<{
    criterionId: string
    packKey: string
    version: string
    stableKey: string
  }>[]
}>

export type RegisterEvidenceCommand = Readonly<{
  schoolId: string
  agentRunId: string
  input: EvidenceRegisterInput
}>

/**
 * Everything the write plane needs from persistence.
 *
 * `buildAssessmentInput` is the whole point of decision L2: it reads the school's
 * own rows back out of SQLite and returns them in `AssessmentInput` shape. The
 * Agent contributes nothing to it.
 */
export interface WritePlaneRepository {
  registerEvidence(command: RegisterEvidenceCommand): Promise<EvidenceRegistrationDto>
  buildAssessmentInput(schoolId: string): Promise<unknown>
}

/**
 * The existing grounded diagnosis pipeline, described structurally so this
 * package does not have to depend on the application layer.
 * `GroundedDiagnosisService` satisfies it as-is.
 */
export interface GroundedDiagnosisGateway {
  create(
    input: Readonly<{
      schoolId: string
      type: DiagnosisProposeInput['type']
      title: string
      rawAssessmentInput: unknown
      rawAssessmentCandidate: unknown
      agentRunId?: string | null
    }>,
  ): Promise<
    Readonly<{
      proposal: Readonly<{ id: string; status: 'proposed' | 'insufficient_evidence' }>
      claimIds: readonly string[]
      stageTargetIds: readonly string[]
      criteria: readonly Readonly<{
        criterionId: string
        packKey: string
        version: string
        stableKey: string
      }>[]
    }>
  >
}
