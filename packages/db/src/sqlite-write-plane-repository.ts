import type { MethodologyRegistry } from '@school-workbench/methodology'
import {
  ReadPlaneError,
  type EvidenceRegistrationDto,
  type RegisterEvidenceCommand,
  type RegisteredRef,
  type WritePlaneRepository,
} from '@school-workbench/workbench-read-plane'
import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import type { WorkbenchDatabase } from './database'

/**
 * Canonical form of a URI for de-duplication (decision L7).
 *
 * Only differences that never change which material is meant are removed: outer
 * whitespace, letter case in the scheme and host (which are case-insensitive by
 * definition), a redundant default port, and a single trailing slash on the
 * path. Query strings and fragments are preserved, because they routinely
 * select a different document or a different place inside one.
 */
export function normalizeEvidenceUri(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed.replace(/\s+/gu, ' ')
  }
  const isDefaultPort =
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  const host = isDefaultPort ? url.hostname : url.host
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/u, '') : url.pathname
  return `${url.protocol.toLowerCase()}//${host.toLowerCase()}${path}${url.search}${url.hash}`
}

/**
 * Canonical form of inline text for de-duplication (decision L7).
 *
 * Unicode is normalised to NFC, line endings are unified, and runs of
 * whitespace collapse to one space, so the same passage pasted twice with
 * different wrapping is recognised as the same material. Nothing else is
 * touched — the stored text itself is never rewritten, only the hash input.
 */
export function normalizeEvidenceInlineText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim()
}

/**
 * Identity of a piece of material within one school (decision L7).
 *
 * The school is not part of the hash input; it is part of the unique index, so
 * two schools may hold the same document without colliding.
 */
