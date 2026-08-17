import {
  deepFreeze,
  projectMethodologyPack,
  type MethodologyPack,
  type MethodologyPackProjection,
  type MethodologyRegistry,
  type MethodologyRepository,
} from '@school-workbench/methodology'
import { z } from 'zod'
import {
  diagnosisListInputSchema,
  evidenceListInputSchema,
  ReadPlaneError,
  schoolContextInputSchema,
  stageCurrentInputSchema,
  standardsGetInputSchema,
  stateCurrentInputSchema,
  stateHistoryInputSchema,
  type DiagnosisListDto,
  type DiagnosisListInput,
  type EvidenceListDto,
  type EvidenceListInput,
  type ReadPlaneRepository,
  type SchoolContextDto,
  type SchoolContextInput,
  type SortCursor,
  type StageCurrentDto,
  type StageCurrentInput,
  type StandardsGetDto,
  type StandardsGetInput,
  type StateCurrentDto,
  type StateCurrentInput,
  type StateHistoryDto,
  type StateHistoryInput,
} from './contracts'

const sortCursorSchema = z
  .object({
    createdAt: z.string().trim().min(1).max(64),
    id: z.string().trim().min(1).max(160),
  })
  .strict()

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

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new ReadPlaneError('READ_STALE', 'Persisted JSON provenance is malformed')
  }
}

function decodeCursor(cursor: string | undefined): SortCursor | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = sortCursorSchema.parse(JSON.parse(decoded) as unknown)
    return Object.freeze(parsed)
  } catch {
    throw new ReadPlaneError('INPUT_INVALID', 'Cursor is malformed')
  }
}

