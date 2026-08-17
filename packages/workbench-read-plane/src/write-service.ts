import type { AssessmentProtocolError } from '@school-workbench/assessment'
import { assessmentProtocolErrorSchema } from '@school-workbench/assessment'
import { z } from 'zod'
import { ReadPlaneError } from './contracts'
import {
  diagnosisProposeInputSchema,
  evidenceRegisterInputSchema,
  type DiagnosisProposalDto,
  type EvidenceRegistrationDto,
  type GroundedDiagnosisGateway,
  type WritePlaneRepository,
} from './write-contracts'

/**
 * Carries the assessment protocol's own errors out to the Agent unchanged.
 *
 * Decision L5: the 34 `ASSESSMENT_*` codes are returned as a structured list,
 * not folded into one message. They are the only feedback an Agent gets about
 * *why* a candidate was refused, and folding them makes self-correction guesswork.
 */
export class WritePlaneProtocolError extends Error {
  readonly code = 'ASSESSMENT_PROTOCOL_REJECTED' as const

  constructor(readonly errors: readonly AssessmentProtocolError[]) {
    super('The assessment protocol refused this candidate')
    this.name = 'WritePlaneProtocolError'
  }
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new ReadPlaneError('INPUT_INVALID', 'Capability input failed strict validation')
  }
  return parsed.data
}

function assertScopedSchool(inputSchoolId: string | undefined, schoolId: string): void {
  if (inputSchoolId !== undefined && inputSchoolId !== schoolId) {
    throw new ReadPlaneError('INPUT_INVALID', 'Input schoolId does not match the scoped school')
  }
}

const protocolErrorListSchema = z.array(assessmentProtocolErrorSchema).min(1)

/**
 * Recognises the grounded diagnosis pipeline's protocol rejection without
 * importing the application layer, so the write plane keeps its narrow
 * dependency surface. Anything that is not a well-formed protocol rejection is
 * re-thrown untouched rather than being guessed at.
 */
function toProtocolErrors(error: unknown): readonly AssessmentProtocolError[] | null {
  if (!(error instanceof Error) || error.name !== 'GroundedDiagnosisProtocolError') return null
  const parsed = protocolErrorListSchema.safeParse(Reflect.get(error, 'errors'))
  return parsed.success ? parsed.data : null
}

export type WriteCapabilityContext = Readonly<{
  schoolId: string
  agentRunId: string
}>

/**
 * The two SPEC 18 write capabilities.
 *
 * `evidence_register` records the grounds; `diagnosis_propose` submits a
 * candidate against an `AssessmentInput` that this service builds from SQLite.
 */
export class WorkbenchWriteCapabilityService {
  readonly #selfCorrectionRounds = new Map<string, number>()

  constructor(
    private readonly repository: WritePlaneRepository,
    private readonly diagnosis: GroundedDiagnosisGateway,
  ) {}

  /**
   * SPEC 22. The Domain Service verifies the school, de-duplicates, establishes
   * the source and issues an Evidence id; SPEC 74 adds the ObservationFacts the
   * Agent read off that material, and the Claims those facts bear on.
   */
  async evidenceRegister(
    context: WriteCapabilityContext,
    input: unknown,
  ): Promise<EvidenceRegistrationDto> {
    const parsed = parseInput(evidenceRegisterInputSchema, input)
    assertScopedSchool(parsed.schoolId, context.schoolId)
    return this.repository.registerEvidence({
      schoolId: context.schoolId,
      agentRunId: context.agentRunId,
      input: parsed,
    })
  }

  /**
   * SPEC 23 / 24. The candidate goes to `validateAssessmentCandidate` exactly as
   * the Agent submitted it; only the school scope is filled in, from the
   * capability token rather than from the payload.
   */
  async diagnosisPropose(
    context: WriteCapabilityContext,
    input: unknown,
  ): Promise<DiagnosisProposalDto> {
    const parsed = parseInput(diagnosisProposeInputSchema, input)
    assertScopedSchool(parsed.schoolId, context.schoolId)

    const rawAssessmentInput = await this.repository.buildAssessmentInput(context.schoolId)
    const rawAssessmentCandidate = {
      ...parsed.candidate,
      school: { kind: 'school', schoolId: context.schoolId },
    }

    try {
      const record = await this.diagnosis.create({
        schoolId: context.schoolId,
        type: parsed.type,
        title: parsed.title,
        rawAssessmentInput,
        rawAssessmentCandidate,
        agentRunId: context.agentRunId,
      })
      return Object.freeze({
        proposalId: record.proposal.id,
        status: record.proposal.status,
        claimIds: Object.freeze([...record.claimIds]),
        stageTargetIds: Object.freeze([...record.stageTargetIds]),
        criteria: Object.freeze(record.criteria.map((item) => Object.freeze({ ...item }))),
      })
    } catch (error) {
      const errors = toProtocolErrors(error)
      if (!errors) throw error
      this.#selfCorrectionRounds.set(
        context.agentRunId,
        (this.#selfCorrectionRounds.get(context.agentRunId) ?? 0) + 1,
      )
      throw new WritePlaneProtocolError(errors)
    }
  }

  /**
   * How many times this run had a candidate refused before it either succeeded
   * or gave up (decision L5).
   */
  selfCorrectionRounds(agentRunId: string): number {
    return this.#selfCorrectionRounds.get(agentRunId) ?? 0
  }

  /** Releases the counter once a run is over. */
  forgetRun(agentRunId: string): void {
    this.#selfCorrectionRounds.delete(agentRunId)
  }
}
