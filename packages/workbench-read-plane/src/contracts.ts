import { canonicalDimensionKeys, type CanonicalDimensionKey } from '@school-workbench/methodology'
import { z } from 'zod'

export const readCapabilityNames = [
  'school_context',
  'stage_current',
  'state_current',
  'state_history',
  'evidence_list',
  'diagnosis_list',
  'standards_get',
] as const

export type ReadCapabilityName = (typeof readCapabilityNames)[number]

export const readScopes = [
  'school.read',
  'stage.read',
  'state.read',
  'evidence.read',
  'diagnosis.read',
  'standards.read',
] as const

export type ReadScope = (typeof readScopes)[number]

/**
 * SPEC 18 freezes the Workbench MCP tool list. These are the two write tools;
 * `feishu_ensure_ready` is the tenth and belongs to the Feishu slice.
 */
export const writeCapabilityNames = ['evidence_register', 'diagnosis_propose'] as const

export type WriteCapabilityName = (typeof writeCapabilityNames)[number]

/** SPEC 17 write scopes. Listed in the SPEC's allow list from the start. */
export const writeScopes = ['evidence.register', 'diagnosis.propose'] as const

export type WriteScope = (typeof writeScopes)[number]

/**
 * SPEC 25. The Workbench MCP surface must never expose a way for an Agent to
 * confirm formal state. Once write scopes exist, "read only" is no longer
 * guaranteed by the type system, so the prohibition is stated as an explicit
 * negative list with a contract test rather than being implied by absence.
 */
export const forbiddenCapabilityNames = [
  'diagnosis_accept',
  'diagnosis_reject',
  'state_commit',
  'stage_activate',
] as const

export type ForbiddenCapabilityName = (typeof forbiddenCapabilityNames)[number]

/** Scopes SPEC 25 forbids; no capability may ever map to one of these. */
export const forbiddenScopes = [
  'diagnosis.approve',
  'diagnosis.reject',
  'state.commit',
  'stage.activate',
  'human.review',
] as const

export type ForbiddenScope = (typeof forbiddenScopes)[number]

export const capabilityNames = [...readCapabilityNames, ...writeCapabilityNames] as const

export type CapabilityName = ReadCapabilityName | WriteCapabilityName

export const capabilityScopes = [...readScopes, ...writeScopes] as const

export type CapabilityScope = ReadScope | WriteScope

export const capabilityScope: Readonly<Record<CapabilityName, CapabilityScope>> = Object.freeze({
  school_context: 'school.read',
  stage_current: 'stage.read',
  state_current: 'state.read',
  state_history: 'state.read',
  evidence_list: 'evidence.read',
  diagnosis_list: 'diagnosis.read',
  standards_get: 'standards.read',
  evidence_register: 'evidence.register',
  diagnosis_propose: 'diagnosis.propose',
})

export function isReadCapabilityName(value: string): value is ReadCapabilityName {
  return (readCapabilityNames as readonly string[]).includes(value)
}

export function isWriteCapabilityName(value: string): value is WriteCapabilityName {
  return (writeCapabilityNames as readonly string[]).includes(value)
}

const scopedSchoolIdSchema = z.string().trim().min(1).max(128)
const cursorSchema = z.string().trim().min(1).max(512)

export const schoolContextInputSchema = z
  .object({
    schoolId: scopedSchoolIdSchema.optional(),
  })
  .strict()

export const stageCurrentInputSchema = schoolContextInputSchema
export const stateCurrentInputSchema = schoolContextInputSchema

export const stateHistoryInputSchema = z
  .object({
    schoolId: scopedSchoolIdSchema.optional(),
    limit: z.number().int().min(1).max(20).optional(),
    beforeSequence: z.number().int().min(1).optional(),
  })
  .strict()

export const evidenceListInputSchema = z
  .object({
    schoolId: scopedSchoolIdSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: cursorSchema.optional(),
  })
  .strict()

export const diagnosisListInputSchema = z
  .object({
    schoolId: scopedSchoolIdSchema.optional(),
    limit: z.number().int().min(1).max(25).optional(),
    cursor: cursorSchema.optional(),
  })
  .strict()

