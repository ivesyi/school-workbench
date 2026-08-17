import { deepFreeze, type MethodologyRegistry } from '@school-workbench/methodology'
import { z } from 'zod'
import { assessmentErrorCodeSchema, type AssessmentErrorCode } from './errors'
import { validateAssessmentCandidate } from './validator'

export const goldenCaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    materialPolicy: z.literal('synthetic_only'),
    contextProfile: z.string().trim().min(1).max(200),
    input: z.unknown(),
    candidate: z.unknown(),
    expected: z
      .object({
        validationOutcome: z.enum(['pass', 'fail']),
        errorCodes: z.array(assessmentErrorCodeSchema),
        substantiveReviewStatus: z.enum(['pending_review', 'not_applicable']),
      })
      .strict(),
  })
  .strict()

export const goldenSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    cases: z.array(goldenCaseSchema).min(1),
  })
  .strict()

export type GoldenCase = Readonly<z.infer<typeof goldenCaseSchema>>
export type GoldenSuite = Readonly<z.infer<typeof goldenSuiteSchema>>

export type GoldenCaseResult = Readonly<{
  caseId: string
  contextProfile: string
  harnessOutcome: 'pass' | 'fail'
  validationOutcome: 'pass' | 'fail'
  errorCodes: readonly AssessmentErrorCode[]
  substantiveReviewStatus: GoldenCase['expected']['substantiveReviewStatus']
  runtimeId: string | null
}>

export interface AssessmentRuntimeAdapter {
  readonly id: string
  createCandidate(input: unknown): unknown | Promise<unknown>
}

function sortedCodes(codes: readonly AssessmentErrorCode[]): AssessmentErrorCode[] {
  return [...codes].sort()
}

function sameCodes(
  actualCodes: readonly AssessmentErrorCode[],
  expectedCodes: readonly AssessmentErrorCode[],
): boolean {
  const actual = sortedCodes(actualCodes)
  const expected = sortedCodes(expectedCodes)
  return actual.length === expected.length && actual.every((code, index) => code === expected[index])
}

function summarizeResult(
  goldenCase: GoldenCase,
  validationOutcome: 'pass' | 'fail',
  errorCodes: readonly AssessmentErrorCode[],
  runtimeId: string | null,
): GoldenCaseResult {
  const matches =
    validationOutcome === goldenCase.expected.validationOutcome &&
    sameCodes(errorCodes, goldenCase.expected.errorCodes)

  return deepFreeze({
    caseId: goldenCase.id,
    contextProfile: goldenCase.contextProfile,
    harnessOutcome: matches ? 'pass' : 'fail',
    validationOutcome,
    errorCodes: sortedCodes(errorCodes),
    substantiveReviewStatus: goldenCase.expected.substantiveReviewStatus,
    runtimeId,
  })
}

export function loadGoldenCaseFixtures(rawFixture: unknown): readonly GoldenCase[] {
  const suite = goldenSuiteSchema.parse(rawFixture)
  return deepFreeze(suite.cases)
}

export function parseGoldenCaseFixtureJson(jsonText: string): readonly GoldenCase[] {
  return loadGoldenCaseFixtures(JSON.parse(jsonText) as unknown)
}

export function runGoldenCase(
  goldenCase: GoldenCase,
  registry: MethodologyRegistry,
): GoldenCaseResult {
  const validation = validateAssessmentCandidate(
    goldenCase.input,
    goldenCase.candidate,
    registry,
  )
  if (validation.ok) {
    return summarizeResult(goldenCase, 'pass', [], null)
  }
  return summarizeResult(
    goldenCase,
    'fail',
    validation.errors.map((error) => error.code),
    null,
  )
}

export function runGoldenSuite(
  goldenCases: readonly GoldenCase[],
  registryForCase: (goldenCase: GoldenCase) => MethodologyRegistry,
): readonly GoldenCaseResult[] {
  return deepFreeze(
    goldenCases.map((goldenCase) => runGoldenCase(goldenCase, registryForCase(goldenCase))),
  )
}

export async function runGoldenCaseWithAdapter(
  goldenCase: GoldenCase,
  registry: MethodologyRegistry,
  adapter: AssessmentRuntimeAdapter,
): Promise<GoldenCaseResult> {
  try {
    const candidate = await adapter.createCandidate(goldenCase.input)
    const validation = validateAssessmentCandidate(goldenCase.input, candidate, registry)
    if (validation.ok) {
      return summarizeResult(goldenCase, 'pass', [], adapter.id)
    }
    return summarizeResult(
      goldenCase,
      'fail',
      validation.errors.map((error) => error.code),
      adapter.id,
    )
  } catch {
    return summarizeResult(
      goldenCase,
      'fail',
      ['ASSESSMENT_RUNTIME_ADAPTER_ERROR'],
      adapter.id,
    )
  }
}
