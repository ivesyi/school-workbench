import {
  assertReviewDecisionAllowed,
  type AcceptedJudgment,
  type Claim,
  type DiagnosisProposal,
  type Evidence,
  type JudgmentRepository,
  type ObservationFact,
  type PendingProposalCriterion,
  type PendingProposalReview,
  type PendingProposalStageTarget,
  type ReviewOutcome,
} from '@school-workbench/domain'
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { diagnosisCriteria, diagnosisStageTargets } from './diagnosis-schema'
import { methodologyCriteria, methodologyPacks } from './methodology-schema'
import {
  acceptedJudgments,
  claimFacts,
  claims,
  diagnosisClaims,
  diagnosisProposals,
  evidence,
  humanReviews,
  judgmentClaims,
  observationFacts,
  schools,
  stageTargets,
  stages,
} from './schema'

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

function toAcceptedJudgment(
  row: typeof acceptedJudgments.$inferSelect,
  proposalId: string,
): AcceptedJudgment {
  return {
    id: row.id,
    schoolId: row.schoolId,
    proposalId,
    reviewId: row.reviewId,
    statement: row.statement,
    scopeJson: row.scopeJson,
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt,
  }
}

export class SqliteJudgmentRepository implements JudgmentRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  /**
   * Rebuilds a pending proposal and the chain under it.
   *
   * Returns null once the proposal has been reviewed: the review surface is for
   * judgements still waiting on the consultant, and a proposal that already has
   * a review cannot be decided again.
   */
  async findPendingProposalReview(proposalId: string): Promise<PendingProposalReview | null> {
    const proposal = await this.findProposal(proposalId)
    if (!proposal) return null

    const reviewed = this.database
      .select({ id: humanReviews.id })
      .from(humanReviews)
      .where(eq(humanReviews.proposalId, proposalId))
      .get()
    if (reviewed) return null

    const claimIds = this.database
      .select({ claimId: diagnosisClaims.claimId })
      .from(diagnosisClaims)
      .where(eq(diagnosisClaims.proposalId, proposalId))
      .all()
      .map((row) => row.claimId)

    const claimRows: Claim[] =
      claimIds.length === 0
        ? []
        : (this.database.select().from(claims).where(inArray(claims.id, claimIds)).all() as Claim[])

    const links =
      claimIds.length === 0
        ? []
        : this.database
            .select()
            .from(claimFacts)
            .where(inArray(claimFacts.claimId, claimIds))
            .orderBy(claimFacts.sequence)
            .all()

    const factIds = [...new Set(links.map((link) => link.factId))]
    const factRows: ObservationFact[] =
      factIds.length === 0
        ? []
        : (this.database
            .select()
            .from(observationFacts)
            .where(inArray(observationFacts.id, factIds))
            .all() as ObservationFact[])
    const factById = new Map(factRows.map((fact) => [fact.id, fact]))

    const pickFacts = (stance: 'supporting' | 'counter'): ObservationFact[] => {
      const ordered: ObservationFact[] = []
      const seen = new Set<string>()
      for (const link of links) {
        if (link.stance !== stance || seen.has(link.factId)) continue
        const fact = factById.get(link.factId)
        if (!fact) continue
        seen.add(link.factId)
        ordered.push(fact)
      }
      return ordered
    }

    const evidenceIds = [...new Set(factRows.map((fact) => fact.evidenceId))]
    const evidenceRows: Evidence[] =
      evidenceIds.length === 0
        ? []
        : (this.database
            .select()
            .from(evidence)
            .where(inArray(evidence.id, evidenceIds))
            .all() as Evidence[])

    const targetRows: PendingProposalStageTarget[] = this.database
      .select({
        id: stageTargets.id,
        dimensionKey: stageTargets.dimensionKey,
        title: stageTargets.title,
        description: stageTargets.description,
        sequence: stageTargets.sequence,
      })
      .from(diagnosisStageTargets)
      .innerJoin(stageTargets, eq(diagnosisStageTargets.stageTargetId, stageTargets.id))
      .where(eq(diagnosisStageTargets.proposalId, proposalId))
      .orderBy(asc(stageTargets.sequence))
      .all()
      .map((row) => ({
        id: row.id,
        dimensionKey: row.dimensionKey,
        title: row.title,
        description: row.description,
      }))

    const criteriaRows: PendingProposalCriterion[] = this.database
      .select({
        id: methodologyCriteria.id,
        stableKey: methodologyCriteria.stableKey,
        title: methodologyCriteria.title,
        description: methodologyCriteria.description,
        sequence: methodologyCriteria.sequence,
        packTitle: methodologyPacks.title,
        packKey: methodologyPacks.key,
        packVersion: methodologyPacks.version,
      })
      .from(diagnosisCriteria)
      .innerJoin(methodologyCriteria, eq(diagnosisCriteria.criterionId, methodologyCriteria.id))
      .innerJoin(methodologyPacks, eq(methodologyCriteria.packId, methodologyPacks.id))
      .where(eq(diagnosisCriteria.proposalId, proposalId))
      .orderBy(asc(methodologyPacks.key), asc(methodologyCriteria.sequence))
      .all()
      .map((row) => ({
        id: row.id,
        stableKey: row.stableKey,
        title: row.title,
        description: row.description,
        packTitle: row.packTitle,
        packKey: row.packKey,
        packVersion: row.packVersion,
      }))

    const school = this.database
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, proposal.schoolId))
      .get()

    // The stage a judgement was measured against is the one its confirmed
    // targets belong to. The assessment contract guarantees a `proposed`
    // proposal has at least one, so the fallback only covers abstentions.
    const stageRow =
      targetRows.length === 0
        ? undefined
        : this.database
            .select({ title: stages.title })
            .from(stageTargets)
            .innerJoin(stages, eq(stageTargets.stageId, stages.id))
            .where(
              inArray(
                stageTargets.id,
                targetRows.map((target) => target.id),
              ),
            )
            .get()

    return {
      proposal,
      schoolName: school?.name ?? '这所学校',
      stageTitle: stageRow?.title ?? '尚未确认的阶段',
      evidence: evidenceRows,
      supportingFacts: pickFacts('supporting'),
      counterFacts: pickFacts('counter'),
      claims: claimRows,
      criteria: criteriaRows,
      stageTargets: targetRows,
    }
  }

  /**
   * Proposed rows this school still has no review for. Newest first. This only
   * reads; the write path that created those rows is unchanged.
   */
  async listPendingProposalReviews(schoolId: string): Promise<PendingProposalReview[]> {
    const rows = this.database
      .select({ id: diagnosisProposals.id })
      .from(diagnosisProposals)
      .leftJoin(humanReviews, eq(humanReviews.proposalId, diagnosisProposals.id))
      .where(
        and(
          eq(diagnosisProposals.schoolId, schoolId),
          eq(diagnosisProposals.status, 'proposed'),
          isNull(humanReviews.id),
        ),
      )
      .orderBy(desc(diagnosisProposals.createdAt), desc(diagnosisProposals.id))
      .all()

    const reviews: PendingProposalReview[] = []
    for (const row of rows) {
      const review = await this.findPendingProposalReview(row.id)
      if (review) reviews.push(review)
    }
    return reviews
  }

  async findLatestProposalIdByAgentRun(agentRunId: string): Promise<string | null> {
    const row = this.database
      .select({ id: diagnosisProposals.id })
      .from(diagnosisProposals)
      .where(
        and(
          eq(diagnosisProposals.agentRunId, agentRunId),
          isNotNull(diagnosisProposals.agentRunId),
        ),
      )
      .orderBy(desc(diagnosisProposals.createdAt), desc(diagnosisProposals.id))
      .limit(1)
      .get()
    return row?.id ?? null
  }

  async findProposal(id: string): Promise<DiagnosisProposal | null> {
    const row = this.database
      .select()
      .from(diagnosisProposals)
      .where(eq(diagnosisProposals.id, id))
      .get()
    return row ? toProposal(row) : null
  }

  async saveReviewOutcome(outcome: ReviewOutcome): Promise<void> {
    this.database.transaction((tx) => {
      const existing = tx
        .select({ id: humanReviews.id })
        .from(humanReviews)
        .where(eq(humanReviews.proposalId, outcome.review.proposalId))
        .get()
      if (existing) throw new Error('这个判断已经确认过了')

      const proposalRow = tx
        .select()
        .from(diagnosisProposals)
        .where(eq(diagnosisProposals.id, outcome.review.proposalId))
        .get()
      if (!proposalRow) throw new Error('没有找到这个待确认判断')
      const proposal = toProposal(proposalRow)
      assertReviewDecisionAllowed(proposal, outcome.review.decision)

      const shouldCreateAcceptedJudgment =
        outcome.review.decision === 'accepted' || outcome.review.decision === 'modified'
      if (shouldCreateAcceptedJudgment !== Boolean(outcome.acceptedJudgment)) {
        throw new Error('审核结果与 AcceptedJudgment 不一致')
      }
      if (
        outcome.acceptedJudgment &&
        (outcome.acceptedJudgment.schoolId !== proposal.schoolId ||
          outcome.acceptedJudgment.proposalId !== proposal.id ||
          outcome.acceptedJudgment.reviewId !== outcome.review.id)
      ) {
        throw new Error('AcceptedJudgment 与审核作用域不一致')
      }

      tx.insert(humanReviews).values(outcome.review).run()
      if (!outcome.acceptedJudgment) return

      tx.insert(acceptedJudgments)
        .values({
          id: outcome.acceptedJudgment.id,
          schoolId: outcome.acceptedJudgment.schoolId,
          reviewId: outcome.acceptedJudgment.reviewId,
          statement: outcome.acceptedJudgment.statement,
          scopeJson: outcome.acceptedJudgment.scopeJson,
          validFrom: outcome.acceptedJudgment.validFrom,
          validTo: outcome.acceptedJudgment.validTo,
          createdAt: outcome.acceptedJudgment.createdAt,
        })
        .run()

      const links = tx
        .select({ claimId: diagnosisClaims.claimId })
        .from(diagnosisClaims)
        .where(eq(diagnosisClaims.proposalId, outcome.review.proposalId))
        .all()
      for (const link of links) {
        tx.insert(judgmentClaims)
          .values({
            judgmentId: outcome.acceptedJudgment.id,
            claimId: link.claimId,
          })
          .run()
      }
    })
  }

  async listAcceptedJudgments(schoolId: string): Promise<AcceptedJudgment[]> {
    return this.database
      .select({ judgment: acceptedJudgments, proposalId: humanReviews.proposalId })
      .from(acceptedJudgments)
      .innerJoin(humanReviews, eq(acceptedJudgments.reviewId, humanReviews.id))
      .where(eq(acceptedJudgments.schoolId, schoolId))
      .orderBy(desc(acceptedJudgments.createdAt))
      .all()
      .map((row) => toAcceptedJudgment(row.judgment, row.proposalId))
  }
}
