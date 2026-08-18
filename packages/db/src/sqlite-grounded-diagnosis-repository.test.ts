import {
  GroundedDiagnosisProtocolError,
  GroundedDiagnosisService,
  JudgmentService,
} from '@school-workbench/application'
import {
  assessmentCandidateSchema,
  assessmentInputSchema,
  type AssessmentCandidate,
  type AssessmentInput,
} from '@school-workbench/assessment'
import type { ReviewOutcome } from '@school-workbench/domain'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
  type MethodologyPackStatus,
} from '@school-workbench/methodology'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteGroundedDiagnosisRepository } from './sqlite-grounded-diagnosis-repository'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import {
  claimFacts,
  claims,
  evidence,
  observationFacts,
  schools,
  stageTargets,
  stages,
} from './schema'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

const SBD = {
  packKey: 'schooling-by-design',
  version: '1',
  criterionId: 'SBD.C4.SYSTEM_ALIGNMENT',
} as const
const DATA_WISE = {
  packKey: 'data-wise',
  version: '3',
  criterionId: 'DW.C2.PRACTICE_VISIBILITY',
} as const

type CriterionRef = typeof SBD | typeof DATA_WISE

function registryWithStatus(status: MethodologyPackStatus): MethodologyRegistry {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base.listPacks().map((pack) => ({ ...pack, status }) as MethodologyPack),
  )
}

function proposedFixture(
  schoolId: string,
  criterion: CriterionRef,
): { input: AssessmentInput; candidate: AssessmentCandidate } {
  const input = assessmentInputSchema.parse({
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    activeStage: { id: `${schoolId}-stage`, schoolId, title: '阶段一', status: 'active' },
    confirmedStageTargets: [
      {
        id: `${schoolId}-target`,
        stageId: `${schoolId}-stage`,
        schoolId,
        dimensionKey: 'key_tasks',
        title: '形成可观察的改进协同',
        description: '检查关键任务是否形成可观察协同。',
        status: 'confirmed',
      },
    ],
    evidence: [
      {
        kind: 'evidence',
        id: `${schoolId}-e1`,
        schoolId,
        sourceType: 'pasted_text',
        title: '合成会议记录',
        uri: null,
        inlineText: '完全合成的学校材料。',
        locator: 'synthetic:e1',
        capturedAt: '2026-08-17T00:00:00.000Z',
      },
    ],
    observationFacts: [
      {
        kind: 'observation_fact',
        id: `${schoolId}-f1`,
        schoolId,
        evidenceId: `${schoolId}-e1`,
        factType: criterion.packKey === 'data-wise' ? 'adult_practice' : 'organization',
        text: '团队在同一工作记录中明确目标、行动与可观察结果。',
        locator: 'synthetic:f1',
        directness: 'high',
      },
    ],
    claims: [
      {
        kind: 'claim',
        id: `${schoolId}-c1`,
        schoolId,
        statement: '当前实践与阶段目标之间存在可核查关系。',
        predicateKey: 'synthetic:grounded-claim',
        scope: { kind: 'school', schoolId },
      },
    ],
    claimFacts: [{ claimId: `${schoolId}-c1`, factId: `${schoolId}-f1`, stance: 'supporting' }],
    methodologyContext: [criterion],
  })

  const candidate = assessmentCandidateSchema.parse({
    protocolVersion: 1,
    school: { kind: 'school', schoolId },
    claimRefs: [`${schoolId}-c1`],
    criterionMappings: [{ ...criterion, reason: '与当前合成 Claim 直接对应。' }],
    stageTargetRefs: [`${schoolId}-target`],
    supportingFactRefs: [`${schoolId}-f1`],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '已检查当前 Claim 范围内已登记的支持与相反事实。',
      searchedEvidenceRefs: [`${schoolId}-e1`],
      searchedFactRefs: [`${schoolId}-f1`],
    },
    interpretations: [
      {
        kind: 'interpretation',
        id: `${schoolId}-i1`,
        summary: '该事实支持一个可审核的暂定解释。',
        factRefs: [`${schoolId}-f1`],
      },
    ],
    provisionalJudgment: '现有正式材料支持一个暂定判断。',
    mechanism: '共同目标与可观察记录帮助行动保持一致。',
    alternativeHypotheses: ['当前表现也可能只是一次短期协调。'],
    unresolvedQuestions: ['下一轮是否仍能观察到同样实践？'],
    recommendedActions: ['继续保留可观察记录。'],
    nextObservations: ['观察下一轮同类任务。'],
    impactEvidencePlan: ['比较下一轮的任务记录。'],
    evidenceQuality: {
      directness: 'high',
      triangulation: 'single_source',
      limitations: ['只有一类合成材料。'],
    },
    confidence: 'medium',
    status: 'proposed',
  })
  return { input, candidate }
}

