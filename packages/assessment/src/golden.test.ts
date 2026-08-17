import { describe, expect, it } from 'vitest'
import { syntheticGoldenSuite } from '../golden/v1/cases'
import {
  loadGoldenCaseFixtures,
  runGoldenCaseWithAdapter,
  runGoldenSuite,
  type AssessmentRuntimeAdapter,
} from './golden'
import { registryForProfile } from './test-support'

const goldenCases = loadGoldenCaseFixtures(syntheticGoldenSuite)

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys)
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) {
    keys.add(key)
    allKeys(child, keys)
  }
  return keys
}

describe('assessment golden quality harness', () => {
  it('loads a versioned strict fixture suite made only from synthetic school material', () => {
    expect(goldenCases).toHaveLength(10)
    expect(goldenCases.every((goldenCase) => goldenCase.materialPolicy === 'synthetic_only')).toBe(
      true,
    )

    const keys = allKeys(goldenCases)
    expect(keys.has('bookExcerpt')).toBe(false)
    expect(keys.has('sourceExcerpt')).toBe(false)
    expect(keys.has('quotedSourceText')).toBe(false)

    const firstCase = goldenCases[0]
    if (!firstCase) throw new Error('Golden fixture suite is empty')

    expect(() =>
      loadGoldenCaseFixtures({
        schemaVersion: 1,
        cases: [
          {
            ...firstCase,
            unexpected: true,
          },
        ],
      }),
    ).toThrow()
  })

  it('covers protocol correctness without pretending consultant agreement or model accuracy', () => {
    const results = runGoldenSuite(goldenCases, (goldenCase) =>
      registryForProfile(goldenCase.contextProfile),
    )

    expect(results.every((result) => result.harnessOutcome === 'pass')).toBe(true)
    expect(
      goldenCases
        .filter((goldenCase) => goldenCase.expected.validationOutcome === 'pass')
        .some((goldenCase) => goldenCase.expected.substantiveReviewStatus === 'pending_review'),
    ).toBe(true)
    expect(
      results
        .filter((result) => result.substantiveReviewStatus === 'pending_review')
        .every((result) => result.harnessOutcome === 'pass'),
    ).toBe(true)
  })

  it('covers the required failure modes with stable error codes', () => {
    const results = runGoldenSuite(goldenCases, (goldenCase) =>
      registryForProfile(goldenCase.contextProfile),
    )
    const byId = new Map(results.map((result) => [result.caseId, result]))

    expect(byId.get('counter-fact-omitted')?.errorCodes).toEqual([
      'ASSESSMENT_COUNTER_FACT_OMITTED',
    ])
    expect(byId.get('observation-interpretation-confusion')?.errorCodes).toEqual([
      'ASSESSMENT_FACT_INTERPRETATION_CONFUSION',
    ])
    expect(byId.get('wrong-school-and-dangling-ref')?.errorCodes).toEqual([
      'ASSESSMENT_EVIDENCE_REF_DANGLING',
      'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
    ])
    expect(byId.get('review-pack-rejected')?.errorCodes).toEqual([
      'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
    ])
    expect(byId.get('retired-pack-rejected')?.errorCodes).toEqual([
      'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
    ])
    expect(byId.get('wrong-pack-version-rejected')?.errorCodes).toEqual([
      'ASSESSMENT_METHODOLOGY_PACK_NOT_FOUND',
    ])
    expect(byId.get('criterion-version-mismatch-rejected')?.errorCodes).toEqual([
      'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
    ])
    expect(byId.get('single-vague-input-abstains')?.validationOutcome).toBe('pass')
  })

  it('produces the same validation result for the same candidate across runtime adapters', async () => {
    const goldenCase = goldenCases.find((item) => item.id === 'sbd-system-alignment-proposed')
    if (!goldenCase) throw new Error('Missing adapter consistency golden case')

    const adapterA: AssessmentRuntimeAdapter = {
      id: 'synthetic-dsh-adapter',
      createCandidate: () => goldenCase.candidate,
    }
    const adapterB: AssessmentRuntimeAdapter = {
      id: 'synthetic-codex-adapter',
      createCandidate: async () => Promise.resolve(goldenCase.candidate),
    }

    const registry = registryForProfile('active')
    const resultA = await runGoldenCaseWithAdapter(goldenCase, registry, adapterA)
    const resultB = await runGoldenCaseWithAdapter(goldenCase, registry, adapterB)

    expect(resultA.harnessOutcome).toBe('pass')
    expect(resultB.harnessOutcome).toBe('pass')
    expect({
      validationOutcome: resultA.validationOutcome,
      errorCodes: resultA.errorCodes,
    }).toEqual({
      validationOutcome: resultB.validationOutcome,
      errorCodes: resultB.errorCodes,
    })
  })
})
