import {
  deepFreeze,
  type MethodologyRegistry,
  type ResolvedCriterion,
} from '@school-workbench/methodology'
import {
  assessmentInputSchema,
  type AssessmentInput,
  type MethodologyCriterionRef,
} from './contracts'
import {
  findHiddenReasoningField,
  findNumericScoringField,
  protocolError,
  type AssessmentProtocolError,
} from './errors'

export type ResolvedMethodologyContext = Readonly<{
  ref: MethodologyCriterionRef
  resolvedCriterion: ResolvedCriterion
}>

export type AssessmentContext = Readonly<{
  input: AssessmentInput
  resolvedMethodology: readonly ResolvedMethodologyContext[]
}>

export type AssessmentContextBuildResult =
  | Readonly<{ ok: true; context: AssessmentContext }>
  | Readonly<{ ok: false; errors: readonly AssessmentProtocolError[] }>

type DuplicateEntry = Readonly<{
  key: string
  path: string
  label: string
}>

function refKey(ref: MethodologyCriterionRef): string {
  return `${ref.packKey}@${ref.version}#${ref.criterionId}`
}

function uniqueErrors(errors: readonly AssessmentProtocolError[]): AssessmentProtocolError[] {
  const seen = new Set<string>()
  return errors.filter((error) => {
    const key = `${error.code}:${error.path}:${error.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function addDuplicateErrors(
  errors: AssessmentProtocolError[],
  entries: readonly DuplicateEntry[],
  code: 'ASSESSMENT_DUPLICATE_ID' | 'ASSESSMENT_DUPLICATE_REF',
): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      errors.push(protocolError(code, entry.path, `${entry.label} must be unique within AssessmentInput.`))
      continue
    }
    seen.add(entry.key)
  }
}

function rawFactsContainInterpretation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const observationFacts = Reflect.get(value, 'observationFacts')
  if (!Array.isArray(observationFacts)) return false
  return observationFacts.some(
    (fact) =>
      Boolean(fact) &&
      typeof fact === 'object' &&
      !Array.isArray(fact) &&
      Reflect.get(fact, 'kind') === 'interpretation',
  )
}

function parseInput(rawInput: unknown): AssessmentContextBuildResult | AssessmentInput {
  const numericField = findNumericScoringField(rawInput)
  if (numericField) {
    return deepFreeze({
      ok: false,
      errors: [
        protocolError(
          'ASSESSMENT_NUMERIC_SCORING_FORBIDDEN',
          numericField,
          'Assessment contracts do not accept numeric scoring, weighting or ranking fields.',
        ),
      ],
    })
  }

  const reasoningField = findHiddenReasoningField(rawInput)
  if (reasoningField) {
    return deepFreeze({
      ok: false,
      errors: [
        protocolError(
          'ASSESSMENT_HIDDEN_REASONING_FORBIDDEN',
          reasoningField,
          'Assessment contracts store concise reasons and references, not hidden reasoning traces.',
        ),
      ],
    })
  }

  if (rawFactsContainInterpretation(rawInput)) {
    return deepFreeze({
      ok: false,
      errors: [
        protocolError(
          'ASSESSMENT_FACT_INTERPRETATION_CONFUSION',
          '$.observationFacts',
          'Interpretations cannot be supplied as ObservationFacts.',
        ),
      ],
    })
  }

  const parsed = assessmentInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return deepFreeze({
      ok: false,
      errors: [
        protocolError(
          'ASSESSMENT_INVALID_INPUT',
          '$',
          'AssessmentInput failed the strict protocol schema.',
        ),
      ],
    })
  }

  return deepFreeze(parsed.data) as AssessmentInput
}

export function buildAssessmentContext(
  rawInput: unknown,
  registry: MethodologyRegistry,
): AssessmentContextBuildResult {
  const parsed = parseInput(rawInput)
  if ('ok' in parsed) return parsed

  const input = parsed
  const errors: AssessmentProtocolError[] = []
  const schoolId = input.school.schoolId

  addDuplicateErrors(
    errors,
    input.confirmedStageTargets.map((target, index) => ({
      key: target.id,
      path: `$.confirmedStageTargets[${index}].id`,
      label: 'StageTarget id',
    })),
    'ASSESSMENT_DUPLICATE_ID',
  )
  addDuplicateErrors(
    errors,
    input.evidence.map((evidence, index) => ({
      key: evidence.id,
      path: `$.evidence[${index}].id`,
      label: 'Evidence id',
    })),
    'ASSESSMENT_DUPLICATE_ID',
  )
  addDuplicateErrors(
    errors,
    input.observationFacts.map((fact, index) => ({
      key: fact.id,
      path: `$.observationFacts[${index}].id`,
      label: 'ObservationFact id',
    })),
    'ASSESSMENT_DUPLICATE_ID',
  )
  addDuplicateErrors(
    errors,
    input.claims.map((claim, index) => ({
      key: claim.id,
      path: `$.claims[${index}].id`,
      label: 'Claim id',
    })),
    'ASSESSMENT_DUPLICATE_ID',
  )
  addDuplicateErrors(
    errors,
    input.claimFacts.map((link, index) => ({
      key: `${link.claimId}\u0000${link.factId}\u0000${link.stance}`,
      path: `$.claimFacts[${index}]`,
      label: 'ClaimFact claimId+factId+stance tuple',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )

  if (input.activeStage.schoolId !== schoolId) {
    errors.push(
      protocolError(
        'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
        '$.activeStage.schoolId',
        'The active Stage must belong to the assessment school.',
      ),
    )
  }

  for (const [index, target] of input.confirmedStageTargets.entries()) {
    if (target.schoolId !== schoolId) {
      errors.push(
        protocolError(
          'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
          `$.confirmedStageTargets[${index}].schoolId`,
          'StageTarget school scope does not match the assessment school.',
        ),
      )
    }
    if (target.stageId !== input.activeStage.id) {
      errors.push(
        protocolError(
          'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
          `$.confirmedStageTargets[${index}].stageId`,
          'StageTarget must belong to the current active Stage.',
        ),
      )
    }
  }

  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]))
  for (const [index, evidence] of input.evidence.entries()) {
    if (evidence.schoolId !== schoolId) {
      errors.push(
        protocolError(
          'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
          `$.evidence[${index}].schoolId`,
          'Evidence school scope does not match the assessment school.',
        ),
      )
    }
  }

  const factsById = new Map(input.observationFacts.map((fact) => [fact.id, fact]))
  for (const [index, fact] of input.observationFacts.entries()) {
    if (fact.schoolId !== schoolId) {
      errors.push(
        protocolError(
          'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
          `$.observationFacts[${index}].schoolId`,
          'ObservationFact school scope does not match the assessment school.',
        ),
      )
    }
    if (!evidenceById.has(fact.evidenceId)) {
      errors.push(
        protocolError(
          'ASSESSMENT_EVIDENCE_REF_DANGLING',
          `$.observationFacts[${index}].evidenceId`,
          'ObservationFact references Evidence that is not present in AssessmentInput.',
        ),
      )
    }
  }

  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]))
  for (const [index, claim] of input.claims.entries()) {
    if (claim.schoolId !== schoolId || claim.scope.schoolId !== schoolId) {
      errors.push(
        protocolError(
          'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
          `$.claims[${index}]`,
          'Claim school scope does not match the assessment school.',
        ),
      )
    }
  }

  for (const [index, link] of input.claimFacts.entries()) {
    if (!claimsById.has(link.claimId)) {
      errors.push(
        protocolError(
          'ASSESSMENT_CLAIM_REF_DANGLING',
          `$.claimFacts[${index}].claimId`,
          'ClaimFact references a Claim that is not present in AssessmentInput.',
        ),
      )
    }
    if (!factsById.has(link.factId)) {
      errors.push(
        protocolError(
          'ASSESSMENT_FACT_REF_DANGLING',
          `$.claimFacts[${index}].factId`,
          'ClaimFact references an ObservationFact that is not present in AssessmentInput.',
        ),
      )
    }
  }

  const contextKeys = new Set<string>()
  const resolvedMethodology: ResolvedMethodologyContext[] = []
  for (const [index, ref] of input.methodologyContext.entries()) {
    const key = refKey(ref)
    if (contextKeys.has(key)) {
      errors.push(
        protocolError(
          'ASSESSMENT_METHODOLOGY_CONTEXT_DUPLICATE',
          `$.methodologyContext[${index}]`,
          'Methodology context must not contain duplicate criterion references.',
        ),
      )
      continue
    }
    contextKeys.add(key)

    const pack = registry.getPack(ref.packKey, ref.version)
    if (!pack) {
      errors.push(
        protocolError(
          'ASSESSMENT_METHODOLOGY_PACK_NOT_FOUND',
          `$.methodologyContext[${index}]`,
          `Methodology pack ${ref.packKey}@${ref.version} is not loaded.`,
        ),
      )
      continue
    }
    if (pack.status !== 'active') {
      errors.push(
        protocolError(
          'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
          `$.methodologyContext[${index}]`,
          `Methodology pack ${ref.packKey}@${ref.version} is not active.`,
        ),
      )
      continue
    }

    const resolvedCriterion = registry.getCriterion(ref.criterionId, {
      packKey: ref.packKey,
      version: ref.version,
    })
    if (!resolvedCriterion) {
      errors.push(
        protocolError(
          'ASSESSMENT_METHODOLOGY_CRITERION_NOT_FOUND',
          `$.methodologyContext[${index}].criterionId`,
          `Criterion ${ref.criterionId} does not exist in ${ref.packKey}@${ref.version}.`,
        ),
      )
      continue
    }

    resolvedMethodology.push(deepFreeze({ ref, resolvedCriterion }))
  }

  if (errors.length > 0) {
    return deepFreeze({ ok: false, errors: uniqueErrors(errors) })
  }

  return deepFreeze({
    ok: true,
    context: {
      input,
      resolvedMethodology,
    },
  })
}