function encodeCursor(value: SortCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function sameProjectionContent(
  fileProjection: MethodologyPackProjection,
  persistedProjection: MethodologyPackProjection,
): boolean {
  return JSON.stringify(fileProjection) === JSON.stringify(persistedProjection)
}

function selectedConstructIds(
  pack: MethodologyPack,
  criterionIds: ReadonlySet<string>,
): Set<string> {
  const constructById = new Map(pack.constructs.map((construct) => [construct.id, construct]))
  const result = new Set<string>()

  for (const criterion of pack.criteria) {
    if (!criterionIds.has(criterion.id)) continue
    let constructId: string | undefined = criterion.constructId
    while (constructId) {
      if (result.has(constructId)) break
      result.add(constructId)
      constructId = constructById.get(constructId)?.parentId
    }
  }
  return result
}

export class WorkbenchReadCapabilityService {
  constructor(
    private readonly repository: ReadPlaneRepository,
    private readonly fileRegistry: MethodologyRegistry,
    private readonly methodologyRepository: MethodologyRepository,
  ) {}

  async schoolContext(schoolId: string, input: unknown): Promise<SchoolContextDto> {
    const parsed: SchoolContextInput = parseInput(schoolContextInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    const school = await this.requireSchool(schoolId)
    const [activeStage, latestState, recentJudgments] = await Promise.all([
      this.repository.getActiveStage(schoolId),
      this.repository.getLatestState(schoolId),
      this.repository.listRecentJudgments(schoolId, 10),
    ])

    return deepFreeze({
      school,
      activeStage: activeStage
        ? {
            id: activeStage.id,
            title: activeStage.title,
            summary: activeStage.summary,
            focus: activeStage.focus,
            sequence: activeStage.sequence,
            startsAt: activeStage.startsAt,
          }
        : null,
      latestSnapshot: latestState
        ? {
            id: latestState.snapshot.id,
            sequence: latestState.snapshot.sequence,
            summary: latestState.snapshot.summary,
            isBaseline: latestState.snapshot.isBaseline,
            confirmedAt: latestState.snapshot.confirmedAt,
          }
        : null,
      recentJudgments: recentJudgments.map((judgment) => ({
        ...judgment,
        scope: typeof judgment.scope === 'string' ? parseJsonValue(judgment.scope) : judgment.scope,
      })),
      judgmentLimit: 10 as const,
      judgmentOrder: 'createdAt_desc_id_desc' as const,
    })
  }

  async stageCurrent(schoolId: string, input: unknown): Promise<StageCurrentDto> {
    const parsed: StageCurrentInput = parseInput(stageCurrentInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)
    const stage = await this.repository.getActiveStage(schoolId)
    if (!stage) return Object.freeze({ status: 'absent', reason: 'no_active_stage' })
    return deepFreeze({ status: 'present', stage })
  }

  async stateCurrent(schoolId: string, input: unknown): Promise<StateCurrentDto> {
    const parsed: StateCurrentInput = parseInput(stateCurrentInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)
    const state = await this.repository.getLatestState(schoolId)
    if (!state) return Object.freeze({ status: 'absent', reason: 'no_snapshot' })
    return deepFreeze({ status: 'present', state })
  }

  async stateHistory(schoolId: string, input: unknown): Promise<StateHistoryDto> {
    const parsed: StateHistoryInput = parseInput(stateHistoryInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)
    const limit = parsed.limit ?? 10
    const page = await this.repository.listStateHistory(schoolId, {
      limit,
      beforeSequence: parsed.beforeSequence ?? null,
    })
    const last = page.items.at(-1)
    return deepFreeze({
      items: page.items,
      order: 'sequence_desc' as const,
      limit,
      nextBeforeSequence: page.hasMore && last ? last.snapshot.sequence : null,
    })
  }

  async evidenceList(schoolId: string, input: unknown): Promise<EvidenceListDto> {
    const parsed: EvidenceListInput = parseInput(evidenceListInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)
    const limit = parsed.limit ?? 20
    const page = await this.repository.listEvidence(schoolId, {
      limit,
      before: decodeCursor(parsed.cursor),
    })
    const last = page.items.at(-1)
    return deepFreeze({
      items: page.items,
      order: 'createdAt_desc_id_desc' as const,
      limit,
      nextCursor:
        page.hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    })
  }

  async diagnosisList(schoolId: string, input: unknown): Promise<DiagnosisListDto> {
    const parsed: DiagnosisListInput = parseInput(diagnosisListInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)
    const limit = parsed.limit ?? 20
    const page = await this.repository.listDiagnoses(schoolId, {
      limit,
      before: decodeCursor(parsed.cursor),
    })
    const last = page.items.at(-1)
    return deepFreeze({
      items: page.items,
      order: 'createdAt_desc_id_desc' as const,
      limit,
      nextCursor:
        page.hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    })
  }

  async standardsGet(schoolId: string, input: unknown): Promise<StandardsGetDto> {
    const parsed: StandardsGetInput = parseInput(standardsGetInputSchema, input)
    assertScopedSchool(parsed.schoolId, schoolId)
    await this.requireSchool(schoolId)

    const filePack = this.fileRegistry.getPack(parsed.packKey, parsed.version)
    if (!filePack) {
      throw new ReadPlaneError('INPUT_INVALID', 'Unknown methodology pack or version')
    }
    if (filePack.status !== 'active') {
      return Object.freeze({
        status: 'no_active_pack',
        packKey: parsed.packKey,
        version: parsed.version,
        reason: 'file_not_active',
      })
    }

    const persistedPack = await this.methodologyRepository.getPack(parsed.packKey, parsed.version)
    if (!persistedPack || persistedPack.status !== 'active') {
      return Object.freeze({
        status: 'no_active_pack',
        packKey: parsed.packKey,
        version: parsed.version,
        reason: 'persisted_not_active',
      })
    }

    const fileProjection = projectMethodologyPack(filePack)
    if (!sameProjectionContent(fileProjection, persistedPack)) {
      throw new ReadPlaneError(
        'STANDARDS_DRIFT',
        'Active file and persisted methodology projections do not match',
      )
    }

    const criterionById = new Map(filePack.criteria.map((criterion) => [criterion.id, criterion]))
    if (parsed.criterionRefs) {
      for (const ref of parsed.criterionRefs) {
        if (!criterionById.has(ref)) {
          throw new ReadPlaneError('INPUT_INVALID', `Unknown criterionRef: ${ref}`)
        }
      }
    }
    if (
      parsed.practiceType &&
      !filePack.criteria.some((criterion) => criterion.practiceType === parsed.practiceType)
    ) {
      throw new ReadPlaneError('INPUT_INVALID', `Unknown practiceType: ${parsed.practiceType}`)
    }

    const selected = filePack.criteria
      .filter(
        (criterion) =>
          !parsed.dimensionKeys?.length ||
          (criterion.dimensionKey !== null &&
            parsed.dimensionKeys.includes(criterion.dimensionKey)),
      )
      .filter((criterion) => !parsed.practiceType || criterion.practiceType === parsed.practiceType)
      .filter(
        (criterion) => !parsed.criterionRefs?.length || parsed.criterionRefs.includes(criterion.id),
      )
    const selectedIds = new Set(selected.map((criterion) => criterion.id))
    const constructIds = selectedConstructIds(filePack, selectedIds)
    const guidanceByCriterion = new Map(
      filePack.evidenceGuidance.map((guidance) => [guidance.criterionId, guidance]),
    )

    return deepFreeze({
      status: 'ok' as const,
      pack: {
        key: filePack.key,
        version: filePack.version,
        title: filePack.title,
        sourceRef: filePack.sourceRef,
        sourceFingerprint: filePack.sourceFingerprint.value,
        contentHash: filePack.canonicalContentHash.value,
      },
      constructs: filePack.constructs.filter((construct) => constructIds.has(construct.id)),
      criteria: selected.map((criterion) => {
        const evidenceGuidance = guidanceByCriterion.get(criterion.id)
        if (!evidenceGuidance) {
          throw new ReadPlaneError('STANDARDS_DRIFT', `Criterion ${criterion.id} has no guidance`)
        }
        return {
          id: criterion.id,
          constructId: criterion.constructId,
          ...(criterion.parentId ? { parentId: criterion.parentId } : {}),
          dimensionKey: criterion.dimensionKey,
          practiceType: criterion.practiceType,
          title: criterion.title,
          description: criterion.description,
          applicability: criterion.applicability,
          evidenceGuidance,
          counterIndicators: evidenceGuidance.counterIndicators,
          inferenceGuardrails: filePack.inferenceGuardrails.filter(
            (guardrail) => guardrail.scope === 'pack' || guardrail.criterionId === criterion.id,
          ),
          sourceLocator: criterion.sourceLocator,
        }
      }),
      behaviorAnchors: filePack.behaviorAnchors.filter((anchor) =>
        selectedIds.has(anchor.criterionId),
      ),
    })
  }

  private async requireSchool(schoolId: string) {
    const school = await this.repository.getSchool(schoolId)
    if (!school || school.archivedAt) {
      throw new ReadPlaneError('SCHOOL_NOT_FOUND', 'Scoped school is not available')
    }
    return school
  }
}
