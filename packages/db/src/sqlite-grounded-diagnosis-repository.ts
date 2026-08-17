import {
  GroundedDiagnosisProtocolError,
  type GroundedDiagnosisPersistenceRequest,
  type GroundedDiagnosisRepository,
  type GroundedMethodologyExpectation,
} from '@school-workbench/application'
import { protocolError, type AssessmentErrorCode } from '@school-workbench/assessment'
import type { DiagnosisProposal, GroundedDiagnosisRecord } from '@school-workbench/domain'
import { and, eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { diagnosisCriteria, diagnosisStageTargets } from './diagnosis-schema'
import { methodologyCriteria, methodologyPacks } from './methodology-schema'
import {
  claimFacts,
  claims,
  diagnosisClaims,
  diagnosisProposals,
  evidence,
  observationFacts,
  schools,
  stageTargets,
  stages,
} from './schema'

type Transaction = Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0]

function fail(code: AssessmentErrorCode, path: string, message: string): never {
  throw new GroundedDiagnosisProtocolError([protocolError(code, path, message)])
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid persisted string array')
  }
  return parsed
}

function toProposal(row: typeof diagnosisProposals.$inferSelect): DiagnosisProposal {
  if (row.status !== 'proposed' && row.status !== 'insufficient_evidence') {
    throw new Error(`Unsupported diagnosis status: ${row.status}`)
  }
  if (!['low', 'medium', 'high'].includes(row.confidence)) {
    throw new Error(`Unsupported confidence: ${row.confidence}`)
  }
  if (!['state', 'characteristic', 'mismatch', 'practice'].includes(row.type)) {
    throw new Error(`Unsupported diagnosis type: ${row.type}`)
  }
  if (row.status === 'proposed' && !row.provisionalJudgment) {
    throw new Error('Persisted proposed diagnosis is missing a judgment')
  }
  if (row.status === 'insufficient_evidence' && row.provisionalJudgment !== null) {
    throw new Error('Persisted insufficient-evidence diagnosis carries a judgment')
  }

  return {
    id: row.id,
    schoolId: row.schoolId,
    agentRunId: row.agentRunId,
    type: row.type as DiagnosisProposal['type'],
    title: row.title,
    scopeJson: row.scopeJson,
    interpretations: parseStringArray(row.interpretationsJson),
    provisionalJudgment: row.provisionalJudgment,
    mechanism: row.mechanism,
    alternativeHypotheses: parseStringArray(row.alternativeHypothesesJson),
    unresolvedQuestions: parseStringArray(row.unresolvedQuestionsJson),
    recommendedActions: parseStringArray(row.recommendedActionsJson),
    nextObservations: parseStringArray(row.nextObservationsJson),
    impactEvidencePlan: parseStringArray(row.impactEvidencePlanJson),
    evidenceQuality: JSON.parse(row.evidenceQualityJson) as DiagnosisProposal['evidenceQuality'],
    confidence: row.confidence as DiagnosisProposal['confidence'],
    status: row.status as DiagnosisProposal['status'],
    createdAt: row.createdAt,
  }
}

function sameNullable(left: string | null, right: string | null): boolean {
  return left === right
}

function sameScopeJson(value: string, schoolId: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Reflect.get(parsed, 'kind') === 'school' &&
      Reflect.get(parsed, 'schoolId') === schoolId
    )
  } catch {
    return false
  }
}

