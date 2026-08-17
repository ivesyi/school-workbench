import { deepFreeze, type MethodologyRegistry } from '@school-workbench/methodology'
import { assessmentCandidateSchema, type AssessmentCandidate } from './contracts'
import { buildAssessmentContext, type AssessmentContext } from './context'
import {
  findHiddenReasoningField,
  findNumericScoringField,
  protocolError,
  type AssessmentProtocolError,
} from './errors'

export type AssessmentValidationResult =
  | Readonly<{
      ok: true
      input: AssessmentContext['input']
      candidate: AssessmentCandidate
      context: AssessmentContext
    }>
  | Readonly<{
      ok: false
      errors: readonly AssessmentProtocolError[]
    }>

type DuplicateEntry = Readonly<{
  key: string
  path: string
  label: string
}>

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
      errors.push(
        protocolError(code, entry.path, `${entry.label} must be unique within AssessmentCandidate.`),
      )
      continue
    }
    seen.add(entry.key)
  }
}

function parseCandidate(
  rawCandidate: unknown,
):
  | Readonly<{ ok: true; candidate: AssessmentCandidate }>
  | Readonly<{ ok: false; errors: readonly AssessmentProtocolError[] }> {
  const numericField = findNumericScoringField(rawCandidate)
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

  const reasoningField = findHiddenReasoningField(rawCandidate)
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

  const parsed = assessmentCandidateSchema.safeParse(rawCandidate)
  if (!parsed.success) {
    return deepFreeze({
      ok: false,
      errors: [
        protocolError(
          'ASSESSMENT_INVALID_CANDIDATE',
          '$',
          'AssessmentCandidate failed the strict protocol schema.',
        ),
      ],
    })
  }

  return deepFreeze({ ok: true, candidate: parsed.data as AssessmentCandidate })
}

function methodologyRefKey(ref: { packKey: string; version: string; criterionId: string }): string {
  return `${ref.packKey}@${ref.version}#${ref.criterionId}`
}

function addDanglingFactError(
  errors: AssessmentProtocolError[],
  factRef: string,
  path: string,
  factIds: ReadonlySet<string>,
  interpretationIds: ReadonlySet<string>,
): void {
  if (factIds.has(factRef)) return
  if (interpretationIds.has(factRef)) {
    errors.push(
      protocolError(
        'ASSESSMENT_FACT_INTERPRETATION_CONFUSION',
        path,
        'An interpretation id cannot be used where an ObservationFact ref is required.',
      ),
    )
    return
  }
  errors.push(
    protocolError(
      'ASSESSMENT_FACT_REF_DANGLING',
      path,
      `ObservationFact ref ${factRef} is not present in AssessmentInput.`,
    ),
  )
}

