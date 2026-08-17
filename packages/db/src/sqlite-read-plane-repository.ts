import { canonicalDimensionKeys, type CanonicalDimensionKey } from '@school-workbench/methodology'
import {
  ReadPlaneError,
  type AcceptedJudgmentSummaryDto,
  type BoundedPage,
  type DiagnosisMetadataDto,
  type DiagnosisQuery,
  type EvidenceMetadataDto,
  type EvidenceQuery,
  type ReadPlaneRepository,
  type SchoolDto,
  type StageCurrentDto,
  type StateRecordDto,
} from '@school-workbench/workbench-read-plane'
import type { WorkbenchDatabase } from './database'

const ASSESSMENT_STATUSES = new Set(['unverified', 'far_below', 'partial', 'mostly', 'stable'])
const DIAGNOSIS_TYPES = new Set(['state', 'characteristic', 'mismatch', 'practice'])
const DIAGNOSIS_STATUSES = new Set(['proposed', 'insufficient_evidence'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])

function stale(message: string): never {
  throw new ReadPlaneError('READ_STALE', message)
}

function parseJson(value: string | null, field: string): unknown | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return stale(`Persisted ${field} JSON is malformed`)
  }
}

function assertSchoolScope(value: unknown, schoolId: string, field: string): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.get(value, 'kind') !== 'school' ||
    Reflect.get(value, 'schoolId') !== schoolId
  ) {
    stale(`${field} is outside the requested school scope`)
  }
  return value
}

function previewInlineText(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 240) : null
}

type SchoolRow = {
  id: string
  name: string
  created_at: string
  archived_at: string | null
}

type StageRow = {
  id: string
  school_id: string
  title: string
  summary: string
  focus: string
  sequence: number
  starts_at: string | null
}

type SnapshotRow = {
  id: string
  school_id: string
  stage_id: string | null
  previous_snapshot_id: string | null
  sequence: number
  summary: string
  is_baseline: number
  confirmed_at: string
  created_at: string
}

export class SqliteReadPlaneRepository implements ReadPlaneRepository {
  constructor(private readonly database: WorkbenchDatabase) {}

  async getSchool(schoolId: string): Promise<SchoolDto | null> {
    const row = this.database.client
      .prepare('SELECT id, name, created_at, archived_at FROM schools WHERE id = ?')
      .get(schoolId) as SchoolRow | undefined
    return row
      ? Object.freeze({
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          archivedAt: row.archived_at,
        })
      : null
  }

  async getActiveStage(
    schoolId: string,
  ): Promise<(Extract<StageCurrentDto, { status: 'present' }>['stage']) | null> {
    const row = this.database.client
      .prepare(
        `SELECT id, school_id, title, summary, focus, sequence, starts_at
         FROM stages WHERE school_id = ? AND status = 'active'`,
      )
      .get(schoolId) as StageRow | undefined
    if (!row) return null

    const targetRows = this.database.client
      .prepare(
        `SELECT id, stage_id, school_id, dimension_key, title, description, sequence, status
         FROM stage_targets WHERE stage_id = ? ORDER BY sequence ASC`,
      )
      .all(row.id) as Array<{
      id: string
      stage_id: string
      school_id: string
      dimension_key: string
      title: string
      description: string
      sequence: number
      status: string
    }>

    if (targetRows.length !== canonicalDimensionKeys.length) {
      stale('Active Stage must expose exactly five confirmed targets')
    }
    const dimensions = new Set<string>()
    const targets = targetRows.map((target, index) => {
      if (
        target.school_id !== schoolId ||
        target.stage_id !== row.id ||
        target.status !== 'confirmed' ||
        !canonicalDimensionKeys.includes(target.dimension_key as CanonicalDimensionKey) ||
        target.sequence !== index + 1 ||
        dimensions.has(target.dimension_key)
      ) {
        stale('Active Stage target set is inconsistent')
      }
      dimensions.add(target.dimension_key)
      return Object.freeze({
        id: target.id,
        stageId: target.stage_id,
        dimensionKey: target.dimension_key as CanonicalDimensionKey,
        title: target.title,
        description: target.description,
        sequence: target.sequence,
        status: 'confirmed' as const,
      })
    })
    if (canonicalDimensionKeys.some((key) => !dimensions.has(key))) {
      stale('Active Stage target set is incomplete')
    }

    return Object.freeze({
      id: row.id,
      title: row.title,
      summary: row.summary,
      focus: row.focus,
      sequence: row.sequence,
      startsAt: row.starts_at,
      targets: Object.freeze(targets),
    })
  }

