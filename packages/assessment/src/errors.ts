import { z } from 'zod'

export const assessmentErrorCodeValues = [
  'ASSESSMENT_INVALID_INPUT',
  'ASSESSMENT_INVALID_CANDIDATE',
  'ASSESSMENT_NUMERIC_SCORING_FORBIDDEN',
  'ASSESSMENT_HIDDEN_REASONING_FORBIDDEN',
  'ASSESSMENT_FACT_INTERPRETATION_CONFUSION',
  'ASSESSMENT_DUPLICATE_ID',
  'ASSESSMENT_DUPLICATE_REF',
  'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
  'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
  'ASSESSMENT_EVIDENCE_REF_DANGLING',
  'ASSESSMENT_FACT_REF_DANGLING',
  'ASSESSMENT_CLAIM_REF_DANGLING',
  'ASSESSMENT_METHODOLOGY_PACK_NOT_FOUND',
  'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
  'ASSESSMENT_METHODOLOGY_CRITERION_NOT_FOUND',
  'ASSESSMENT_METHODOLOGY_CONTEXT_DUPLICATE',
  'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
  'ASSESSMENT_CRITERION_MAPPING_DUPLICATE',
  'ASSESSMENT_PROPOSED_CLAIM_REQUIRED',
  'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
  'ASSESSMENT_PROPOSED_STAGE_TARGET_REQUIRED',
  'ASSESSMENT_PROPOSED_SUPPORTING_FACT_REQUIRED',
  'ASSESSMENT_PROVISIONAL_JUDGMENT_REQUIRED',
  'ASSESSMENT_COUNTER_SEARCH_REQUIRED',
  'ASSESSMENT_COUNTER_SEARCH_AUDIT_REFS_REQUIRED',
  'ASSESSMENT_ALTERNATIVE_HYPOTHESIS_REQUIRED',
  'ASSESSMENT_COUNTER_FACT_OMITTED',
  'ASSESSMENT_FACT_STANCE_MISMATCH',
  'ASSESSMENT_ABSTENTION_REQUIRED',
  'ASSESSMENT_ABSTENTION_JUDGMENT_MUST_BE_NULL',
  'ASSESSMENT_ABSTENTION_DETAILS_REQUIRED',
  'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
  'ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH',
  'ASSESSMENT_PROPOSAL_ID_CONFLICT',
  'ASSESSMENT_RUNTIME_ADAPTER_ERROR',
] as const

export const assessmentErrorCodeSchema = z.enum(assessmentErrorCodeValues)
export type AssessmentErrorCode = (typeof assessmentErrorCodeValues)[number]

export const assessmentProtocolErrorSchema = z
  .object({
    code: assessmentErrorCodeSchema,
    path: z.string().trim().min(1),
    message: z.string().trim().min(1),
  })
  .strict()

export type AssessmentProtocolError = Readonly<z.infer<typeof assessmentProtocolErrorSchema>>

export function protocolError(
  code: AssessmentErrorCode,
  path: string,
  message: string,
): AssessmentProtocolError {
  return { code, path, message }
}

const numericScoringKeys = new Set([
  'score',
  'scores',
  'weight',
  'weights',
  'rating',
  'ratings',
  'rank',
  'ranking',
  'schoolrank',
  'compositescore',
  'overallscore',
  'numericscore',
  'numericalscore',
  'aggregatelevel',
  'overalllevel',
  'compositelevel',
])

const hiddenReasoningKeys = new Set([
  'chainofthought',
  'reasoningtrace',
  'hiddenreasoning',
  'scratchpad',
  'privatereasoning',
])

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase()
}

function firstForbiddenPath(
  value: unknown,
  forbidden: ReadonlySet<string>,
  path = '$',
): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = firstForbiddenPath(item, forbidden, `${path}[${index}]`)
      if (found) return found
    }
    return null
  }

  if (!value || typeof value !== 'object') return null

  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`
    if (forbidden.has(normalizeKey(key))) return nextPath
    const found = firstForbiddenPath(child, forbidden, nextPath)
    if (found) return found
  }

  return null
}

export function findNumericScoringField(value: unknown): string | null {
  return firstForbiddenPath(value, numericScoringKeys)
}

export function findHiddenReasoningField(value: unknown): string | null {
  return firstForbiddenPath(value, hiddenReasoningKeys)
}