export function evidenceContentHash(
  input: Readonly<{ sourceType: string; uri?: string | null; inlineText?: string | null }>,
): string {
  const canonical = [
    input.sourceType,
    normalizeEvidenceUri(input.uri),
    normalizeEvidenceInlineText(input.inlineText),
  ].join('')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

type EvidenceRow = {
  id: string
  school_id: string
  source_type: string
  uri: string | null
  inline_text: string | null
  title: string
  locator_json: string | null
  captured_at: string | null
}

type FactRow = {
  id: string
  school_id: string
  evidence_id: string
  fact_type: string
  text: string
  locator_json: string
  directness: string
}

type ClaimRow = {
  id: string
  school_id: string
  statement: string
  predicate_key: string
}

type ClaimFactRow = { claim_id: string; fact_id: string; stance: string }

type StageRow = { id: string; school_id: string; title: string; status: string }

type StageTargetRow = {
  id: string
  stage_id: string
  school_id: string
  dimension_key: string
  title: string
  description: string
  status: string
}

const evidenceSourceTypes = new Set([
  'feishu_doc',
  'feishu_minutes',
  'audio',
  'local_file',
  'observation',
  'pasted_text',
  'other',
])
const factTypes = new Set(['learner', 'adult_practice', 'organization', 'context'])
const directnessValues = new Set(['low', 'medium', 'high'])
const dimensionKeys = new Set(['leadership', 'key_tasks', 'structure', 'culture', 'capability'])

function unrepresentable(kind: string, id: string, detail: string): never {
  // Fail closed and name the row. An assessment-level "invalid input" error
  // would be technically correct and completely unactionable.
  throw new ReadPlaneError(
    'READ_STALE',
    `Persisted ${kind} ${id} cannot take part in an assessment: ${detail}`,
  )
}

export class SqliteWritePlaneRepository implements WritePlaneRepository {
  constructor(
    private readonly database: WorkbenchDatabase,
    private readonly registry: MethodologyRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => ulid(),
  ) {}

  async registerEvidence(command: RegisterEvidenceCommand): Promise<EvidenceRegistrationDto> {
    const { schoolId, agentRunId, input } = command
    const client = this.database.client

    const run = client.transaction((): EvidenceRegistrationDto => {
      const school = client
        .prepare('SELECT id, archived_at FROM schools WHERE id = ?')
        .get(schoolId) as { id: string; archived_at: string | null } | undefined
      if (!school || school.archived_at) {
        throw new ReadPlaneError('SCHOOL_NOT_FOUND', 'Scoped school was not found')
      }

      const createdAt = this.now()
      const contentHash = evidenceContentHash({
        sourceType: input.sourceType,
        uri: input.uri ?? null,
        inlineText: input.inlineText ?? null,
      })

      // L7: registering the same material twice is normal Agent behaviour, so a
      // duplicate returns the existing identifier instead of an error.
      const existingEvidence = client
        .prepare('SELECT id FROM evidence WHERE school_id = ? AND content_hash = ?')
        .get(schoolId, contentHash) as { id: string } | undefined

      let evidenceId: string
      let reused = false
      if (existingEvidence) {
        evidenceId = existingEvidence.id
        reused = true
      } else {
        evidenceId = this.newId()
        client
          .prepare(
            `INSERT INTO evidence (
               id, school_id, source_type, uri, inline_text, title, locator_json,
               content_hash, captured_at, registered_by, agent_run_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?)`,
          )
          .run(
            evidenceId,
            schoolId,
            input.sourceType,
            input.uri ?? null,
            input.inlineText ?? null,
            input.title,
            input.locator ?? null,
            contentHash,
            input.capturedAt ?? null,
            agentRunId,
            createdAt,
          )
      }

      const factIdsByRef = new Map<string, string>()
      const observationFacts: RegisteredRef[] = []
      for (const fact of input.observationFacts) {
        const existingFact = client
          .prepare(
            `SELECT id FROM observation_facts
              WHERE school_id = ? AND evidence_id = ? AND fact_type = ?
                AND text = ? AND locator_json = ? AND directness = ?`,
          )
          .get(schoolId, evidenceId, fact.factType, fact.text, fact.locator, fact.directness) as
          { id: string } | undefined

        if (existingFact) {
          factIdsByRef.set(fact.ref, existingFact.id)
          observationFacts.push({ ref: fact.ref, id: existingFact.id, reused: true })
          continue
        }

        const factId = this.newId()
        client
          .prepare(
            `INSERT INTO observation_facts (
               id, school_id, evidence_id, fact_type, text, locator_json, directness,
               extracted_by, agent_run_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?)`,
          )
          .run(
            factId,
            schoolId,
            evidenceId,
            fact.factType,
            fact.text,
            fact.locator,
            fact.directness,
            agentRunId,
            createdAt,
          )
        factIdsByRef.set(fact.ref, factId)
        observationFacts.push({ ref: fact.ref, id: factId, reused: false })
      }

      const schoolScope = JSON.stringify({ kind: 'school', schoolId })
      const claims: RegisteredRef[] = []
      for (const claim of input.claims) {
        const resolvedLinks = claim.facts.map((link) => {
          const factId = link.factRef ? factIdsByRef.get(link.factRef) : link.factId
          if (!factId) {
            throw new ReadPlaneError('INPUT_INVALID', 'Claim references an unknown ObservationFact')
          }
          const persisted = client
            .prepare('SELECT id, school_id FROM observation_facts WHERE id = ?')
            .get(factId) as { id: string; school_id: string } | undefined
          if (!persisted || persisted.school_id !== schoolId) {
            // The three-way binding also holds for anything the Agent points at
            // by identifier: a fact from another school is simply not there.
            throw new ReadPlaneError(
              'INPUT_INVALID',
              'Claim references an ObservationFact outside the scoped school',
            )
          }
          return { factId, stance: link.stance }
        })

        const existingClaim = client
          .prepare(
            'SELECT id FROM claims WHERE school_id = ? AND predicate_key = ? AND statement = ?',
          )
          .get(schoolId, claim.predicateKey, claim.statement) as { id: string } | undefined

        const claimId = existingClaim?.id ?? this.newId()
        if (!existingClaim) {
          client
            .prepare(
              `INSERT INTO claims (
                 id, school_id, subject_ref_json, predicate_key, object_ref_json, statement,
                 valid_from, valid_to, scope_json, created_by, agent_run_id, created_at
               ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, 'agent', ?, ?)`,
            )
            .run(
              claimId,
              schoolId,
              schoolScope,
              claim.predicateKey,
              claim.statement,
              createdAt,
              schoolScope,
              agentRunId,
              createdAt,
            )
        }
        claims.push({ ref: claim.ref, id: claimId, reused: Boolean(existingClaim) })

        const nextSequenceRow = client
          .prepare(
            'SELECT COALESCE(MAX(sequence), -1) AS maxSequence FROM claim_facts WHERE claim_id = ?',
          )
          .get(claimId) as { maxSequence: number }
        let sequence = nextSequenceRow.maxSequence + 1
        for (const link of resolvedLinks) {
          const existingLink = client
            .prepare(
              'SELECT claim_id FROM claim_facts WHERE claim_id = ? AND fact_id = ? AND stance = ?',
            )
            .get(claimId, link.factId, link.stance) as { claim_id: string } | undefined
          if (existingLink) continue
          client
            .prepare(
              'INSERT INTO claim_facts (claim_id, fact_id, stance, sequence) VALUES (?, ?, ?, ?)',
            )
            .run(claimId, link.factId, link.stance, sequence)
          sequence += 1
        }
      }

      return Object.freeze({
        evidenceId,
        reused,
        observationFacts: Object.freeze(observationFacts.map((item) => Object.freeze(item))),
        claims: Object.freeze(claims.map((item) => Object.freeze(item))),
      })
    })

    return run()
  }

  /**
   * Builds the `AssessmentInput` from the school's own persisted rows.
   *
   * This is decision L2 in one method: the Agent contributes nothing here. Every
   * Evidence, ObservationFact, Claim and ClaimFact comes out of SQLite, and the
   * methodology context is read from the file registry, so a candidate can only
   * ever cite things the Workbench already holds.
   */
  async buildAssessmentInput(schoolId: string): Promise<unknown> {
    const client = this.database.client

    const school = client
      .prepare('SELECT id, archived_at FROM schools WHERE id = ?')
      .get(schoolId) as { id: string; archived_at: string | null } | undefined
    if (!school || school.archived_at) {
      throw new ReadPlaneError('SCHOOL_NOT_FOUND', 'Scoped school was not found')
    }

    const stage = client
      .prepare(
        "SELECT id, school_id, title, status FROM stages WHERE school_id = ? AND status = 'active'",
      )
      .get(schoolId) as StageRow | undefined
    if (!stage) {
      // Without a current Stage there is nothing to judge against, and SPEC 74
      // puts stage-target comparison in the middle of the pipeline.
      throw new ReadPlaneError(
        'READ_STALE',
        'This school has no active Stage, so a diagnosis cannot be grounded yet',
      )
    }

    const targets = client
      .prepare(
        `SELECT id, stage_id, school_id, dimension_key, title, description, status
           FROM stage_targets WHERE stage_id = ? AND status = 'confirmed'
          ORDER BY sequence`,
      )
      .all(stage.id) as StageTargetRow[]
    if (targets.length === 0) {
      throw new ReadPlaneError(
        'READ_STALE',
        'The current Stage has no confirmed targets, so a diagnosis cannot be grounded yet',
      )
    }

    const evidenceRows = client
      .prepare(
        `SELECT id, school_id, source_type, uri, inline_text, title, locator_json, captured_at
           FROM evidence WHERE school_id = ? ORDER BY created_at, id`,
      )
      .all(schoolId) as EvidenceRow[]
    const factRows = client
      .prepare(
        `SELECT id, school_id, evidence_id, fact_type, text, locator_json, directness
           FROM observation_facts WHERE school_id = ? ORDER BY created_at, id`,
      )
      .all(schoolId) as FactRow[]
    const claimRows = client
      .prepare(
        `SELECT id, school_id, statement, predicate_key
           FROM claims WHERE school_id = ? ORDER BY created_at, id`,
      )
      .all(schoolId) as ClaimRow[]
    const claimFactRows =
      claimRows.length === 0
        ? []
        : (client
            .prepare(
              `SELECT claim_id, fact_id, stance FROM claim_facts
                WHERE claim_id IN (${claimRows.map(() => '?').join(', ')})
                ORDER BY claim_id, sequence`,
            )
            .all(...claimRows.map((row) => row.id)) as ClaimFactRow[])

    for (const target of targets) {
      if (!dimensionKeys.has(target.dimension_key)) {
        unrepresentable('StageTarget', target.id, `unknown dimension ${target.dimension_key}`)
      }
    }
    for (const row of evidenceRows) {
      if (!evidenceSourceTypes.has(row.source_type)) {
        unrepresentable('Evidence', row.id, `unknown source type ${row.source_type}`)
      }
    }
    for (const row of factRows) {
      if (!factTypes.has(row.fact_type)) {
        unrepresentable('ObservationFact', row.id, `unknown fact type ${row.fact_type}`)
      }
      if (!directnessValues.has(row.directness)) {
        unrepresentable('ObservationFact', row.id, `unknown directness ${row.directness}`)
      }
    }

    return {
      protocolVersion: 1,
      school: { kind: 'school', schoolId },
      activeStage: {
        id: stage.id,
        schoolId: stage.school_id,
        title: stage.title,
        status: 'active',
      },
      confirmedStageTargets: targets.map((target) => ({
        id: target.id,
        stageId: target.stage_id,
        schoolId: target.school_id,
        dimensionKey: target.dimension_key,
        title: target.title,
        description: target.description,
        status: 'confirmed',
      })),
      evidence: evidenceRows.map((row) => ({
        kind: 'evidence',
        id: row.id,
        schoolId: row.school_id,
        sourceType: row.source_type,
        title: row.title,
        uri: row.uri,
        inlineText: row.inline_text,
        locator: row.locator_json,
        capturedAt: row.captured_at,
      })),
      observationFacts: factRows.map((row) => ({
        kind: 'observation_fact',
        id: row.id,
        schoolId: row.school_id,
        evidenceId: row.evidence_id,
        factType: row.fact_type,
        text: row.text,
        locator: row.locator_json,
        directness: row.directness,
      })),
      claims: claimRows.map((row) => ({
        kind: 'claim',
        id: row.id,
        schoolId: row.school_id,
        statement: row.statement,
        predicateKey: row.predicate_key,
        scope: { kind: 'school', schoolId },
      })),
      claimFacts: claimFactRows.map((row) => ({
        claimId: row.claim_id,
        factId: row.fact_id,
        stance: row.stance,
      })),
      // Every criterion of every active pack. A pack the consultant sent back
      // for revision is not active, so its criteria simply are not offered and
      // any candidate citing one is refused (invariant: the veto is real).
      methodologyContext: this.registry
        .listPacks()
        .filter((pack) => pack.status === 'active')
        .flatMap((pack) =>
          pack.criteria.map((criterion) => ({
            packKey: pack.key,
            version: pack.version,
            criterionId: criterion.id,
          })),
        ),
    }
  }
}
