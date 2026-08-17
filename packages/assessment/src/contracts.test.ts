import { describe, expect, it } from 'vitest'
import { syntheticGoldenSuite } from '../golden/v1/cases'
import { loadGoldenCaseFixtures } from './golden'
import { registryForProfile } from './test-support'
import { validateAssessmentCandidate } from './validator'

const goldenCases = loadGoldenCaseFixtures(syntheticGoldenSuite)
const validCase = goldenCases.find((item) => item.id === 'sbd-system-alignment-proposed')

if (!validCase) throw new Error('Missing valid assessment golden case')

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
    expect(Object.isFrozen(result.candidate.criterionMappings)).toBe(true)

    const mutableCandidate = result.candidate as unknown as { status: string }
    expect(() => {
      mutableCandidate.status = 'tampered'
    }).toThrow(TypeError)
  })
})