  async getLatestState(schoolId: string): Promise<StateRecordDto | null> {
    const row = this.database.client
      .prepare(
        `SELECT id, school_id, stage_id, previous_snapshot_id, sequence, summary,
                is_baseline, confirmed_at, created_at
         FROM state_snapshots WHERE school_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(schoolId) as SnapshotRow | undefined
    return row ? this.loadState(row) : null
  }

  async listStateHistory(
    schoolId: string,
    query: Readonly<{ limit: number; beforeSequence: number | null }>,
  ): Promise<BoundedPage<StateRecordDto>> {
    const rows = (query.beforeSequence === null
      ? this.database.client
          .prepare(
            `SELECT id, school_id, stage_id, previous_snapshot_id, sequence, summary,
                    is_baseline, confirmed_at, created_at
             FROM state_snapshots WHERE school_id = ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(schoolId, query.limit + 1)
      : this.database.client
          .prepare(
            `SELECT id, school_id, stage_id, previous_snapshot_id, sequence, summary,
                    is_baseline, confirmed_at, created_at
             FROM state_snapshots WHERE school_id = ? AND sequence < ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(schoolId, query.beforeSequence, query.limit + 1)) as SnapshotRow[]

    const hasMore = rows.length > query.limit
    const selected = rows.slice(0, query.limit)
    return Object.freeze({
      items: Object.freeze(selected.map((row) => this.loadState(row))),
      hasMore,
    })
  }

  async listRecentJudgments(
    schoolId: string,
    limit: number,
  ): Promise<readonly AcceptedJudgmentSummaryDto[]> {
    const rows = this.database.client
      .prepare(
        `SELECT aj.id, hr.proposal_id, aj.statement, aj.scope_json, aj.valid_from, aj.valid_to,
                aj.created_at, aj.school_id
         FROM accepted_judgments aj
         JOIN human_reviews hr ON hr.id = aj.review_id
         WHERE aj.school_id = ?
         ORDER BY aj.created_at DESC, aj.id DESC LIMIT ?`,
      )
      .all(schoolId, limit) as Array<{
      id: string
      proposal_id: string
      statement: string
      scope_json: string
      valid_from: string | null
      valid_to: string | null
      created_at: string
      school_id: string
    }>

    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          id: row.id,
          proposalId: row.proposal_id,
          statement: row.statement,
          scope: assertSchoolScope(parseJson(row.scope_json, 'judgment scope'), schoolId, 'Judgment'),
          validFrom: row.valid_from,
          validTo: row.valid_to,
          createdAt: row.created_at,
        }),
      ),
    )
  }

  async listEvidence(
    schoolId: string,
    query: EvidenceQuery,
  ): Promise<BoundedPage<EvidenceMetadataDto>> {
    const rows = (query.before
      ? this.database.client
          .prepare(
            `SELECT id, school_id, source_type, uri, inline_text, title, locator_json, content_hash,
                    captured_at, registered_by, agent_run_id, created_at
             FROM evidence
             WHERE school_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(
            schoolId,
            query.before.createdAt,
            query.before.createdAt,
            query.before.id,
            query.limit + 1,
          )
      : this.database.client
          .prepare(
            `SELECT id, school_id, source_type, uri, inline_text, title, locator_json, content_hash,
                    captured_at, registered_by, agent_run_id, created_at
             FROM evidence WHERE school_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(schoolId, query.limit + 1)) as Array<{
      id: string
      school_id: string
      source_type: string
      uri: string | null
      inline_text: string | null
      title: string
      locator_json: string | null
      content_hash: string | null
      captured_at: string | null
      registered_by: string
      agent_run_id: string | null
      created_at: string
    }>

    const hasMore = rows.length > query.limit
    return Object.freeze({
      items: Object.freeze(
        rows.slice(0, query.limit).map((row) =>
          Object.freeze({
            id: row.id,
            sourceType: row.source_type,
            uri: row.uri,
            title: row.title,
            locator: parseJson(row.locator_json, 'evidence locator'),
            contentHash: row.content_hash,
            capturedAt: row.captured_at,
            registeredBy: row.registered_by,
            agentRunId: row.agent_run_id,
            createdAt: row.created_at,
            preview: previewInlineText(row.inline_text),
          }),
        ),
      ),
      hasMore,
    })
  }

  async listDiagnoses(
    schoolId: string,
    query: DiagnosisQuery,
  ): Promise<BoundedPage<DiagnosisMetadataDto>> {
    const rows = (query.before
      ? this.database.client
          .prepare(
            `SELECT id, school_id, type, title, confidence, status, created_at
             FROM diagnosis_proposals
             WHERE school_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(
            schoolId,
            query.before.createdAt,
            query.before.createdAt,
            query.before.id,
            query.limit + 1,
          )
      : this.database.client
          .prepare(
            `SELECT id, school_id, type, title, confidence, status, created_at
             FROM diagnosis_proposals WHERE school_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(schoolId, query.limit + 1)) as Array<{
      id: string
      school_id: string
      type: string
      title: string
      confidence: string
      status: string
      created_at: string
    }>

    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit).map((row) => this.loadDiagnosis(row, schoolId))
    return Object.freeze({ items: Object.freeze(items), hasMore })
  }

  private loadState(row: SnapshotRow): StateRecordDto {
    if (!row.stage_id) stale('Formal Snapshot is missing its Stage provenance')
    const assessments = this.database.client
      .prepare(
        `SELECT id, snapshot_id, dimension_key, status, summary
         FROM dimension_assessments WHERE snapshot_id = ?`,
      )
      .all(row.id) as Array<{
      id: string
      snapshot_id: string
      dimension_key: string
      status: string
      summary: string
    }>

    if (assessments.length !== canonicalDimensionKeys.length) {
      stale('Formal Snapshot must contain exactly five DimensionAssessments')
    }
    const byDimension = new Map(assessments.map((item) => [item.dimension_key, item]))
    if (byDimension.size !== canonicalDimensionKeys.length) {
      stale('Formal Snapshot contains duplicate DimensionAssessments')
    }

    const snapshotJudgmentRows = this.database.client
      .prepare(
        `SELECT sj.judgment_id, aj.school_id
         FROM snapshot_judgments sj
         JOIN accepted_judgments aj ON aj.id = sj.judgment_id
         WHERE sj.snapshot_id = ?
         ORDER BY aj.created_at DESC, aj.id DESC`,
      )
      .all(row.id) as Array<{ judgment_id: string; school_id: string }>
    if (snapshotJudgmentRows.some((item) => item.school_id !== row.school_id)) {
      stale('Snapshot judgment provenance crosses school scope')
    }
    const judgmentIds = snapshotJudgmentRows.map((item) => item.judgment_id)
    const snapshotJudgments = new Set(judgmentIds)

    const orderedAssessments = canonicalDimensionKeys.map((dimensionKey) => {
      const assessment = byDimension.get(dimensionKey)
      if (!assessment || !ASSESSMENT_STATUSES.has(assessment.status)) {
        stale('Formal Snapshot assessment shape is invalid')
      }
      const links = this.database.client
        .prepare(
          `SELECT aj2.judgment_id, j.school_id
           FROM assessment_judgments aj2
           JOIN accepted_judgments j ON j.id = aj2.judgment_id
           WHERE aj2.assessment_id = ?
           ORDER BY j.created_at DESC, j.id DESC`,
        )
        .all(assessment.id) as Array<{ judgment_id: string; school_id: string }>
      if (
        links.some(
          (link) => link.school_id !== row.school_id || !snapshotJudgments.has(link.judgment_id),
        )
      ) {
        stale('DimensionAssessment judgment provenance is inconsistent')
      }
      if (assessment.status !== 'unverified' && links.length === 0) {
        stale('Verified DimensionAssessment is missing judgment provenance')
      }
      return Object.freeze({
        id: assessment.id,
        dimensionKey,
        status: assessment.status as StateRecordDto['assessments'][number]['status'],
        summary: assessment.summary,
        judgmentIds: Object.freeze(links.map((link) => link.judgment_id)),
      })
    })

    return Object.freeze({
      snapshot: Object.freeze({
        id: row.id,
        schoolId: row.school_id,
        stageId: row.stage_id,
        previousSnapshotId: row.previous_snapshot_id,
        sequence: row.sequence,
        summary: row.summary,
        isBaseline: row.is_baseline === 1,
        confirmedAt: row.confirmed_at,
        createdAt: row.created_at,
      }),
      assessments: Object.freeze(orderedAssessments),
      judgmentIds: Object.freeze(judgmentIds),
    })
  }

  private loadDiagnosis(
    row: {
      id: string
      school_id: string
      type: string
      title: string
      confidence: string
      status: string
      created_at: string
    },
    schoolId: string,
  ): DiagnosisMetadataDto {
    if (
      row.school_id !== schoolId ||
      !DIAGNOSIS_TYPES.has(row.type) ||
      !DIAGNOSIS_STATUSES.has(row.status) ||
      !CONFIDENCE.has(row.confidence)
    ) {
      stale('Diagnosis metadata is malformed or outside school scope')
    }

    const claimRows = this.database.client
      .prepare(
        `SELECT dc.claim_id, c.school_id
         FROM diagnosis_claims dc JOIN claims c ON c.id = dc.claim_id
         WHERE dc.proposal_id = ? ORDER BY dc.claim_id ASC`,
      )
      .all(row.id) as Array<{ claim_id: string; school_id: string }>
    if (claimRows.some((item) => item.school_id !== schoolId)) {
      stale('Diagnosis Claim provenance crosses school scope')
    }

    const criteria = this.database.client
      .prepare(
        `SELECT mc.id AS criterion_id, mc.stable_key, mp.key AS pack_key, mp.version
         FROM diagnosis_criteria dc
         JOIN methodology_criteria mc ON mc.id = dc.criterion_id
         JOIN methodology_packs mp ON mp.id = mc.pack_id
         WHERE dc.proposal_id = ?
         ORDER BY mp.key ASC, mp.version ASC, mc.stable_key ASC`,
      )
      .all(row.id) as Array<{
      criterion_id: string
      stable_key: string
      pack_key: string
      version: string
    }>

    const targetRows = this.database.client
      .prepare(
        `SELECT dst.stage_target_id, st.school_id
         FROM diagnosis_stage_targets dst
         JOIN stage_targets st ON st.id = dst.stage_target_id
         WHERE dst.proposal_id = ? ORDER BY dst.stage_target_id ASC`,
      )
      .all(row.id) as Array<{ stage_target_id: string; school_id: string }>
    if (targetRows.some((item) => item.school_id !== schoolId)) {
      stale('Diagnosis StageTarget provenance crosses school scope')
    }

    return Object.freeze({
      id: row.id,
      type: row.type as DiagnosisMetadataDto['type'],
      title: row.title,
      confidence: row.confidence as DiagnosisMetadataDto['confidence'],
      status: row.status as DiagnosisMetadataDto['status'],
      createdAt: row.created_at,
      claimIds: Object.freeze(claimRows.map((item) => item.claim_id)),
      criteria: Object.freeze(
        criteria.map((item) =>
          Object.freeze({
            criterionId: item.criterion_id,
            stableKey: item.stable_key,
            packKey: item.pack_key,
            version: item.version,
          }),
        ),
      ),
      stageTargetIds: Object.freeze(targetRows.map((item) => item.stage_target_id)),
    })
  }
}