export function validateAssessmentCandidate(
  rawInput: unknown,
  rawCandidate: unknown,
  registry: MethodologyRegistry,
): AssessmentValidationResult {
  const contextResult = buildAssessmentContext(rawInput, registry)
  if (!contextResult.ok) return contextResult

  const candidateResult = parseCandidate(rawCandidate)
  if (!candidateResult.ok) return candidateResult

  const { context } = contextResult
  const { input } = context
  const { candidate } = candidateResult
  const errors: AssessmentProtocolError[] = []

  addDuplicateErrors(
    errors,
    candidate.claimRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.claimRefs[${index}]`,
      label: 'Claim ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.stageTargetRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.stageTargetRefs[${index}]`,
      label: 'StageTarget ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.supportingFactRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.supportingFactRefs[${index}]`,
      label: 'Supporting fact ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.counterFactRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.counterFactRefs[${index}]`,
      label: 'Counter fact ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.counterEvidenceSearch.searchedEvidenceRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.counterEvidenceSearch.searchedEvidenceRefs[${index}]`,
      label: 'Searched Evidence ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.counterEvidenceSearch.searchedFactRefs.map((ref, index) => ({
      key: ref,
      path: `$.candidate.counterEvidenceSearch.searchedFactRefs[${index}]`,
      label: 'Searched ObservationFact ref',
    })),
    'ASSESSMENT_DUPLICATE_REF',
  )
  addDuplicateErrors(
    errors,
    candidate.interpretations.map((interpretation, index) => ({
      key: interpretation.id,
      path: `$.candidate.interpretations[${index}].id`,
      label: 'Interpretation id',
    })),
    'ASSESSMENT_DUPLICATE_ID',
  )
  for (const [interpretationIndex, interpretation] of candidate.interpretations.entries()) {
    addDuplicateErrors(
      errors,
      interpretation.factRefs.map((ref, factIndex) => ({
        key: ref,
        path: `$.candidate.interpretations[${interpretationIndex}].factRefs[${factIndex}]`,
        label: 'Interpretation fact ref',
      })),
      'ASSESSMENT_DUPLICATE_REF',
    )
  }

  if (candidate.school.schoolId !== input.school.schoolId) {
    errors.push(
      protocolError(
        'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
        '$.candidate.school.schoolId',
        'Candidate school scope does not match AssessmentInput.',
      ),
    )
  }

  const claimIds = new Set(input.claims.map((claim) => claim.id))
  const selectedClaimIds = new Set<string>()
  for (const [index, claimRef] of candidate.claimRefs.entries()) {
    if (!claimIds.has(claimRef)) {
      errors.push(
        protocolError(
          'ASSESSMENT_CLAIM_REF_DANGLING',
          `$.candidate.claimRefs[${index}]`,
          `Claim ref ${claimRef} is not present in AssessmentInput.`,
        ),
      )
      continue
    }
    selectedClaimIds.add(claimRef)
  }

  const targetIds = new Set(input.confirmedStageTargets.map((target) => target.id))
  for (const [index, targetRef] of candidate.stageTargetRefs.entries()) {
    if (!targetIds.has(targetRef)) {
      errors.push(
        protocolError(
          'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
          `$.candidate.stageTargetRefs[${index}]`,
          `StageTarget ref ${targetRef} is not a confirmed target of the current active Stage.`,
        ),
      )
    }
  }

  const evidenceIds = new Set(input.evidence.map((item) => item.id))
  const factIds = new Set(input.observationFacts.map((fact) => fact.id))
  const interpretationIds = new Set(candidate.interpretations.map((item) => item.id))
  const selectedClaimFacts = input.claimFacts.filter((link) => selectedClaimIds.has(link.claimId))
  const selectedSupportingStanceFacts = new Set(
    selectedClaimFacts.filter((link) => link.stance === 'supporting').map((link) => link.factId),
  )
  const selectedCounterStanceFacts = new Set(
    selectedClaimFacts.filter((link) => link.stance === 'counter').map((link) => link.factId),
  )

  for (const [index, factRef] of candidate.supportingFactRefs.entries()) {
    addDanglingFactError(
      errors,
      factRef,
      `$.candidate.supportingFactRefs[${index}]`,
      factIds,
      interpretationIds,
    )
    if (factIds.has(factRef) && !selectedSupportingStanceFacts.has(factRef)) {
      errors.push(
        protocolError(
          'ASSESSMENT_FACT_STANCE_MISMATCH',
          `$.candidate.supportingFactRefs[${index}]`,
          `Fact ${factRef} is not linked with supporting stance to a selected Claim.`,
        ),
      )
    }
  }

  for (const [index, factRef] of candidate.counterFactRefs.entries()) {
    addDanglingFactError(
      errors,
      factRef,
      `$.candidate.counterFactRefs[${index}]`,
      factIds,
      interpretationIds,
    )
    if (factIds.has(factRef) && !selectedCounterStanceFacts.has(factRef)) {
      errors.push(
        protocolError(
          'ASSESSMENT_FACT_STANCE_MISMATCH',
          `$.candidate.counterFactRefs[${index}]`,
          `Fact ${factRef} is not linked with counter stance to a selected Claim.`,
        ),
      )
    }
  }

  for (const [index, evidenceRef] of candidate.counterEvidenceSearch.searchedEvidenceRefs.entries()) {
    if (!evidenceIds.has(evidenceRef)) {
      errors.push(
        protocolError(
          'ASSESSMENT_EVIDENCE_REF_DANGLING',
          `$.candidate.counterEvidenceSearch.searchedEvidenceRefs[${index}]`,
          `Evidence ref ${evidenceRef} is not present in AssessmentInput.`,
        ),
      )
    }
  }

  for (const [index, factRef] of candidate.counterEvidenceSearch.searchedFactRefs.entries()) {
    addDanglingFactError(
      errors,
      factRef,
      `$.candidate.counterEvidenceSearch.searchedFactRefs[${index}]`,
      factIds,
      interpretationIds,
    )
  }

  for (const [interpretationIndex, interpretation] of candidate.interpretations.entries()) {
    for (const [factIndex, factRef] of interpretation.factRefs.entries()) {
      addDanglingFactError(
        errors,
        factRef,
        `$.candidate.interpretations[${interpretationIndex}].factRefs[${factIndex}]`,
        factIds,
        interpretationIds,
      )
    }
  }

  const contextCriterionKeys = new Set(
    context.resolvedMethodology.map((item) => methodologyRefKey(item.ref)),
  )
  const mappingKeys = new Set<string>()
  for (const [index, mapping] of candidate.criterionMappings.entries()) {
    const key = methodologyRefKey(mapping)
    if (mappingKeys.has(key)) {
      errors.push(
        protocolError(
          'ASSESSMENT_CRITERION_MAPPING_DUPLICATE',
          `$.candidate.criterionMappings[${index}]`,
          'Candidate contains a duplicate criterion mapping.',
        ),
      )
      continue
    }
    mappingKeys.add(key)
    if (!contextCriterionKeys.has(key)) {
      errors.push(
        protocolError(
          'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
          `$.candidate.criterionMappings[${index}]`,
          `Criterion mapping ${key} is not an exact active criterion ref from AssessmentInput.`,
        ),
      )
    }
  }

  if (candidate.status === 'proposed') {
    if (context.resolvedMethodology.length === 0 || selectedSupportingStanceFacts.size === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_ABSTENTION_REQUIRED',
          '$.candidate.status',
          'Without an active criterion mapping context and supporting ClaimFact on a selected Claim, the candidate must abstain.',
        ),
      )
    }

    if (candidate.claimRefs.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_PROPOSED_CLAIM_REQUIRED',
          '$.candidate.claimRefs',
          'A proposed candidate requires at least one selected Claim ref.',
        ),
      )
    }

    if (candidate.criterionMappings.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
          '$.candidate.criterionMappings',
          'A proposed candidate requires at least one exact active Criterion mapping.',
        ),
      )
    }

    if (candidate.stageTargetRefs.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_PROPOSED_STAGE_TARGET_REQUIRED',
          '$.candidate.stageTargetRefs',
          'A proposed candidate requires at least one current confirmed StageTarget ref.',
        ),
      )
    }

    if (candidate.supportingFactRefs.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_PROPOSED_SUPPORTING_FACT_REQUIRED',
          '$.candidate.supportingFactRefs',
          'A proposed candidate requires at least one supporting ObservationFact ref.',
        ),
      )
    }

    if (!candidate.provisionalJudgment) {
      errors.push(
        protocolError(
          'ASSESSMENT_PROVISIONAL_JUDGMENT_REQUIRED',
          '$.candidate.provisionalJudgment',
          'A proposed candidate requires a provisional judgment.',
        ),
      )
    }

    if (!candidate.counterEvidenceSearch.completed) {
      errors.push(
        protocolError(
          'ASSESSMENT_COUNTER_SEARCH_REQUIRED',
          '$.candidate.counterEvidenceSearch.completed',
          'A proposed candidate must explicitly declare counter-evidence search complete.',
        ),
      )
    }

    if (
      candidate.counterEvidenceSearch.completed &&
      candidate.counterEvidenceSearch.searchedEvidenceRefs.length === 0 &&
      candidate.counterEvidenceSearch.searchedFactRefs.length === 0
    ) {
      errors.push(
        protocolError(
          'ASSESSMENT_COUNTER_SEARCH_AUDIT_REFS_REQUIRED',
          '$.candidate.counterEvidenceSearch',
          'A declared completed counter-evidence search requires at least one auditable Evidence or ObservationFact ref.',
        ),
      )
    }

    if (candidate.alternativeHypotheses.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_ALTERNATIVE_HYPOTHESIS_REQUIRED',
          '$.candidate.alternativeHypotheses',
          'A proposed candidate requires at least one alternative hypothesis.',
        ),
      )
    }

    const candidateCounterFacts = new Set(candidate.counterFactRefs)
    const searchedCounterFacts = new Set(candidate.counterEvidenceSearch.searchedFactRefs)
    const omittedCounterFacts = [...selectedCounterStanceFacts].filter(
      (factId) => !candidateCounterFacts.has(factId),
    )
    if (omittedCounterFacts.length > 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_COUNTER_FACT_OMITTED',
          '$.candidate.counterFactRefs',
          `Candidate omitted known counter facts for selected Claims: ${omittedCounterFacts.join(', ')}`,
        ),
      )
    }

    if (
      candidate.counterEvidenceSearch.completed &&
      [...selectedCounterStanceFacts].some((factId) => !searchedCounterFacts.has(factId))
    ) {
      errors.push(
        protocolError(
          'ASSESSMENT_COUNTER_SEARCH_REQUIRED',
          '$.candidate.counterEvidenceSearch.searchedFactRefs',
          'Declared completed counter-evidence search must cite every known counter ClaimFact in selected Claims.',
        ),
      )
    }
  } else {
    if (candidate.provisionalJudgment !== null) {
      errors.push(
        protocolError(
          'ASSESSMENT_ABSTENTION_JUDGMENT_MUST_BE_NULL',
          '$.candidate.provisionalJudgment',
          'An insufficient-evidence candidate must not assert a provisional judgment.',
        ),
      )
    }
    if (candidate.unresolvedQuestions.length === 0 || candidate.nextObservations.length === 0) {
      errors.push(
        protocolError(
          'ASSESSMENT_ABSTENTION_DETAILS_REQUIRED',
          '$.candidate',
          'An insufficient-evidence candidate must provide unresolved questions and next observations.',
        ),
      )
    }
  }

  if (errors.length > 0) {
    return deepFreeze({ ok: false, errors: uniqueErrors(errors) })
  }

  return deepFreeze({
    ok: true,
    input,
    candidate,
    context,
  })
}