function insufficientFixture(schoolId: string): {
  input: AssessmentInput
  candidate: AssessmentCandidate
} {
  const base = proposedFixture(schoolId, SBD)
  const input = assessmentInputSchema.parse({
    ...base.input,
    observationFacts: [],
    claims: [],
    claimFacts: [],
    methodologyContext: [],
  })
  const candidate = assessmentCandidateSchema.parse({
    ...base.candidate,
    claimRefs: [],
    criterionMappings: [],
    stageTargetRefs: [],
    supportingFactRefs: [],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: false,
      summary: '当前事实不足，不能完成反证搜索。',
      searchedEvidenceRefs: [`${schoolId}-e1`],
      searchedFactRefs: [],
    },
    interpretations: [],
    provisionalJudgment: null,
    mechanism: null,
    alternativeHypotheses: [],
    unresolvedQuestions: ['还缺什么可定位事实？'],
    recommendedActions: [],
    nextObservations: ['补充一次可定位观察。'],
    impactEvidencePlan: [],
    evidenceQuality: {
      directness: 'low',
      triangulation: 'single_source',
      limitations: ['只有一条模糊材料。'],
    },
    confidence: 'low',
    status: 'insufficient_evidence',
  })
  return { input, candidate }
}

function persistInput(database: WorkbenchDatabase, input: AssessmentInput): void {
  const now = '2026-08-17T00:00:00.000Z'
  database.db
    .insert(schools)
    .values({ id: input.school.schoolId, name: '合成学校', createdAt: now, archivedAt: null })
    .run()
  database.db
    .insert(stages)
    .values({
      id: input.activeStage.id,
      schoolId: input.school.schoolId,
      title: input.activeStage.title,
      summary: '合成阶段',
      focus: '合成目标',
      sequence: 1,
      status: 'active',
      startsAt: now,
      endsAt: null,
      adjustmentFeedback: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  input.confirmedStageTargets.forEach((target, index) => {
    database.db
      .insert(stageTargets)
      .values({ ...target, sequence: index + 1, createdAt: now, updatedAt: now })
      .run()
  })
  for (const item of input.evidence) {
    database.db
      .insert(evidence)
      .values({
        id: item.id,
        schoolId: item.schoolId,
        sourceType: item.sourceType,
        uri: item.uri,
        inlineText: item.inlineText,
        title: item.title,
        locatorJson: item.locator,
        contentHash: null,
        capturedAt: item.capturedAt,
        registeredBy: 'human',
        agentRunId: null,
        createdAt: now,
      })
      .run()
  }
  for (const fact of input.observationFacts) {
    database.db
      .insert(observationFacts)
      .values({
        id: fact.id,
        schoolId: fact.schoolId,
        evidenceId: fact.evidenceId,
        factType: fact.factType,
        text: fact.text,
        locatorJson: fact.locator,
        directness: fact.directness,
        extractedBy: 'human',
        agentRunId: null,
        createdAt: now,
      })
      .run()
  }
  for (const claim of input.claims) {
    database.db
      .insert(claims)
      .values({
        id: claim.id,
        schoolId: claim.schoolId,
        subjectRefJson: JSON.stringify(claim.scope),
        predicateKey: claim.predicateKey,
        objectRefJson: null,
        statement: claim.statement,
        validFrom: null,
        validTo: null,
        scopeJson: JSON.stringify(claim.scope),
        createdBy: 'human',
        agentRunId: null,
        createdAt: now,
      })
      .run()
  }
  input.claimFacts.forEach((link, index) => {
    database.db
      .insert(claimFacts)
      .values({ ...link, sequence: index + 1 })
      .run()
  })
}

function fixedService(
  database: WorkbenchDatabase,
  registry: MethodologyRegistry,
  proposalId = 'grounded-proposal-1',
): GroundedDiagnosisService {
  return new GroundedDiagnosisService(
    registry,
    new SqliteGroundedDiagnosisRepository(database.db),
    {
      createId: () => proposalId,
      now: () => new Date('2026-08-17T01:00:00.000Z'),
    },
  )
}

function proposalCount(database: WorkbenchDatabase): number {
  return (
    database.client.prepare('SELECT count(*) AS count FROM diagnosis_proposals').get() as {
      count: number
    }
  ).count
}

function relationCounts(database: WorkbenchDatabase): Record<string, number> {
  return Object.fromEntries(
    ['diagnosis_claims', 'diagnosis_criteria', 'diagnosis_stage_targets'].map((table) => [
      table,
      (database.client.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
        .count,
    ]),
  )
}

async function expectProtocolFailure(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action()
    throw new Error('expected protocol failure')
  } catch (error) {
    expect(error).toBeInstanceOf(GroundedDiagnosisProtocolError)
    expect((error as GroundedDiagnosisProtocolError).errors.map((item) => item.code)).toContain(
      code,
    )
  }
}

describe('validated diagnosis persistence seam', () => {
  let database: WorkbenchDatabase
  let activeRegistry: MethodologyRegistry

  beforeEach(async () => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
    activeRegistry = registryWithStatus('active')
    await new SqliteMethodologyRepository(database.db).syncRegistry(activeRegistry)
  })

  afterEach(() => database.close())

  it.each([
    ['SBD', SBD],
    ['Data Wise', DATA_WISE],
  ] as const)(
    'round-trips a validated %s proposed diagnosis without copying source records',
    async (_, criterion) => {
      const fixture = proposedFixture(`school-${criterion.packKey}`, criterion)
      persistInput(database, fixture.input)
      const service = fixedService(database, activeRegistry)

      const saved = await service.create({
        schoolId: fixture.input.school.schoolId,
        type: 'state',
        title: '合成 grounded proposal',
        rawAssessmentInput: fixture.input,
        rawAssessmentCandidate: fixture.candidate,
      })

      expect(saved.proposal.provisionalJudgment).toBe(fixture.candidate.provisionalJudgment)
      expect(saved.proposal.interpretations).toEqual(['该事实支持一个可审核的暂定解释。'])
      expect(saved.claimIds).toEqual([`${fixture.input.school.schoolId}-c1`])
      expect(saved.criteria).toHaveLength(1)
      expect(saved.criteria[0]?.stableKey).toBe(criterion.criterionId)
      expect(saved.stageTargetIds).toEqual([`${fixture.input.school.schoolId}-target`])
      expect(await service.find(saved.proposal.id)).toEqual(saved)
      expect(database.client.prepare('SELECT count(*) AS count FROM evidence').get()).toEqual({
        count: 1,
      })
      expect(relationCounts(database)).toEqual({
        diagnosis_claims: 1,
        diagnosis_criteria: 1,
        diagnosis_stage_targets: 1,
      })
    },
  )

  it.each(['review', 'retired'] as const)(
    'rejects a %s file-registry pack before persistence',
    async (status) => {
      const fixture = proposedFixture(`school-memory-${status}`, SBD)
      persistInput(database, fixture.input)
      const service = fixedService(database, registryWithStatus(status))

      await expectProtocolFailure(
        () =>
          service.create({
            schoolId: fixture.input.school.schoolId,
            type: 'state',
            title: '不应保存',
            rawAssessmentInput: fixture.input,
            rawAssessmentCandidate: fixture.candidate,
          }),
        'ASSESSMENT_METHODOLOGY_PACK_NOT_ACTIVE',
      )
      expect(proposalCount(database)).toBe(0)
    },
  )

  it.each(['review', 'retired'] as const)(
    'rejects in-memory active methodology when persisted DB pack is %s',
    async (status) => {
      const fixture = proposedFixture(`school-db-${status}`, SBD)
      persistInput(database, fixture.input)
      database.client
        .prepare('UPDATE methodology_packs SET status = ? WHERE key = ? AND version = ?')
        .run(status, SBD.packKey, SBD.version)

      await expectProtocolFailure(
        () =>
          fixedService(database, activeRegistry).create({
            schoolId: fixture.input.school.schoolId,
            type: 'state',
            title: '不应保存',
            rawAssessmentInput: fixture.input,
            rawAssessmentCandidate: fixture.candidate,
          }),
        'ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH',
      )
      expect(proposalCount(database)).toBe(0)
      expect(relationCounts(database)).toEqual({
        diagnosis_claims: 0,
        diagnosis_criteria: 0,
        diagnosis_stage_targets: 0,
      })
    },
  )

  it('rejects wrong candidate pack version and criterion before persistence', async () => {
    const fixture = proposedFixture('school-wrong-methodology', SBD)
    persistInput(database, fixture.input)
    const wrongVersion = {
      ...fixture.candidate,
      criterionMappings: [{ ...fixture.candidate.criterionMappings[0]!, version: '99' }],
    }
    await expectProtocolFailure(
      () =>
        fixedService(database, activeRegistry).create({
          schoolId: fixture.input.school.schoolId,
          type: 'state',
          title: '不应保存',
          rawAssessmentInput: fixture.input,
          rawAssessmentCandidate: wrongVersion,
        }),
      'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
    )

    const wrongCriterionInput = {
      ...fixture.input,
      methodologyContext: [
        { ...fixture.input.methodologyContext[0]!, criterionId: 'SBD.C99.MISSING' },
      ],
    }
    await expectProtocolFailure(
      () =>
        fixedService(database, activeRegistry).create({
          schoolId: fixture.input.school.schoolId,
          type: 'state',
          title: '不应保存',
          rawAssessmentInput: wrongCriterionInput,
          rawAssessmentCandidate: fixture.candidate,
        }),
      'ASSESSMENT_METHODOLOGY_CRITERION_NOT_FOUND',
    )
    expect(proposalCount(database)).toBe(0)
  })

  it('rejects persisted criterion drift even when the pack hash row was not changed', async () => {
    const fixture = proposedFixture('school-criterion-drift', SBD)
    persistInput(database, fixture.input)
    const persistedCriterion = database.client
      .prepare('SELECT id FROM methodology_criteria WHERE stable_key = ?')
      .get(SBD.criterionId) as { id: string } | undefined
    if (!persistedCriterion) throw new Error('criterion fixture missing')
    database.client
      .prepare('UPDATE methodology_criteria SET description = ? WHERE id = ?')
      .run('tampered description', persistedCriterion.id)

    await expectProtocolFailure(
      () =>
        fixedService(database, activeRegistry).create({
          schoolId: fixture.input.school.schoolId,
          type: 'state',
          title: '不应保存',
          rawAssessmentInput: fixture.input,
          rawAssessmentCandidate: fixture.candidate,
        }),
      'ASSESSMENT_METHODOLOGY_PERSISTENCE_MISMATCH',
    )
    expect(proposalCount(database)).toBe(0)
  })

  it.each([
    [
      'cross-school Claim',
      (db: WorkbenchDatabase, fixture: ReturnType<typeof proposedFixture>) => {
        db.db
          .insert(schools)
          .values({
            id: 'other-school',
            name: '另一所学校',
            createdAt: '2026-08-17T00:00:00.000Z',
            archivedAt: null,
          })
          .run()
        db.client
          .prepare('UPDATE claims SET school_id = ? WHERE id = ?')
          .run('other-school', fixture.input.claims[0]!.id)
      },
      'ASSESSMENT_PERSISTENCE_RECORD_MISMATCH',
    ],
    [
      'cross-school StageTarget',
      (db: WorkbenchDatabase, fixture: ReturnType<typeof proposedFixture>) => {
        db.db
          .insert(schools)
          .values({
            id: 'other-school',
            name: '另一所学校',
            createdAt: '2026-08-17T00:00:00.000Z',
            archivedAt: null,
          })
          .run()
        db.client
          .prepare('UPDATE stage_targets SET school_id = ? WHERE id = ?')
          .run('other-school', fixture.input.confirmedStageTargets[0]!.id)
      },
      'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
    ],
    [
      'completed Stage',
      (db: WorkbenchDatabase, fixture: ReturnType<typeof proposedFixture>) => {
        db.client
          .prepare('UPDATE stages SET status = ? WHERE id = ?')
          .run('completed', fixture.input.activeStage.id)
      },
      'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
    ],
    [
      'retired StageTarget',
      (db: WorkbenchDatabase, fixture: ReturnType<typeof proposedFixture>) => {
        db.client
          .prepare('UPDATE stage_targets SET status = ? WHERE id = ?')
          .run('retired', fixture.input.confirmedStageTargets[0]!.id)
      },
      'ASSESSMENT_STAGE_TARGET_NOT_CURRENT',
    ],
    [
      'ClaimFact stance drift',
      (db: WorkbenchDatabase, fixture: ReturnType<typeof proposedFixture>) => {
        db.client
          .prepare('UPDATE claim_facts SET stance = ? WHERE claim_id = ? AND fact_id = ?')
          .run('counter', fixture.input.claimFacts[0]!.claimId, fixture.input.claimFacts[0]!.factId)
      },
      'ASSESSMENT_FACT_STANCE_MISMATCH',
    ],
  ] as const)(
    'rolls back the whole save when persisted state has %s',
    async (_, mutate, expectedCode) => {
      const fixture = proposedFixture(`school-stale-${String(expectedCode).toLowerCase()}`, SBD)
      persistInput(database, fixture.input)
      mutate(database, fixture)

      await expectProtocolFailure(
        () =>
          fixedService(database, activeRegistry).create({
            schoolId: fixture.input.school.schoolId,
            type: 'state',
            title: '不应保存',
            rawAssessmentInput: fixture.input,
            rawAssessmentCandidate: fixture.candidate,
          }),
        expectedCode,
      )
      expect(proposalCount(database)).toBe(0)
      expect(relationCounts(database)).toEqual({
        diagnosis_claims: 0,
        diagnosis_criteria: 0,
        diagnosis_stage_targets: 0,
      })
    },
  )

  it('rejects duplicate proposal ids without updating immutable history', async () => {
    const fixture = proposedFixture('school-duplicate-proposal', SBD)
    persistInput(database, fixture.input)
    const service = fixedService(database, activeRegistry, 'same-proposal-id')
    const create = () =>
      service.create({
        schoolId: fixture.input.school.schoolId,
        type: 'state',
        title: '不可变 Proposal',
        rawAssessmentInput: fixture.input,
        rawAssessmentCandidate: fixture.candidate,
      })

    const first = await create()
    await expectProtocolFailure(create, 'ASSESSMENT_PROPOSAL_ID_CONFLICT')
    expect(proposalCount(database)).toBe(1)
    expect(await service.find(first.proposal.id)).toEqual(first)
    expect(relationCounts(database)).toEqual({
      diagnosis_claims: 1,
      diagnosis_criteria: 1,
      diagnosis_stage_targets: 1,
    })
  })

  it('persists insufficient evidence but never permits an AcceptedJudgment', async () => {
    const fixture = insufficientFixture('school-insufficient')
    persistInput(database, fixture.input)
    const service = fixedService(database, activeRegistry, 'insufficient-proposal')
    const saved = await service.create({
      schoolId: fixture.input.school.schoolId,
      type: 'state',
      title: '还需要更多依据',
      rawAssessmentInput: fixture.input,
      rawAssessmentCandidate: fixture.candidate,
    })

    expect(saved.proposal.status).toBe('insufficient_evidence')
    expect(saved.proposal.provisionalJudgment).toBeNull()
    expect(saved.claimIds).toEqual([])
    expect(saved.criteria).toEqual([])
    expect(saved.stageTargetIds).toEqual([])

    const judgmentRepository = new SqliteJudgmentRepository(database.db)
    const judgmentService = new JudgmentService(judgmentRepository)
    await expect(
      judgmentService.review({
        schoolId: fixture.input.school.schoolId,
        diagnosisId: saved.proposal.id,
        decision: 'accepted',
      }),
    ).rejects.toThrow(/证据不足/)
    await expect(
      judgmentService.review({
        schoolId: fixture.input.school.schoolId,
        diagnosisId: saved.proposal.id,
        decision: 'modified',
        finalText: '不能绕过证据门槛',
      }),
    ).rejects.toThrow(/证据不足/)

    const forged: ReviewOutcome = {
      review: {
        id: 'forged-review',
        proposalId: saved.proposal.id,
        decision: 'accepted',
        feedback: null,
        finalText: null,
        reason: null,
        reviewedAt: '2026-08-17T02:00:00.000Z',
      },
      acceptedJudgment: {
        id: 'forged-judgment',
        schoolId: fixture.input.school.schoolId,
        proposalId: saved.proposal.id,
        reviewId: 'forged-review',
        statement: '不应生成',
        scopeJson: saved.proposal.scopeJson,
        validFrom: '2026-08-17T02:00:00.000Z',
        validTo: null,
        createdAt: '2026-08-17T02:00:00.000Z',
      },
    }
    await expect(judgmentRepository.saveReviewOutcome(forged)).rejects.toThrow(/证据不足/)

    const review = await judgmentService.review({
      schoolId: fixture.input.school.schoolId,
      diagnosisId: saved.proposal.id,
      decision: 'needs_more_evidence',
    })
    expect(review.acceptedJudgment).toBeNull()
    expect(database.client.prepare('SELECT count(*) AS count FROM human_reviews').get()).toEqual({
      count: 1,
    })
    expect(
      database.client.prepare('SELECT count(*) AS count FROM accepted_judgments').get(),
    ).toEqual({ count: 0 })
  })
})