export const standardsGetInputSchema = z
  .object({
    schoolId: scopedSchoolIdSchema.optional(),
    packKey: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
    dimensionKeys: z
      .array(z.enum(canonicalDimensionKeys))
      .max(canonicalDimensionKeys.length)
      .optional(),
    practiceType: z.string().trim().min(1).max(120).optional(),
    criterionRefs: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.dimensionKeys?.length && !value.practiceType && !value.criterionRefs?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'standards_get requires at least one bounded filter',
      })
    }
    if (value.dimensionKeys && new Set(value.dimensionKeys).size !== value.dimensionKeys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensionKeys'],
        message: 'duplicate dimensionKeys are not allowed',
      })
    }
    if (value.criterionRefs && new Set(value.criterionRefs).size !== value.criterionRefs.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['criterionRefs'],
        message: 'duplicate criterionRefs are not allowed',
      })
    }
  })

export type SchoolContextInput = z.infer<typeof schoolContextInputSchema>
export type StageCurrentInput = z.infer<typeof stageCurrentInputSchema>
export type StateCurrentInput = z.infer<typeof stateCurrentInputSchema>
export type StateHistoryInput = z.infer<typeof stateHistoryInputSchema>
export type EvidenceListInput = z.infer<typeof evidenceListInputSchema>
export type DiagnosisListInput = z.infer<typeof diagnosisListInputSchema>
export type StandardsGetInput = z.infer<typeof standardsGetInputSchema>

export type ReadPlaneErrorCode =
  'INPUT_INVALID' | 'SCHOOL_NOT_FOUND' | 'READ_STALE' | 'STANDARDS_DRIFT' | 'INTERNAL'

export class ReadPlaneError extends Error {
  constructor(
    readonly code: ReadPlaneErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReadPlaneError'
  }
}

export type SchoolDto = Readonly<{
  id: string
  name: string
  createdAt: string
  archivedAt: string | null
}>

export type AcceptedJudgmentSummaryDto = Readonly<{
  id: string
  proposalId: string
  statement: string
  scope: unknown
  validFrom: string | null
  validTo: string | null
  createdAt: string
}>

export type StageSummaryDto = Readonly<{
  id: string
  title: string
  summary: string
  focus: string
  sequence: number
  startsAt: string | null
}>

export type SnapshotSummaryDto = Readonly<{
  id: string
  sequence: number
  summary: string
  isBaseline: boolean
  confirmedAt: string
}>

export type SchoolContextDto = Readonly<{
  school: SchoolDto
  activeStage: StageSummaryDto | null
  latestSnapshot: SnapshotSummaryDto | null
  recentJudgments: readonly AcceptedJudgmentSummaryDto[]
  judgmentLimit: 10
  judgmentOrder: 'createdAt_desc_id_desc'
}>

export type StageTargetDto = Readonly<{
  id: string
  stageId: string
  dimensionKey: CanonicalDimensionKey
  title: string
  description: string
  sequence: number
  status: 'confirmed'
}>

export type StageCurrentDto =
  | Readonly<{
      status: 'absent'
      reason: 'no_active_stage'
    }>
  | Readonly<{
      status: 'present'
      stage: StageSummaryDto &
        Readonly<{
          targets: readonly StageTargetDto[]
        }>
    }>

export type DimensionAssessmentDto = Readonly<{
  id: string
  dimensionKey: CanonicalDimensionKey
  status: 'unverified' | 'far_below' | 'partial' | 'mostly' | 'stable'
  summary: string
  judgmentIds: readonly string[]
}>

export type StateRecordDto = Readonly<{
  snapshot: Readonly<{
    id: string
    schoolId: string
    stageId: string
    previousSnapshotId: string | null
    sequence: number
    summary: string
    isBaseline: boolean
    confirmedAt: string
    createdAt: string
  }>
  assessments: readonly DimensionAssessmentDto[]
  judgmentIds: readonly string[]
}>

export type StateCurrentDto =
  | Readonly<{
      status: 'absent'
      reason: 'no_snapshot'
    }>
  | Readonly<{
      status: 'present'
      state: StateRecordDto
    }>