function tupleKey(claimId: string, factId: string, stance: string): string {
  return `${claimId}\u0000${factId}\u0000${stance}`
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

function assertPersistedInput(tx: Transaction, request: GroundedDiagnosisPersistenceRequest): void {
  const { input, proposal } = request
  const schoolId = input.school.schoolId
  if (proposal.schoolId !== schoolId) {
    fail(
      'ASSESSMENT_SCHOOL_SCOPE_MISMATCH',
      '$.proposal.schoolId',
      'Proposal school scope does not match validated AssessmentInput.',
    )
  }

  const school = tx.select().from(schools).where(eq(schools.id, schoolId)).get()
  if (!school || school.archivedAt) {
    fail(
      'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
      '$.school',
      'Assessment school no longer exists as an active persisted school.',
    )
  }

  const stage = tx.select().from(stages).where(eq(stages.id, input.activeStage.id)).get()
  if (!stage || stage.schoolId !== schoolId || stage.status !== 'active') {
    fail(
      'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
      '$.activeStage',
      'Assessment Stage is no longer the current active Stage for this school.',
    )
  }

  for (const [index, target] of input.confirmedStageTargets.entries()) {
    const persisted = tx.select().from(stageTargets).where(eq(stageTargets.id, target.id)).get()
    if (
      !persisted ||
      persisted.schoolId !== schoolId ||
      persisted.stageId !== stage.id ||
      persisted.status !== 'confirmed' ||
      persisted.dimensionKey !== target.dimensionKey ||
      persisted.title !== target.title ||
      persisted.description !== target.description
    ) {
      fail(
        'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
        `$.confirmedStageTargets[${index}]`,
        `StageTarget ${target.id} is stale, unconfirmed, or outside the active Stage.`,
      )
    }
  }

  for (const [index, item] of input.evidence.entries()) {
    const persisted = tx.select().from(evidence).where(eq(evidence.id, item.id)).get()
    if (
      !persisted ||
      persisted.schoolId !== schoolId ||
      persisted.sourceType !== item.sourceType ||
      persisted.title !== item.title ||
      !sameNullable(persisted.uri, item.uri) ||
      !sameNullable(persisted.inlineText, item.inlineText) ||
      !sameNullable(persisted.locatorJson, item.locator) ||
      !sameNullable(persisted.capturedAt, item.capturedAt)
    ) {
      fail(
        'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
        `$.evidence[${index}]`,
        `Evidence ${item.id} does not match the persisted school record.`,
      )
    }
  }

  for (const [index, fact] of input.observationFacts.entries()) {
    const persisted = tx
      .select()
      .from(observationFacts)
      .where(eq(observationFacts.id, fact.id))
      .get()
    if (
      !persisted ||
      persisted.schoolId !== schoolId ||
      persisted.evidenceId !== fact.evidenceId ||
      persisted.factType !== fact.factType ||
      persisted.text !== fact.text ||
      persisted.locatorJson !== fact.locator ||
      persisted.directness !== fact.directness
    ) {
      fail(
        'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
        `$.observationFacts[${index}]`,
        `ObservationFact ${fact.id} does not match the persisted school record.`,
      )
    }
  }

  for (const [index, claim] of input.claims.entries()) {
    const persisted = tx.select().from(claims).where(eq(claims.id, claim.id)).get()
    if (
      !persisted ||
      persisted.schoolId !== schoolId ||
      persisted.statement !== claim.statement ||
      persisted.predicateKey !== claim.predicateKey ||
      !sameScopeJson(persisted.scopeJson, schoolId)
    ) {
      fail(
        'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
        `$.claims[${index}]`,
        `Claim ${claim.id} does not match the persisted school record.`,
      )
    }
  }

  if (input.claims.length > 0) {
    const claimIds = input.claims.map((claim) => claim.id)
    const persistedLinks = tx
      .select()
      .from(claimFacts)
      .where(inArray(claimFacts.claimId, claimIds))
      .all()
    const persistedSet = new Set(
      persistedLinks.map((link) => tupleKey(link.claimId, link.factId, link.stance)),
    )
    const inputSet = new Set(
      input.claimFacts.map((link) => tupleKey(link.claimId, link.factId, link.stance)),
    )
    if (!sameSet(persistedSet, inputSet)) {
      fail(
        'ASSESSMENT_FACT_STANCE_MISMATCH',
        '$.claimFacts',
        'Persisted ClaimFact relations changed after the candidate was produced.',
      )
    }
  } else if (input.claimFacts.length > 0) {
    fail(
      'ASSESSMENT_FACT_STANCE_MISMATCH',
      '$.claimFacts',
      'AssessmentInput contains ClaimFact relations without persisted Claims.',
    )
  }
}

function resolveCriterion(tx: Transaction, expectation: GroundedMethodologyExpectation): string {
  const pack = tx
    .select()
    .from(methodologyPacks)
    .where(
      and(
        eq(methodologyPacks.key, expectation.packKey),
        eq(methodologyPacks.version, expectation.version),
      ),
    )
    .get()
  if (
    !pack ||
    pack.id !== expectation.packId ||
    pack.status !== 'active' ||
    pack.contentHash !== expectation.packContentHash ||
    pack.sourceFingerprint !== expectation.packSourceFingerprint
  ) {
    fail(
      'ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH',
      '$.methodologyContext',
      `Persisted methodology ${expectation.packKey}@${expectation.version} is missing, inactive, or differs from the active file registry.`,
    )
  }

  const criterion = tx
    .select()
    .from(methodologyCriteria)
    .where(
      and(
        eq(methodologyCriteria.packId, pack.id),
        eq(methodologyCriteria.stableKey, expectation.criterion.stableKey),
      ),
    )
    .get()
  const expected = expectation.criterion
  const criterionMatches =
    criterion?.id === expected.id &&
    criterion.parentId === expectation.expectedParentRowId &&
    criterion.constructKey === expected.constructKey &&
    criterion.dimensionKey === expected.dimensionKey &&
    criterion.practiceType === expected.practiceType &&
    criterion.title === expected.title &&
    criterion.description === expected.description &&
    criterion.evidenceGuidanceJson === JSON.stringify(expected.evidenceGuidance) &&
    criterion.counterIndicatorsJson === JSON.stringify(expected.counterIndicators) &&
    criterion.guardrailsJson ===
      JSON.stringify({
        applicability: expected.applicability,
        inferenceGuardrails: expected.guardrails,
      }) &&
    criterion.sourceLocatorJson === JSON.stringify(expected.sourceLocator) &&
    criterion.sequence === expected.sequence
  if (!criterion || !criterionMatches) {
    fail(
      'ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH',
      '$.candidate.criterionMappings',
      `Persisted criterion ${expected.stableKey} does not match the active file registry.`,
    )
  }
  return criterion.id
}

function immutableRecord(record: GroundedDiagnosisRecord): GroundedDiagnosisRecord {
  return Object.freeze({
    proposal: Object.freeze({
      ...record.proposal,
      interpretations: Object.freeze([...record.proposal.interpretations]),
      alternativeHypotheses: Object.freeze([...record.proposal.alternativeHypotheses]),
      unresolvedQuestions: Object.freeze([...record.proposal.unresolvedQuestions]),
      recommendedActions: Object.freeze([...record.proposal.recommendedActions]),
      nextObservations: Object.freeze([...record.proposal.nextObservations]),
      impactEvidencePlan: Object.freeze([...record.proposal.impactEvidencePlan]),
      evidenceQuality: Object.freeze({ ...record.proposal.evidenceQuality }),
    }),
    claimIds: Object.freeze([...record.claimIds]),
    criteria: Object.freeze(record.criteria.map((criterion) => Object.freeze({ ...criterion }))),
    stageTargetIds: Object.freeze([...record.stageTargetIds]),
  }) as unknown as GroundedDiagnosisRecord
}

export class SqliteGroundedDiagnosisRepository implements GroundedDiagnosisRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  async saveGroundedProposal(
    request: GroundedDiagnosisPersistenceRequest,
  ): Promise<GroundedDiagnosisRecord> {
    this.database.transaction((tx) => {
      const duplicate = tx
        .select({ id: diagnosisProposals.id })
        .from(diagnosisProposals)
        .where(eq(diagnosisProposals.id, request.proposal.id))
        .get()
      if (duplicate) {
        fail(
          'ASSESSMENT_PROPOSAL_ID_CONFLICT',
          '$.proposal.id',
          `Diagnosis proposal ${request.proposal.id} already exists and is immutable.`,
        )
      }

      assertPersistedInput(tx, request)

      const criterionIds = request.methodology.map((expectation) =>
        resolveCriterion(tx, expectation),
      )

      tx.insert(diagnosisProposals)
        .values({
          id: request.proposal.id,
          schoolId: request.proposal.schoolId,
          agentRunId: request.proposal.agentRunId,
          type: request.proposal.type,
          title: request.proposal.title,
          scopeJson: request.proposal.scopeJson,
          interpretationsJson: JSON.stringify(request.proposal.interpretations),
          provisionalJudgment: request.proposal.provisionalJudgment,
          mechanism: request.proposal.mechanism,
          alternativeHypothesesJson: JSON.stringify(request.proposal.alternativeHypotheses),
          unresolvedQuestionsJson: JSON.stringify(request.proposal.unresolvedQuestions),
          recommendedActionsJson: JSON.stringify(request.proposal.recommendedActions),
          nextObservationsJson: JSON.stringify(request.proposal.nextObservations),
          impactEvidencePlanJson: JSON.stringify(request.proposal.impactEvidencePlan),
          evidenceQualityJson: JSON.stringify(request.proposal.evidenceQuality),
          confidence: request.proposal.confidence,
          status: request.proposal.status,
          createdAt: request.proposal.createdAt,
        })
        .run()

      for (const claimId of request.candidate.claimRefs) {
        tx.insert(diagnosisClaims).values({ proposalId: request.proposal.id, claimId }).run()
      }
      for (const criterionId of criterionIds) {
        tx.insert(diagnosisCriteria).values({ proposalId: request.proposal.id, criterionId }).run()
      }
      for (const stageTargetId of request.candidate.stageTargetRefs) {
        tx.insert(diagnosisStageTargets)
          .values({ proposalId: request.proposal.id, stageTargetId })
          .run()
      }
    })

    const saved = await this.findGroundedProposal(request.proposal.id)
    if (!saved) throw new Error('Grounded diagnosis disappeared after commit')
    return saved
  }

  async findGroundedProposal(id: string): Promise<GroundedDiagnosisRecord | null> {
    const row = this.database
      .select()
      .from(diagnosisProposals)
      .where(eq(diagnosisProposals.id, id))
      .get()
    if (!row) return null

    const claimIds = this.database
      .select({ claimId: diagnosisClaims.claimId })
      .from(diagnosisClaims)
      .where(eq(diagnosisClaims.proposalId, id))
      .orderBy(diagnosisClaims.claimId)
      .all()
      .map((item) => item.claimId)

    const criteria = this.database
      .select({
        criterionId: methodologyCriteria.id,
        stableKey: methodologyCriteria.stableKey,
        packKey: methodologyPacks.key,
        version: methodologyPacks.version,
      })
      .from(diagnosisCriteria)
      .innerJoin(methodologyCriteria, eq(diagnosisCriteria.criterionId, methodologyCriteria.id))
      .innerJoin(methodologyPacks, eq(methodologyCriteria.packId, methodologyPacks.id))
      .where(eq(diagnosisCriteria.proposalId, id))
      .orderBy(methodologyPacks.key, methodologyPacks.version, methodologyCriteria.stableKey)
      .all()
      .map((item) => ({
        criterionId: item.criterionId,
        packKey: item.packKey,
        version: item.version,
        stableKey: item.stableKey,
      }))

    const stageTargetIds = this.database
      .select({ stageTargetId: diagnosisStageTargets.stageTargetId })
      .from(diagnosisStageTargets)
      .where(eq(diagnosisStageTargets.proposalId, id))
      .orderBy(diagnosisStageTargets.stageTargetId)
      .all()
      .map((item) => item.stageTargetId)

    return immutableRecord({
      proposal: toProposal(row),
      claimIds,
      criteria,
      stageTargetIds,
    })
  }
}
