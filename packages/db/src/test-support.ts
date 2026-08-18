import { GroundedDiagnosisService } from '@school-workbench/application'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { WorkbenchWriteCapabilityService } from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import type { WorkbenchDatabase } from './database'
import { SqliteGroundedDiagnosisRepository } from './sqlite-grounded-diagnosis-repository'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteWritePlaneRepository } from './sqlite-write-plane-repository'

/**
 * Fixtures for repository tests. **Never imported by production code** — an
 * architecture test asserts as much.
 *
 * Two kinds live here, and the difference matters:
 *
 *  - `submitAssistantProposal` goes through the *real* strict path: the write
 *    plane, the assessment contract and `GroundedDiagnosisService`. It is how a
 *    judgement is produced anywhere, tests included.
 *  - `insertAcceptedJudgmentFixture` writes rows directly. It exists only to set
 *    up a *precondition* for slices that are not about producing judgements
 *    (stage recommendation, school state), where going through the contract
 *    would be circular: the contract needs a confirmed stage, and those slices
 *    are the ones that create it.
 */

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

export const FIXTURE_NOW = '2026-08-18T00:00:00.000Z'

export function activeMethodologyRegistry(): MethodologyRegistry {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base.listPacks().map((pack) => ({ ...pack, status: 'active' }) as MethodologyPack),
  )
}

export function seedSchool(
  database: WorkbenchDatabase,
  options: Readonly<{ schoolId: string; name?: string }>,
): void {
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(options.schoolId, options.name ?? '南山实验学校', FIXTURE_NOW)
}

/**
 * A school that already has a confirmed stage — the state the assessment
 * contract requires before any judgement can be grounded.
 */
export function seedActiveStage(
  database: WorkbenchDatabase,
  options: Readonly<{
    schoolId: string
    stageId?: string
    stageTitle?: string
    targetId?: string
    targetTitle?: string
    targetDescription?: string
  }>,
): Readonly<{ stageId: string; targetId: string }> {
  const stageId = options.stageId ?? 'stage-1'
  const targetId = options.targetId ?? 'target-1'
  database.client
    .prepare(
      `INSERT INTO stages (id, school_id, title, summary, focus, sequence, status, starts_at,
                           ends_at, adjustment_feedback, created_at, updated_at)
       VALUES (?, ?, ?, '建立共同推动改进的组织基础', '结构与机制', 1, 'active', ?, NULL, NULL, ?, ?)`,
    )
    .run(
      stageId,
      options.schoolId,
      options.stageTitle ?? '中层承接机制建立',
      FIXTURE_NOW,
      FIXTURE_NOW,
      FIXTURE_NOW,
    )
  database.client
    .prepare(
      `INSERT INTO stage_targets (id, stage_id, school_id, dimension_key, title, description,
                                  status, sequence, created_at, updated_at)
       VALUES (?, ?, ?, 'structure', ?, ?, 'confirmed', 1, ?, ?)`,
    )
    .run(
      targetId,
      stageId,
      options.schoolId,
      options.targetTitle ?? '结构与机制',
      options.targetDescription ?? '教研与课堂实践能够被同伴看见。',
      FIXTURE_NOW,
      FIXTURE_NOW,
    )
  return Object.freeze({ stageId, targetId })
}

export type AssistantProposalFixture = Readonly<{
  schoolId: string
  agentRunId: string
  targetId?: string
  status?: 'proposed' | 'insufficient_evidence'
  provisionalJudgment?: string
}>

/**
 * Produces a judgement the way the product does: registered grounds, then a
 * candidate through the assessment contract.
 */
