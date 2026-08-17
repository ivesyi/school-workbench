import { GroundedDiagnosisService, JudgmentService } from '@school-workbench/application'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { WorkbenchWriteCapabilityService } from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteGroundedDiagnosisRepository } from './sqlite-grounded-diagnosis-repository'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteSchoolRepository } from './sqlite-school-repository'
import { SqliteWritePlaneRepository } from './sqlite-write-plane-repository'

/**
 * A judgement an assistant submitted has to reach the consultant through the
 * one review surface the workbench already has, and it has to stay a proposal
 * until a person decides. This exercises that from the real write plane all the
 * way to an accepted judgement.
 */
const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const NOW = '2026-08-18T00:00:00.000Z'
const SCHOOL = 'school-1'
const RUN = 'run-1'

let database: WorkbenchDatabase

function activeRegistry(): MethodologyRegistry {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base.listPacks().map((pack) => ({ ...pack, status: 'active' }) as MethodologyPack),
  )
}

function seed(): void {
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(SCHOOL, '南山实验学校', NOW)
  database.client
    .prepare(
      `INSERT INTO stages (id, school_id, title, summary, focus, sequence, status, starts_at,
                           ends_at, adjustment_feedback, created_at, updated_at)
       VALUES ('stage-1', ?, '阶段一', '建立共同推动改进的组织基础', '结构与机制', 1, 'active', ?, NULL, NULL, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW, NOW)
  database.client
    .prepare(
      `INSERT INTO stage_targets (id, stage_id, school_id, dimension_key, title, description,
                                  status, sequence, created_at, updated_at)
       VALUES ('target-1', 'stage-1', ?, 'structure', '让改进实践变得可见',
               '教研与课堂实践能够被同伴看见。', 'confirmed', 1, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW)
}

async function submitAssistantJudgment(
  status: 'proposed' | 'insufficient_evidence' = 'proposed',
): Promise<void> {
  const registry = activeRegistry()
  await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
  const write = new WorkbenchWriteCapabilityService(
    new SqliteWritePlaneRepository(database, registry),
    new GroundedDiagnosisService(registry, new SqliteGroundedDiagnosisRepository(database.db)),
  )
  const context = { schoolId: SCHOOL, agentRunId: RUN }
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
  const abstaining = status === 'insufficient_evidence'

  await write.diagnosisPropose(context, {
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
      stageTargetRefs: abstaining ? [] : ['target-1'],
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
      provisionalJudgment: abstaining ? null : '改进实践已经开始可见，但还只发生在一个教研组。',
      mechanism: null,
      alternativeHypotheses: abstaining ? [] : ['也可能只是这一次公开课的临时安排。'],
      unresolvedQuestions: abstaining ? ['还需要看别的教研组是否也这样做。'] : [],
      recommendedActions: [],
      nextObservations: abstaining
        ? ['下月再看一次公共墙。']
        : ['下月再看一次公共墙是否仍在更新。'],
      impactEvidencePlan: [],
      evidenceQuality: {
        directness: abstaining ? 'low' : 'high',
        triangulation: 'single_source',
        limitations: ['只有一份观察记录。'],
      },
      confidence: abstaining ? 'low' : 'medium',
      status,
    },
  })
}

function judgmentService(): JudgmentService {
  return new JudgmentService(
    new SqliteSchoolRepository(database.db),
    new SqliteJudgmentRepository(database.db),
  )
}

beforeEach(() => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
  seed()
})

afterEach(() => database.close())

describe('a judgement an assistant submitted', () => {
  it('reaches the consultant through the workbench review surface', async () => {
    await submitAssistantJudgment()
    const outcome = await judgmentService().findAgentRunOutcome(SCHOOL, RUN)

    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const { view } = outcome
    expect(view.source).toBe('assistant')
    expect(view.proposal.provisionalJudgment).toBe('改进实践已经开始可见，但还只发生在一个教研组。')
    expect(view.facts.map((fact) => fact.text)).toEqual(['教研组把三节课的课堂记录贴到公共墙上。'])
    // PRD 17 shows the evidence that points the other way, so it has to survive
    // the trip from the assessment record to the screen.
    expect(view.counterFacts.map((fact) => fact.text)).toEqual(['只有这一个教研组这样做。'])
    expect(view.evidence).toHaveLength(1)
    expect(view.claims).toHaveLength(1)
  })

  it('is still only a proposal until a person accepts it', async () => {
    await submitAssistantJudgment()
    const service = judgmentService()
    const outcome = await service.findAgentRunOutcome(SCHOOL, RUN)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    expect(
      database.client.prepare('SELECT count(*) AS count FROM accepted_judgments').get(),
    ).toEqual({ count: 0 })

    const result = await service.review({
      schoolId: SCHOOL,
      diagnosisId: outcome.view.proposal.id,
      decision: 'accepted',
    })

    expect(result.acceptedJudgment?.text).toBe('改进实践已经开始可见，但还只发生在一个教研组。')
    expect(
      database.client.prepare('SELECT count(*) AS count FROM accepted_judgments').get(),
    ).toEqual({ count: 1 })
  })

  it('disappears from the review surface once it has been decided', async () => {
    await submitAssistantJudgment()
    const service = judgmentService()
    const first = await service.findAgentRunOutcome(SCHOOL, RUN)
    if (first.kind !== 'proposal') throw new Error('expected a proposal')

    await service.review({
      schoolId: SCHOOL,
      diagnosisId: first.view.proposal.id,
      decision: 'rejected',
    })

    expect((await service.findAgentRunOutcome(SCHOOL, RUN)).kind).toBe('none')
  })

  it('is never offered for acceptance when the assistant abstained', async () => {
    await submitAssistantJudgment('insufficient_evidence')
    const outcome = await judgmentService().findAgentRunOutcome(SCHOOL, RUN)

    // An abstention is a real answer, but there is nothing in it to accept.
    expect(outcome.kind).toBe('insufficient_evidence')
    if (outcome.kind !== 'insufficient_evidence') throw new Error('expected an abstention')
    expect(outcome.unresolvedQuestions.length).toBeGreaterThan(0)
  })

  it('belongs to its own school', async () => {
    await submitAssistantJudgment()
    database.client
      .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
      .run('school-2', '滨江学校', NOW)

    expect((await judgmentService().findAgentRunOutcome('school-2', RUN)).kind).toBe('none')
  })

  it('reports nothing for a run that never submitted one', async () => {
    expect((await judgmentService().findAgentRunOutcome(SCHOOL, 'run-that-did-nothing')).kind).toBe(
      'none',
    )
  })
})
