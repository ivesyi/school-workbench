import { describe, expect, it } from 'vitest'
import { syntheticGoldenSuite } from '../golden/v1/cases'
import { loadGoldenCaseFixtures } from './golden'
import { registryForProfile } from './test-support'
import { validateAssessmentCandidate } from './validator'

const goldenCases = loadGoldenCaseFixtures(syntheticGoldenSuite)
const validCase = goldenCases.find((item) => item.id === 'sbd-system-alignment-proposed')
const counterCase = goldenCases.find((item) => item.id === 'counter-fact-omitted')

if (!validCase || !counterCase) throw new Error('Missing assessment golden case')

function expectOnlyCode(result: ReturnType<typeof validateAssessmentCandidate>, code: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.map((error) => error.code)).toEqual([code])
}

describe('assessment protocol contracts', () => {
  it('fails closed on unknown AssessmentInput and AssessmentCandidate fields', () => {
    const input = {
      ...(validCase.input as Record<string, unknown>),
      unexpected: true,
    }
    const inputResult = validateAssessmentCandidate(
      input,
      validCase.candidate,
      registryForProfile('active'),
    )
    expect(inputResult.ok).toBe(false)
    if (!inputResult.ok) {
      expect(inputResult.errors.map((error) => error.code)).toEqual(['ASSESSMENT_INVALID_INPUT'])
    }

    const candidate = {
      ...(validCase.candidate as Record<string, unknown>),
      unexpected: true,
    }
    const candidateResult = validateAssessmentCandidate(
      validCase.input,
      candidate,
      registryForProfile('active'),
    )
    expect(candidateResult.ok).toBe(false)
    if (!candidateResult.ok) {
      expect(candidateResult.errors.map((error) => error.code)).toEqual([
        'ASSESSMENT_INVALID_CANDIDATE',
      ])
    }
  })

  it('rejects duplicate input ids and ClaimFact tuples before Map or Set can hide them', () => {
    const input = validCase.input as Record<string, unknown>
    for (const field of ['confirmedStageTargets', 'evidence', 'observationFacts', 'claims'] as const) {
      const values = input[field] as readonly unknown[]
      const first = values[0]
      if (!first) throw new Error(`Fixture is missing ${field}`)
      const result = validateAssessmentCandidate(
        { ...input, [field]: [...values, first] },
        validCase.candidate,
        registryForProfile('active'),
      )
      expectOnlyCode(result, 'ASSESSMENT_DUPLICATE_ID')
    }

    const claimFacts = input.claimFacts as readonly unknown[]
    const firstClaimFact = claimFacts[0]
    if (!firstClaimFact) throw new Error('Fixture is missing ClaimFact')
    const duplicateTupleResult = validateAssessmentCandidate(
      { ...input, claimFacts: [...claimFacts, firstClaimFact] },
      validCase.candidate,
      registryForProfile('active'),
    )
    expectOnlyCode(duplicateTupleResult, 'ASSESSMENT_DUPLICATE_REF')
  })

  it('rejects duplicate candidate refs, Interpretation ids and Interpretation fact refs', () => {
    const candidate = validCase.candidate as Record<string, unknown>

    for (const field of ['claimRefs', 'stageTargetRefs', 'supportingFactRefs'] as const) {
      const values = candidate[field] as readonly string[]
      const first = values[0]
      if (!first) throw new Error(`Fixture is missing ${field}`)
      const result = validateAssessmentCandidate(
        validCase.input,
        { ...candidate, [field]: [...values, first] },
        registryForProfile('active'),
      )
      expectOnlyCode(result, 'ASSESSMENT_DUPLICATE_REF')
    }

    const search = candidate.counterEvidenceSearch as Record<string, unknown>
    for (const field of ['searchedEvidenceRefs', 'searchedFactRefs'] as const) {
      const values = search[field] as readonly string[]
      const first = values[0]
      if (!first) throw new Error(`Fixture is missing counterEvidenceSearch.${field}`)
      const result = validateAssessmentCandidate(
        validCase.input,
        {
          ...candidate,
          counterEvidenceSearch: { ...search, [field]: [...values, first] },
        },
        registryForProfile('active'),
      )
      expectOnlyCode(result, 'ASSESSMENT_DUPLICATE_REF')
    }

    const interpretations = candidate.interpretations as readonly Record<string, unknown>[]
    const firstInterpretation = interpretations[0]
    if (!firstInterpretation) throw new Error('Fixture is missing Interpretation')
    expectOnlyCode(
      validateAssessmentCandidate(
        validCase.input,
        { ...candidate, interpretations: [...interpretations, firstInterpretation] },
        registryForProfile('active'),
      ),
      'ASSESSMENT_DUPLICATE_ID',
    )

    const factRefs = firstInterpretation.factRefs as readonly string[]
    const firstFactRef = factRefs[0]
    if (!firstFactRef) throw new Error('Fixture is missing Interpretation fact ref')
    expectOnlyCode(
      validateAssessmentCandidate(
        validCase.input,
        {
          ...candidate,
          interpretations: [
            { ...firstInterpretation, factRefs: [...factRefs, firstFactRef] },
          ],
        },
        registryForProfile('active'),
      ),
      'ASSESSMENT_DUPLICATE_REF',
    )

    const counterCandidate = counterCase.candidate as Record<string, unknown>
    expectOnlyCode(
      validateAssessmentCandidate(
        counterCase.input,
        {
          ...counterCandidate,
          counterFactRefs: ['school-counter-synthetic-f2', 'school-counter-synthetic-f2'],
        },
        registryForProfile('active'),
      ),
      'ASSESSMENT_DUPLICATE_REF',
    )
  })

  it('rejects numeric score, weight and ranking fields with a stable error code', () => {
    for (const field of ['score', 'weight', 'schoolRank'] as const) {
      const candidate = {
        ...(validCase.candidate as Record<string, unknown>),
        [field]: 0.8,
      }
      const result = validateAssessmentCandidate(
        validCase.input,
        candidate,
        registryForProfile('active'),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.map((error) => error.code)).toEqual([
          'ASSESSMENT_NUMERIC_SCORING_FORBIDDEN',
        ])
      }
    }
  })

  it('rejects hidden reasoning traces while allowing concise reasons and references', () => {
    const candidate = {
      ...(validCase.candidate as Record<string, unknown>),
      chainOfThought: 'private reasoning trace',
    }
    const result = validateAssessmentCandidate(
      validCase.input,
      candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual([
        'ASSESSMENT_HIDDEN_REASONING_FORBIDDEN',
      ])
    }
  })

  it('does not accept RAG similarity or source excerpts as methodology Criterion context', () => {
    const input = validCase.input as Record<string, unknown>
    const methodologyContext = input.methodologyContext as readonly Record<string, unknown>[]
    const candidate = validCase.candidate as Record<string, unknown>
    const criterionMappings = candidate.criterionMappings as readonly Record<string, unknown>[]
    const methodologyRef = methodologyContext[0]
    const criterionMapping = criterionMappings[0]
    if (!methodologyRef || !criterionMapping) {
      throw new Error('Valid fixture is missing methodology refs')
    }

    const ragLikeInput = {
      ...input,
      methodologyContext: [{ ...methodologyRef, sourceExcerpt: 'not allowed' }],
    }
    const ragInputResult = validateAssessmentCandidate(
      ragLikeInput,
      validCase.candidate,
      registryForProfile('active'),
    )
    expect(ragInputResult.ok).toBe(false)
    if (!ragInputResult.ok) {
      expect(ragInputResult.errors.map((error) => error.code)).toEqual(['ASSESSMENT_INVALID_INPUT'])
    }

    const ragLikeCandidate = {
      ...candidate,
      criterionMappings: [{ ...criterionMapping, similarity: 0.93 }],
    }
    const ragCandidateResult = validateAssessmentCandidate(
      validCase.input,
      ragLikeCandidate,
      registryForProfile('active'),
    )
    expect(ragCandidateResult.ok).toBe(false)
    if (!ragCandidateResult.ok) {
      expect(ragCandidateResult.errors.map((error) => error.code)).toEqual([
        'ASSESSMENT_INVALID_CANDIDATE',
      ])
    }
  })

  it('returns immutable parsed input, candidate and validation output', () => {
    const result = validateAssessmentCandidate(
      validCase.input,
      validCase.candidate,
      registryForProfile('active'),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.input)).toBe(true)
    expect(Object.isFrozen(result.candidate)).toBe(true)
    expect(Object.isFrozen(result.candidate.claimRefs)).toBe(true)
    expect(Object.isFrozen(result.candidate.criterionMappings)).toBe(true)

    const mutableCandidate = result.candidate as unknown as { status: string }
    expect(() => {
      mutableCandidate.status = 'tampered'
    }).toThrow(TypeError)
  })
})
