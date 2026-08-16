import type {
  AcceptedJudgment,
  DiagnosisProposal,
  JudgmentRepository,
  ProposalChain,
  ReviewOutcome,
} from '@school-workbench/domain'
import { desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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
  if (!row.provisionalJudgment) throw new Error('Persisted proposal is missing a judgment')

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

function assertProposalChain(chain: ProposalChain): void {
  const schoolId = chain.proposal.schoolId
  const wrongSchool = [
    ...chain.evidence.map((item) => item.schoolId),
    ...chain.facts.map((item) => item.schoolId),
    ...chain.claims.map((item) => item.schoolId),
  ].find((value) => value !== schoolId)
  if (wrongSchool) throw new Error('不能跨学校保存判断链')

  if (chain.evidence.some((item) => !item.uri && !item.inlineText)) {
    throw new Error('依据必须包含可定位来源或原始内容')
  }
  if (chain.claimFacts.every((item) => item.stance !== 'supporting')) {
    throw new Error('判断至少需要一条支持事实')
  }
}

export class SqliteJudgmentRepository implements JudgmentRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  async saveProposalChain(chain: ProposalChain): Promise<void> {
    assertProposalChain(chain)
    this.database.transaction((tx) => {
      for (const item of chain.evidence) tx.insert(evidence).values(item).run()
      for (const item of chain.facts) tx.insert(observationFacts).values(item).run()
      for (const item of chain.claims) tx.insert(claims).values(item).run()
      for (const item of chain.claimFacts) tx.insert(claimFacts).values(item).run()

      tx.insert(diagnosisProposals)
        .values({
          id: chain.proposal.id,
          schoolId: chain.proposal.schoolId,
          agentRunId: chain.proposal.agentRunId,
          type: chain.proposal.type,
          title: chain.proposal.title,
          scopeJson: chain.proposal.scopeJson,
          interpretationsJson: JSON.stringify(chain.proposal.interpretations),
          provisionalJudgment: chain.proposal.provisionalJudgment,
          mechanism: chain.proposal.mechanism,
          alternativeHypothesesJson: JSON.stringify(chain.proposal.alternativeHypotheses),
          unresolvedQuestionsJson: JSON.stringify(chain.proposal.unresolvedQuestions),
          recommendedActionsJson: JSON.stringify(chain.proposal.recommendedActions),
          nextObservationsJson: JSON.stringify(chain.proposal.nextObservations),
          impactEvidencePlanJson: JSON.stringify(chain.proposal.impactEvidencePlan),
          evidenceQualityJson: JSON.stringify(chain.proposal.evidenceQuality),
          confidence: chain.proposal.confidence,
          status: chain.proposal.status,
          createdAt: chain.proposal.createdAt,
        })
        .run()

      for (const item of chain.diagnosisClaims) {
        tx.insert(diagnosisClaims).values(item).run()
      }
    })
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