export async function submitAssistantProposal(
  database: WorkbenchDatabase,
  options: AssistantProposalFixture,
): Promise<Readonly<{ proposalId: string }>> {
  const registry = activeMethodologyRegistry()
  await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
  const write = new WorkbenchWriteCapabilityService(
    new SqliteWritePlaneRepository(database, registry),
    new GroundedDiagnosisService(registry, new SqliteGroundedDiagnosisRepository(database.db)),
  )
  const context = { schoolId: options.schoolId, agentRunId: options.agentRunId }
  const abstaining = options.status === 'insufficient_evidence'

  const registered = await write.evidenceRegister(context, {
    sourceType: 'observation',
    title: '九月教研观察记录',
    inlineText: '教研组把三节课的课堂记录贴到了公共墙上。',
    observationFacts: [
      {
        ref: 'f1',
        factType: 'organization',
        text: '教研组把三节课的课堂记录贴到公共墙上。',
        locator: 'p.1 段2',
        directness: 'high',
      },
      {
        ref: 'f2',
        factType: 'adult_practice',
        text: '只有这一个教研组这样做。',
        locator: 'p.1 段4',
        directness: 'medium',
      },
    ],
    claims: [
      {
        ref: 'c1',
        statement: '这所学校的改进实践已经开始在公共空间被同伴看见。',
        facts: [
          { factRef: 'f1', stance: 'supporting' },
          { factRef: 'f2', stance: 'counter' },
        ],
      },
    ],
  })

  const supporting = registered.observationFacts[0]?.id ?? ''
  const counter = registered.observationFacts[1]?.id ?? ''

  const proposal = await write.diagnosisPropose(context, {
    type: 'state',
    title: '改进实践开始可见',
    candidate: {
      protocolVersion: 1,
      claimRefs: abstaining ? [] : [registered.claims[0]?.id ?? ''],
      criterionMappings: abstaining
        ? []
        : [
            {
              packKey: 'data-wise',
              version: '3',
              criterionId: 'DW.C2.PRACTICE_VISIBILITY',
              reason: '公共墙上的课堂记录正对应实践可见性这条准则。',
            },
          ],
      stageTargetRefs: abstaining ? [] : [options.targetId ?? 'target-1'],
      supportingFactRefs: abstaining ? [] : [supporting],
      counterFactRefs: abstaining ? [] : [counter],
      counterEvidenceSearch: {
        completed: !abstaining,
        summary: '查过是否还有别的教研组在做同样的事。',
        searchedEvidenceRefs: [registered.evidenceId],
        searchedFactRefs: abstaining ? [] : [supporting, counter],
      },
      interpretations: abstaining
        ? []
        : [
            {
              kind: 'interpretation',
              id: 'i1',
              summary: '贴到公共空间意味着实践开始可被同伴检视。',
              factRefs: [supporting],
            },
          ],
      provisionalJudgment: abstaining
        ? null
        : (options.provisionalJudgment ?? '改进实践已经开始可见，但还只发生在一个教研组。'),
      mechanism: abstaining ? null : '公共展示让同伴之间的相互检视成为常态。',
      alternativeHypotheses: abstaining ? [] : ['也可能只是这一次公开课的临时安排。'],
      unresolvedQuestions: abstaining ? ['还需要看别的教研组是否也这样做。'] : [],
      recommendedActions: abstaining ? [] : ['把公共墙的做法带到另一个教研组试一轮。'],
      nextObservations: abstaining
        ? ['下月再看一次公共墙。']
        : ['下月再看一次公共墙是否仍在更新。'],
      impactEvidencePlan: abstaining ? [] : ['比较下月两个教研组的公共记录数量。'],
      evidenceQuality: {
        directness: abstaining ? 'low' : 'high',
        triangulation: 'single_source',
        limitations: ['只有一份观察记录。'],
      },
      confidence: abstaining ? 'low' : 'medium',
      status: options.status ?? 'proposed',
    },
  })

  return Object.freeze({ proposalId: proposal.proposalId })
}

/**
 * A school that already has an accepted judgement, written straight to the
 * tables.
 *
 * Deliberately not through the assessment contract: the slices that need this
 * (stage recommendation, school state) run *before* a school has a confirmed
 * stage, and the contract requires one. Nothing in the product may do this —
 * only fixtures establishing a starting position may.
 */
export function insertAcceptedJudgmentFixture(
  database: WorkbenchDatabase,
  options: Readonly<{ schoolId: string; statement: string; suffix: string; createdAt?: string }>,
): Readonly<{ id: string; proposalId: string; statement: string }> {
  const proposalId = `fixture-proposal-${options.suffix}`
  const reviewId = `fixture-review-${options.suffix}`
  const judgmentId = `fixture-judgment-${options.suffix}`
  const scopeJson = JSON.stringify({ kind: 'school', schoolId: options.schoolId })
  const emptyList = '[]'
  const createdAt = options.createdAt ?? FIXTURE_NOW

  database.client
    .prepare(
      `INSERT INTO diagnosis_proposals (id, school_id, agent_run_id, type, title, scope_json,
         interpretations_json, provisional_judgment, mechanism, alternative_hypotheses_json,
         unresolved_questions_json, recommended_actions_json, next_observations_json,
         impact_evidence_plan_json, evidence_quality_json, confidence, status, created_at)
       VALUES (?, ?, NULL, 'state', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'medium', 'proposed', ?)`,
    )
    .run(
      proposalId,
      options.schoolId,
      options.statement,
      scopeJson,
      emptyList,
      options.statement,
      emptyList,
      emptyList,
      emptyList,
      emptyList,
      emptyList,
      JSON.stringify({ directness: 'high', triangulated: true }),
      createdAt,
    )
  database.client
    .prepare(
      `INSERT INTO human_reviews (id, proposal_id, decision, feedback, final_text, reason, reviewed_at)
       VALUES (?, ?, 'accepted', NULL, NULL, NULL, ?)`,
    )
    .run(reviewId, proposalId, createdAt)
  database.client
    .prepare(
      `INSERT INTO accepted_judgments (id, school_id, review_id, statement, scope_json,
         valid_from, valid_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(judgmentId, options.schoolId, reviewId, options.statement, scopeJson, createdAt, createdAt)

  return Object.freeze({ id: judgmentId, proposalId, statement: options.statement })
}