export type StateHistoryDto = Readonly<{
  items: readonly StateRecordDto[]
  order: 'sequence_desc'
  limit: number
  nextBeforeSequence: number | null
}>

export type EvidenceMetadataDto = Readonly<{
  id: string
  sourceType: string
  uri: string | null
  title: string
  locator: unknown | null
  contentHash: string | null
  capturedAt: string | null
  registeredBy: string
  agentRunId: string | null
  createdAt: string
  preview: string | null
}>

export type EvidenceListDto = Readonly<{
  items: readonly EvidenceMetadataDto[]
  order: 'createdAt_desc_id_desc'
  limit: number
  nextCursor: string | null
}>

export type DiagnosisCriterionRefDto = Readonly<{
  criterionId: string
  stableKey: string
  packKey: string
  version: string
}>

export type DiagnosisMetadataDto = Readonly<{
  id: string
  type: 'state' | 'characteristic' | 'mismatch' | 'practice'
  title: string
  confidence: 'low' | 'medium' | 'high'
  status: 'proposed' | 'insufficient_evidence'
  createdAt: string
  claimIds: readonly string[]
  criteria: readonly DiagnosisCriterionRefDto[]
  stageTargetIds: readonly string[]
}>

export type DiagnosisListDto = Readonly<{
  items: readonly DiagnosisMetadataDto[]
  order: 'createdAt_desc_id_desc'
  limit: number
  nextCursor: string | null
}>

export type StandardsConstructDto = Readonly<{
  id: string
  title: string
  assessmentQuestion: string
  parentId?: string
  sourceLocator: unknown
}>

export type StandardsCriterionDto = Readonly<{
  id: string
  constructId: string
  parentId?: string
  dimensionKey: CanonicalDimensionKey | null
  practiceType: string | null
  title: string
  description: string
  applicability: unknown
  evidenceGuidance: unknown
  counterIndicators: readonly string[]
  inferenceGuardrails: readonly unknown[]
  sourceLocator: unknown
}>

export type StandardsBehaviorAnchorDto = Readonly<{
  id: string
  criterionId: string
  levelKey: string
  label: string
  description: string
  sourceLocator: unknown
}>

export type StandardsGetDto =
  | Readonly<{
      status: 'no_active_pack'
      packKey: string
      version: string
      reason: 'file_not_active' | 'persisted_not_active'
    }>
  | Readonly<{
      status: 'ok'
      pack: Readonly<{
        key: string
        version: string
        title: string
        sourceRef: string
        sourceFingerprint: string
        contentHash: string
      }>
      constructs: readonly StandardsConstructDto[]
      criteria: readonly StandardsCriterionDto[]
      behaviorAnchors: readonly StandardsBehaviorAnchorDto[]
    }>

export type SortCursor = Readonly<{
  createdAt: string
  id: string
}>

export type EvidenceQuery = Readonly<{
  limit: number
  before: SortCursor | null
}>

export type DiagnosisQuery = Readonly<{
  limit: number
  before: SortCursor | null
}>

export type BoundedPage<T> = Readonly<{
  items: readonly T[]
  hasMore: boolean
}>

export interface ReadPlaneRepository {
  getSchool(schoolId: string): Promise<SchoolDto | null>
  getActiveStage(
    schoolId: string,
  ): Promise<(StageSummaryDto & { targets: readonly StageTargetDto[] }) | null>
  getLatestState(schoolId: string): Promise<StateRecordDto | null>
  listStateHistory(
    schoolId: string,
    query: Readonly<{ limit: number; beforeSequence: number | null }>,
  ): Promise<BoundedPage<StateRecordDto>>
  listRecentJudgments(
    schoolId: string,
    limit: number,
  ): Promise<readonly AcceptedJudgmentSummaryDto[]>
  listEvidence(schoolId: string, query: EvidenceQuery): Promise<BoundedPage<EvidenceMetadataDto>>
  listDiagnoses(schoolId: string, query: DiagnosisQuery): Promise<BoundedPage<DiagnosisMetadataDto>>
}
