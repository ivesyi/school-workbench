import {
  protocolError,
  validateAssessmentCandidate,
  type AssessmentCandidate,
  type AssessmentInput,
  type AssessmentProtocolError,
} from '@school-workbench/assessment'
import {
  createGroundedDiagnosisProposal,
  type DiagnosisProposal,
  type GroundedDiagnosisFactoryDependencies,
  type GroundedDiagnosisRecord,
} from '@school-workbench/domain'
import {
  projectMethodologyPack,
  type MethodologyPackProjection,
  type MethodologyRegistry,
} from '@school-workbench/methodology'

export type GroundedMethodologyExpectation = Readonly<{
  packId: string
  packKey: string
  version: string
  packContentHash: string
  packSourceFingerprint: string
  criterion: MethodologyPackProjection['criteria'][number]
  expectedParentRowId: string | null
}>

export type GroundedDiagnosisPersistenceRequest = Readonly<{
  proposal: DiagnosisProposal
  input: AssessmentInput
  candidate: AssessmentCandidate
  methodology: readonly GroundedMethodologyExpectation[]
}>

export interface GroundedDiagnosisRepository {
  saveGroundedProposal(request: GroundedDiagnosisPersistenceRequest): Promise<GroundedDiagnosisRecord>
  findGroundedProposal(id: string): Promise<GroundedDiagnosisRecord | null>
}

export class GroundedDiagnosisProtocolError extends Error {
  readonly errors: readonly AssessmentProtocolError[]

  constructor(errors: readonly AssessmentProtocolError[]) {
    super(errors.map((error) => `${error.code}: ${error.message}`).join('; '))
    this.name = 'GroundedDiagnosisProtocolError'
    this.errors = errors
  }
}

export type CreateGroundedDiagnosisInput = Readonly<{
  schoolId: string
  type: DiagnosisProposal['type']
  title: string
  rawAssessmentInput: unknown
  rawAssessmentCandidate: unknown
}>

function evidenceQuality(candidate: AssessmentCandidate): DiagnosisProposal['evidenceQuality'] {
  const notes = candidate.evidenceQuality.limitations.join('；').trim()
  return {
    directness: candidate.evidenceQuality.directness,
    triangulated: candidate.evidenceQuality.triangulation === 'multiple_sources',
    ...(notes ? { notes } : {}),
  }
}

function criterionProjection(
  registry: MethodologyRegistry,
  packKey: string,
  version: string,
  stableKey: string,
): GroundedMethodologyExpectation {
  const pack = registry.getPack(packKey, version)
  if (!pack || pack.status !== 'active') {
    throw new GroundedDiagnosisProtocolError([
      protocolError(
        'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
        '$.candidate.criterionMappings',
        `Methodology pack ${packKey}@${version} is not active.`,
      ),
    ])
  }
  const projection: MethodologyPackProjection = projectMethodologyPack(pack)
  const criterion = projection.criteria.find((item) => item.stableKey === stableKey)
  if (!criterion) {
    throw new GroundedDiagnosisProtocolError([
      protocolError(
        'ASSESSMENT_METHODOLOGY_CRITERION_NOT_FOUND',
        '$.candidate.criterionMappings',
        `Criterion ${stableKey} does not exist in ${packKey}@${version}.`,
      ),
    ])
  }
  const expectedParentRowId = criterion.parentStableKey
    ? (projection.criteria.find((item) => item.stableKey === criterion.parentStableKey)?.id ?? null)
    : null
  if (criterion.parentStableKey && !expectedParentRowId) {
    throw new GroundedDiagnosisProtocolError([
      protocolError(
        'ASSESSMENT_METHODOLOGY_CRITERION_NOT_FOUND',
        '$.candidate.criterionMappings',
        `Criterion ${stableKey} has an unresolved parent in ${packKey}@${version}.`,
      ),
    ])
  }

  return {
    packId: projection.id,
    packKey,
    version,
    packContentHash: projection.contentHash,
    packSourceFingerprint: projection.sourceFingerprint,
    criterion,
    expectedParentRowId,
  }
}

export class GroundedDiagnosisService {
  constructor(
    private readonly registry: MethodologyRegistry,
    private readonly repository: GroundedDiagnosisRepository,
    private readonly dependencies?: GroundedDiagnosisFactoryDependencies,
  ) {}

  async create(input: CreateGroundedDiagnosisInput): Promise<GroundedDiagnosisRecord> {
    const validation = validateAssessmentCandidate(
      input.rawAssessmentInput,
      input.rawAssessmentCandidate,
      this.registry,
    )
    if (!validation.ok) throw new GroundedDiagnosisProtocolError(validation.errors)

    if (validation.input.school.schoolId !== input.schoolId) {
      throw new GroundedDiagnosisProtocolError([
        protocolError(
          'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
          '$.schoolId',
          'Service school scope does not match validated AssessmentInput.',
        ),
      ])
    }

    const candidate = validation.candidate
    const proposal = createGroundedDiagnosisProposal(
      input.schoolId,
      input.type,
      input.title,
      {
        interpretations: candidate.interpretations.map((item) => item.summary),
        provisionalJudgment: candidate.provisionalJudgment,
        mechanism: candidate.mechanism,
        alternativeHypotheses: candidate.alternativeHypotheses,
        unresolvedQuestions: candidate.unresolvedQuestions,
        recommendedActions: candidate.recommendedActions,
        nextObservations: candidate.nextObservations,
        impactEvidencePlan: candidate.impactEvidencePlan,
        evidenceQuality: evidenceQuality(candidate),
        confidence: candidate.confidence,
        status: candidate.status,
      },
      this.dependencies,
    )

    const methodology = candidate.criterionMappings.map((mapping) =>
      criterionProjection(this.registry, mapping.packKey, mapping.version, mapping.criterionId),
    )

    return this.repository.saveGroundedProposal({
      proposal,
      input: validation.input,
      candidate,
      methodology,
    })
  }

  async find(id: string): Promise<GroundedDiagnosisRecord | null> {
    return this.repository.findGroundedProposal(id)
  }
}
