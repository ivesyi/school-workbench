import { describe, expect, it } from 'vitest'
import { syntheticGoldenSuite } from '../golden/v1/cases'
import { loadGoldenCaseFixtures } from './golden'
import { registryForProfile } from './test-support'
import { validateAssessmentCandidate } from './validator'

const goldenCases = loadGoldenCaseFixtures(syntheticGoldenSuite)

function caseById(id: string) {
  const goldenCase = goldenCases.find((item) => item.id === id)
  if (!goldenCase) throw new Error(`Missing golden case ${id}`)
  return goldenCase
}

describe('assessment validator', () => {
  it('accepts a protocol-valid proposed candidate without claiming substantive approval', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const result = validateAssessmentCandidate(
      goldenCase.input,
      goldenCase.candidate,
      registryForProfile(goldenCase.contextProfile),
    )

    expect(result.ok).toBe(true)
    expect(goldenCase.expected.substantiveReviewStatus).toBe('pending_review')
  })

  it('requires explicit counter search and an alternative hypothesis for proposed status', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const candidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      counterEvidenceSearch: {
        completed: false,
        summary: '合成测试：尚未完成相反事实搜索。',
        searchedEvidenceRefs: [],
        searchedFactRefs: [],
      },
      alternativeHypotheses: [],
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain('ASSESSMENT_COUNTER_SEARCH_REQUIRED')
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_ALTERNATIVE_HYPOTHESIS_REQUIRED',
    )
  })

  it('requires a completed counter search declaration to carry auditable refs', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const candidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      counterEvidenceSearch: {
        completed: true,
        summary: '合成测试：声明完成，但没有任何可审核引用。',
        searchedEvidenceRefs: [],
        searchedFactRefs: [],
      },
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_COUNTER_SEARCH_AUDIT_REFS_REQUIRED',
    )
  })

  it('requires abstention when there is no active Criterion mapping context or supporting ClaimFact', () => {
    const goldenCase = caseById('single-vague-input-abstains')
    const insufficientCandidate = goldenCase.candidate as Record<string, unknown>
    const forcedCandidate = {
      ...insufficientCandidate,
      status: 'proposed',
      provisionalJudgment: '不应被允许的强行判断',
      alternativeHypotheses: ['另一种解释'],
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      forcedCandidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain('ASSESSMENT_ABSTENTION_REQUIRED')
    expect(result.errors.map((error) => error.code)).toContain('ASSESSMENT_PROPOSED_CLAIM_REQUIRED')
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
    )
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_PROPOSED_SUPPORTING_FACT_REQUIRED',
    )
  })

  it('requires insufficient-evidence output to keep judgment null and name next evidence work', () => {
    const goldenCase = caseById('single-vague-input-abstains')
    const candidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      provisionalJudgment: '不应出现的判断',
      unresolvedQuestions: [],
      nextObservations: [],
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_ABSTENTION_JUDGMENT_MUST_BE_NULL',
    )
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_ABSTENTION_DETAILS_REQUIRED',
    )
  })

  it('requires a current confirmed StageTarget and valid ClaimFact stance references', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const input = goldenCase.input as Record<string, unknown>
    const confirmedStageTargets = input.confirmedStageTargets as readonly Record<string, unknown>[]
    const firstTarget = confirmedStageTargets[0]
    if (!firstTarget) throw new Error('Fixture is missing StageTarget')

    const badStageInput = {
      ...input,
      confirmedStageTargets: [{ ...firstTarget, status: 'draft' }],
    }
    const stageResult = validateAssessmentCandidate(
      badStageInput,
      goldenCase.candidate,
      registryForProfile('active'),
    )
    expect(stageResult.ok).toBe(false)
    if (!stageResult.ok) {
      expect(stageResult.errors.map((error) => error.code)).toEqual(['ASSESSMENT_INVALID_INPUT'])
    }

    const danglingInput = {
      ...input,
      claimFacts: [{ claimId: 'missing-claim', factId: 'missing-fact', stance: 'supporting' }],
    }
    const danglingResult = validateAssessmentCandidate(
      danglingInput,
      goldenCase.candidate,
      registryForProfile('active'),
    )
    expect(danglingResult.ok).toBe(false)
    if (!danglingResult.ok) {
      expect(danglingResult.errors.map((error) => error.code).sort()).toEqual([
        'ASSESSMENT_CLAIM_REF_DANGLING',
        'ASSESSMENT_FACT_REF_DANGLING',
      ])
    }
  })

  it('requires candidate Claim refs to exist and supporting facts to belong to selected Claims', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const danglingCandidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      claimRefs: ['missing-claim'],
    }

    const danglingResult = validateAssessmentCandidate(
      goldenCase.input,
      danglingCandidate,
      registryForProfile('active'),
    )

    expect(danglingResult.ok).toBe(false)
    if (!danglingResult.ok) {
      expect(danglingResult.errors.map((error) => error.code)).toContain(
        'ASSESSMENT_CLAIM_REF_DANGLING',
      )
      expect(danglingResult.errors.map((error) => error.code)).toContain(
        'ASSESSMENT_FACT_STANCE_MISMATCH',
      )
    }
  })

  it('scopes counter facts to selected Claims only', () => {
    const unrelatedCase = caseById('unselected-claim-counter-does-not-pollute')
    const unrelatedResult = validateAssessmentCandidate(
      unrelatedCase.input,
      unrelatedCase.candidate,
      registryForProfile('active'),
    )
    expect(unrelatedResult.ok).toBe(true)

    const selectedCase = caseById('selected-claim-counter-still-required')
    const selectedResult = validateAssessmentCandidate(
      selectedCase.input,
      selectedCase.candidate,
      registryForProfile('active'),
    )
    expect(selectedResult.ok).toBe(false)
    if (selectedResult.ok) return
    expect(selectedResult.errors.map((error) => error.code)).toEqual([
      'ASSESSMENT_COUNTER_FACT_OMITTED',
    ])
  })

  it('requires a proposed candidate to cite a current StageTarget', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const candidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      stageTargetRefs: [],
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_PROPOSED_STAGE_TARGET_REQUIRED',
    )
  })

  it('does not select Criteria on behalf of the candidate', () => {
    const goldenCase = caseById('sbd-system-alignment-proposed')
    const candidate = {
      ...(goldenCase.candidate as Record<string, unknown>),
      criterionMappings: [],
    }

    const result = validateAssessmentCandidate(
      goldenCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain(
      'ASSESSMENT_PROPOSED_CRITERION_REQUIRED',
    )
  })
})
