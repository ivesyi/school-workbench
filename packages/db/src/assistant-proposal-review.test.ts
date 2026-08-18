import { JudgmentService } from '@school-workbench/application'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteJudgmentRepository } from './sqlite-judgment-repository'
import { FIXTURE_NOW, seedActiveStage, seedSchool, submitAssistantProposal } from './test-support'

/**
 * A judgement an assistant submitted has to reach the consultant through the
 * one review surface the workbench has, and it has to stay a proposal until a
 * person decides. This exercises that from the real write plane all the way to
 * an accepted judgement.
 */
const migrationsFolder = resolve('packages/db/drizzle')
const NOW = FIXTURE_NOW
const SCHOOL = 'school-1'
const RUN = 'run-1'

let database: WorkbenchDatabase

function seed(): void {
  seedSchool(database, { schoolId: SCHOOL })
  seedActiveStage(database, {
    schoolId: SCHOOL,
    stageTitle: '让改进实践变得可见',
    targetTitle: '结构与机制',
    targetDescription: '教研与课堂实践能够被同伴看见。',
  })
}

async function submitAssistantJudgment(
  status: 'proposed' | 'insufficient_evidence' = 'proposed',
): Promise<void> {
  await submitAssistantProposal(database, { schoolId: SCHOOL, agentRunId: RUN, status })
}

function judgmentService(): JudgmentService {
  return new JudgmentService(new SqliteJudgmentRepository(database.db))
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
    expect(view.evidence[0]?.sourceLabel).toBe('现场观察')
    expect(view.evidence[0]?.excerpt).toContain('公共墙')
    expect(view.claims).toHaveLength(1)
    // PRD 5.7: a judgement is auditable only if the standard and the stage it
    // was measured against can be named, versions included.
    expect(view.grounding.schoolName).toBe('南山实验学校')
    expect(view.grounding.stageTitle).toBe('让改进实践变得可见')
    expect(view.grounding.stageTargets.map((target) => target.label)).toEqual(['结构与机制'])
    expect(view.grounding.criteria.map((item) => item.stableKey)).toEqual([
      'DW.C2.PRACTICE_VISIBILITY',
    ])
    expect(view.grounding.criteria[0]?.packVersion).toBe('3')
    expect(view.proposal.mechanism).toContain('相互检视')
    expect(view.proposal.proposedActions.length).toBeGreaterThan(0)
    expect(view.proposal.impactMeasures.length).toBeGreaterThan(0)
  })

  it('keeps the assistant judgment, the consultant feedback and the final text on a rewrite', async () => {
    await submitAssistantJudgment()
    const service = judgmentService()
    const outcome = await service.findAgentRunOutcome(SCHOOL, RUN)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    const original = outcome.view.proposal.provisionalJudgment

    await service.review({
      schoolId: SCHOOL,
      diagnosisId: outcome.view.proposal.id,
      decision: 'modified',
      feedback: '这只是一个教研组，说“学校”太大了。',
      finalText: '一个教研组的改进实践已经可见，其他组还没有。',
    })

    const review = database.client
      .prepare('SELECT decision, feedback, final_text, reviewed_at FROM human_reviews')
      .get() as {
      decision: string
      feedback: string | null
      final_text: string | null
      reviewed_at: string
    }
    expect(review.decision).toBe('modified')
    expect(review.feedback).toBe('这只是一个教研组，说“学校”太大了。')
    expect(review.final_text).toBe('一个教研组的改进实践已经可见，其他组还没有。')
    expect(review.reviewed_at).toMatch(/^\d{4}-/)
    // The assistant's original wording is untouched by the rewrite.
    expect(
      (
        database.client.prepare('SELECT provisional_judgment FROM diagnosis_proposals').get() as {
          provisional_judgment: string
        }
      ).provisional_judgment,
    ).toBe(original)
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
