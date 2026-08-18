import { GroundedDiagnosisService } from '@school-workbench/application'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
  type MethodologyPackStatus,
} from '@school-workbench/methodology'
import {
  WorkbenchWriteCapabilityService,
  WritePlaneProtocolError,
} from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqliteGroundedDiagnosisRepository } from './sqlite-grounded-diagnosis-repository'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import {
  evidenceContentHash,
  normalizeEvidenceInlineText,
  normalizeEvidenceUri,
  SqliteWritePlaneRepository,
} from './sqlite-write-plane-repository'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const NOW = '2026-08-18T00:00:00.000Z'
const RUN = 'run-1'
const DW_CRITERION = 'DW.C2.PRACTICE_VISIBILITY'

let database: WorkbenchDatabase

/**
 * The shipped packs with a chosen lifecycle status, so a test can put a pack
 * back into review without touching `knowledge/`.
 */
function registryWith(statusByKey: Readonly<Record<string, MethodologyPackStatus>>) {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base
      .listPacks()
      .map((pack) => ({ ...pack, status: statusByKey[pack.key] ?? 'active' }) as MethodologyPack),
  )
}

function activeRegistry(): MethodologyRegistry {
  return registryWith({})
}

function seedSchool(schoolId: string, name = '南山实验学校'): void {
  database.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(schoolId, name, NOW)
  database.client
    .prepare(
      `INSERT INTO stages (id, school_id, title, summary, focus, sequence, status, starts_at,
                           ends_at, adjustment_feedback, created_at, updated_at)
       VALUES (?, ?, '阶段一', '建立共同推动改进的组织基础', '关键任务', 1, 'active', ?, NULL, NULL, ?, ?)`,
    )
    .run(`${schoolId}-stage`, schoolId, NOW, NOW, NOW)
  database.client
    .prepare(
      `INSERT INTO stage_targets (id, stage_id, school_id, dimension_key, title, description,
                                  status, sequence, created_at, updated_at)
       VALUES (?, ?, ?, 'structure', '让改进实践变得可见', '教研与课堂实践能够被同伴看见。', 'confirmed', 1, ?, ?)`,
    )
    .run(`${schoolId}-target`, `${schoolId}-stage`, schoolId, NOW, NOW)
}

async function syncPacks(registry: MethodologyRegistry): Promise<void> {
  await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
}

function writeService(registry: MethodologyRegistry): WorkbenchWriteCapabilityService {
  return new WorkbenchWriteCapabilityService(
    new SqliteWritePlaneRepository(database, registry, () => NOW),
    new GroundedDiagnosisService(registry, new SqliteGroundedDiagnosisRepository(database.db)),
  )
}

const registration = {
  sourceType: 'observation' as const,
  title: '九月教研观察记录',
  inlineText: '教研组把三节课的课堂记录贴到了公共墙上。\n其他年级也来看。',
  locator: 'p.1',
  observationFacts: [
    {
      ref: 'f-visible',
      factType: 'organization' as const,
      text: '教研组把三节课的课堂记录贴到公共墙上。',
      locator: 'p.1 段2',
      directness: 'high' as const,
    },
    {
      ref: 'f-crossgrade',
      factType: 'adult_practice' as const,
      text: '其他年级教师到公共墙前查看这些记录。',
      locator: 'p.1 段3',
      directness: 'medium' as const,
    },
  ],
  claims: [
    {
      ref: 'c-visible',
      statement: '这所学校的改进实践已经开始在公共空间被同伴看见。',
      facts: [
        { factRef: 'f-visible', stance: 'supporting' as const },
        { factRef: 'f-crossgrade', stance: 'supporting' as const },
      ],
    },
  ],
}

function candidate(
  claimId: string,
  factIds: readonly string[],
  targetId: string,
  evidenceId: string,
) {
  return {
    protocolVersion: 1 as const,
    claimRefs: [claimId],
    criterionMappings: [
      {
        packKey: 'data-wise',
        version: '3',
        criterionId: DW_CRITERION,
        reason: '公共墙上的课堂记录正对应实践可见性这条准则。',
      },
    ],
    stageTargetRefs: [targetId],
    supportingFactRefs: [...factIds],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '查了同一份观察记录里是否有相反迹象，没有发现。',
      searchedEvidenceRefs: [evidenceId],
      searchedFactRefs: [...factIds],
    },
    interpretations: [
      {
        kind: 'interpretation' as const,
        id: 'i1',
        summary: '把记录贴到公共空间意味着实践开始可被同伴检视。',
        factRefs: [...factIds],
      },
    ],
    provisionalJudgment: '改进实践已经开始可见，但还只发生在一个教研组。',
    mechanism: null,
    alternativeHypotheses: ['也可能只是这一次公开课的临时安排。'],
    unresolvedQuestions: ['这种做法能否延续到下个月？'],
    recommendedActions: [],
    nextObservations: ['下月再看一次公共墙是否仍在更新。'],
    impactEvidencePlan: [],
    evidenceQuality: {
      directness: 'high' as const,
      triangulation: 'single_source' as const,
      limitations: ['只有一份观察记录。'],
    },
    confidence: 'medium' as const,
    status: 'proposed' as const,
  }
}

beforeEach(() => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
})

afterEach(() => database.close())

describe('evidence content hashing (decision L7)', () => {
  it('treats the same material written differently as the same material', () => {
    expect(normalizeEvidenceInlineText('  a\r\nb   c  ')).toBe('a b c')
    expect(normalizeEvidenceUri('HTTPS://Example.COM:443/doc/')).toBe('https://example.com/doc')
    expect(normalizeEvidenceUri('http://Example.com:80/a')).toBe('http://example.com/a')

    const left = evidenceContentHash({ sourceType: 'observation', inlineText: 'a\r\nb' })
    const right = evidenceContentHash({ sourceType: 'observation', inlineText: '  a  b  ' })
    expect(left).toBe(right)
  })

  it('keeps genuinely different material apart', () => {
    const base = { sourceType: 'observation', inlineText: 'a' }
    expect(evidenceContentHash(base)).not.toBe(
      evidenceContentHash({ sourceType: 'pasted_text', inlineText: 'a' }),
    )
    expect(evidenceContentHash(base)).not.toBe(
      evidenceContentHash({ sourceType: 'observation', inlineText: 'b' }),
    )
    // Query strings and fragments select different documents or places.
    expect(normalizeEvidenceUri('https://a.test/d?page=2')).not.toBe(
      normalizeEvidenceUri('https://a.test/d?page=3'),
    )
    expect(normalizeEvidenceUri('https://a.test/d#a')).not.toBe(
      normalizeEvidenceUri('https://a.test/d#b'),
    )
  })
})

describe('evidence_register', () => {
  it('records the material, the facts read off it, and the claims they bear on', async () => {
    seedSchool('school-1')
    const service = writeService(activeRegistry())

    const result = await service.evidenceRegister(
      { schoolId: 'school-1', agentRunId: RUN },
      registration,
    )

    expect(result.reused).toBe(false)
    expect(result.observationFacts).toHaveLength(2)
    expect(result.claims).toHaveLength(1)

    const stored = database.client
      .prepare('SELECT registered_by, agent_run_id, content_hash FROM evidence WHERE id = ?')
      .get(result.evidenceId) as {
      registered_by: string
      agent_run_id: string
      content_hash: string
    }
    expect(stored.registered_by).toBe('agent')
    expect(stored.agent_run_id).toBe(RUN)
    expect(stored.content_hash).toHaveLength(64)

    const fact = database.client
      .prepare('SELECT extracted_by, agent_run_id FROM observation_facts WHERE id = ?')
      .get(result.observationFacts[0]?.id) as { extracted_by: string; agent_run_id: string }
    expect(fact.extracted_by).toBe('agent')
    expect(fact.agent_run_id).toBe(RUN)

    const claim = database.client
      .prepare('SELECT created_by, agent_run_id FROM claims WHERE id = ?')
      .get(result.claims[0]?.id) as { created_by: string; agent_run_id: string }
    expect(claim.created_by).toBe('agent')
    expect(claim.agent_run_id).toBe(RUN)

    const links = database.client
      .prepare('SELECT stance, sequence FROM claim_facts WHERE claim_id = ? ORDER BY sequence')
      .all(result.claims[0]?.id) as Array<{ stance: string; sequence: number }>
    expect(links).toEqual([
      { stance: 'supporting', sequence: 0 },
      { stance: 'supporting', sequence: 1 },
    ])
  })

  it('returns the existing identifiers when the same material is registered again', async () => {
    seedSchool('school-1')
    const service = writeService(activeRegistry())
    const context = { schoolId: 'school-1', agentRunId: RUN }

    const first = await service.evidenceRegister(context, registration)
    const second = await service.evidenceRegister(context, {
      ...registration,
      // The same passage, re-wrapped and re-indented. L7 says registering the
      // same material again is normal Agent behaviour.
      inlineText: '  教研组把三节课的课堂记录贴到了公共墙上。\r\n\r\n  其他年级也来看。  ',
    })

    expect(second.reused).toBe(true)
    expect(second.evidenceId).toBe(first.evidenceId)
    expect(second.observationFacts.map((item) => item.id)).toEqual(
      first.observationFacts.map((item) => item.id),
    )
    expect(second.claims.map((item) => item.id)).toEqual(first.claims.map((item) => item.id))
    expect(second.observationFacts.every((item) => item.reused)).toBe(true)

    const counts = database.client
      .prepare(
        `SELECT (SELECT count(*) FROM evidence) AS e,
                (SELECT count(*) FROM observation_facts) AS f,
                (SELECT count(*) FROM claims) AS c,
                (SELECT count(*) FROM claim_facts) AS l`,
      )
      .get() as { e: number; f: number; c: number; l: number }
    expect(counts).toEqual({ e: 1, f: 2, c: 1, l: 2 })
  })

  it('refuses to attach a claim to a fact from another school', async () => {
    seedSchool('school-1')
    seedSchool('school-2', '滨江学校')
    const service = writeService(activeRegistry())

    const other = await service.evidenceRegister(
      { schoolId: 'school-2', agentRunId: RUN },
      registration,
    )
    const foreignFactId = other.observationFacts[0]?.id ?? ''

    await expect(
      service.evidenceRegister(
        { schoolId: 'school-1', agentRunId: RUN },
        {
          ...registration,
          observationFacts: [],
          claims: [
            {
              ref: 'c1',
              statement: '借用别校的事实。',
              facts: [{ factId: foreignFactId, stance: 'supporting' }],
            },
          ],
        },
      ),
    ).rejects.toThrowError(/outside the scoped school/u)

    // Nothing from the refused call survived.
    const claimCount = database.client
      .prepare('SELECT count(*) AS count FROM claims WHERE school_id = ?')
      .get('school-1') as { count: number }
    expect(claimCount.count).toBe(0)
  })

  it('refuses a payload whose schoolId contradicts the capability token', async () => {
    seedSchool('school-1')
    const service = writeService(activeRegistry())
    await expect(
      service.evidenceRegister(
        { schoolId: 'school-1', agentRunId: RUN },
        { ...registration, schoolId: 'school-2' },
      ),
    ).rejects.toThrowError(/does not match the scoped school/u)
  })
})

describe('AssessmentInput assembly (decision L2)', () => {
  it('is built only from this school rows', async () => {
    seedSchool('school-1')
    seedSchool('school-2', '滨江学校')
    const registry = activeRegistry()
    const service = writeService(registry)

    await service.evidenceRegister({ schoolId: 'school-1', agentRunId: RUN }, registration)
    await service.evidenceRegister(
      { schoolId: 'school-2', agentRunId: RUN },
      {
        ...registration,
        title: '别校的观察',
        inlineText: '这是另一所学校的材料。',
      },
    )

    const repository = new SqliteWritePlaneRepository(database, registry, () => NOW)
    const input = (await repository.buildAssessmentInput('school-1')) as {
      school: { schoolId: string }
      evidence: Array<{ id: string; schoolId: string }>
      observationFacts: Array<{ schoolId: string }>
      claims: Array<{ schoolId: string }>
      methodologyContext: Array<{ packKey: string; criterionId: string }>
    }

    expect(input.school.schoolId).toBe('school-1')
    expect(input.evidence).toHaveLength(1)
    expect(input.evidence.every((item) => item.schoolId === 'school-1')).toBe(true)
    expect(input.observationFacts.every((item) => item.schoolId === 'school-1')).toBe(true)
    expect(input.claims.every((item) => item.schoolId === 'school-1')).toBe(true)
    expect(input.methodologyContext.some((ref) => ref.criterionId === DW_CRITERION)).toBe(true)
  })

  it('offers only criteria from packs the consultant has not sent back', async () => {
    seedSchool('school-1')
    const repository = new SqliteWritePlaneRepository(
      database,
      registryWith({ 'schooling-by-design': 'review' }),
      () => NOW,
    )
    const input = (await repository.buildAssessmentInput('school-1')) as {
      methodologyContext: Array<{ packKey: string }>
    }
    expect(input.methodologyContext.some((ref) => ref.packKey === 'data-wise')).toBe(true)
    expect(input.methodologyContext.some((ref) => ref.packKey === 'schooling-by-design')).toBe(
      false,
    )
  })

  it('refuses to assemble anything before the school has a current stage', async () => {
    database.client
      .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
      .run('school-3', '未开始的学校', NOW)
    const repository = new SqliteWritePlaneRepository(database, activeRegistry(), () => NOW)
    await expect(repository.buildAssessmentInput('school-3')).rejects.toThrowError(
      /no active Stage/u,
    )
  })
})

describe('diagnosis_propose', () => {
  it('turns a registered chain into an immutable proposal awaiting human review', async () => {
    seedSchool('school-1')
    const registry = activeRegistry()
    await syncPacks(registry)
    const service = writeService(registry)
    const context = { schoolId: 'school-1', agentRunId: RUN }

    const registered = await service.evidenceRegister(context, registration)
    const factIds = registered.observationFacts.map((item) => item.id)

    const proposal = await service.diagnosisPropose(context, {
      type: 'state',
      title: '改进实践开始可见',
      candidate: candidate(
        registered.claims[0]?.id ?? '',
        factIds,
        'school-1-target',
        registered.evidenceId,
      ),
    })

    expect(proposal.status).toBe('proposed')
    expect(proposal.claimIds).toEqual([registered.claims[0]?.id])
    expect(proposal.stageTargetIds).toEqual(['school-1-target'])
    expect(proposal.criteria.map((item) => item.stableKey)).toEqual([DW_CRITERION])

    const stored = database.client
      .prepare('SELECT status, agent_run_id, school_id FROM diagnosis_proposals WHERE id = ?')
      .get(proposal.proposalId) as {
      status: string
      agent_run_id: string | null
      school_id: string
    }
    expect(stored.status).toBe('proposed')
    expect(stored.school_id).toBe('school-1')
    // The provenance column has existed since the first schema; the write plane
    // is the first caller that can fill it.
    expect(stored.agent_run_id).toBe(RUN)

    // No human review yet: the proposal is waiting, not accepted.
    const reviews = database.client
      .prepare('SELECT count(*) AS count FROM human_reviews WHERE proposal_id = ?')
      .get(proposal.proposalId) as { count: number }
    expect(reviews.count).toBe(0)
    expect(service.selfCorrectionRounds(RUN)).toBe(0)
  })

  it('returns the protocol findings unchanged and counts the round (decision L5)', async () => {
    seedSchool('school-1')
    const registry = activeRegistry()
    await syncPacks(registry)
    const service = writeService(registry)
    const context = { schoolId: 'school-1', agentRunId: RUN }
    const registered = await service.evidenceRegister(context, registration)

    const invalid = candidate(
      registered.claims[0]?.id ?? '',
      registered.observationFacts.map((item) => item.id),
      'school-1-target',
      registered.evidenceId,
    )

    await expect(
      service.diagnosisPropose(context, {
        type: 'state',
        title: '引用了不存在的准则',
        candidate: {
          ...invalid,
          criterionMappings: [
            {
              packKey: 'data-wise',
              version: '3',
              criterionId: 'DW.MADE.UP.FROM.THE.WEB',
              reason: '网上看到的说法。',
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(WritePlaneProtocolError)

    // A judgement grounded in something the workbench does not hold cannot be
    // registered, however plausible the wording is.
    try {
      await service.diagnosisPropose(context, {
        type: 'state',
        title: '引用了不存在的准则',
        candidate: {
          ...invalid,
          criterionMappings: [
            {
              packKey: 'data-wise',
              version: '3',
              criterionId: 'DW.MADE.UP.FROM.THE.WEB',
              reason: '网上看到的说法。',
            },
          ],
        },
      })
      throw new Error('expected a protocol rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(WritePlaneProtocolError)
      const errors = (error as WritePlaneProtocolError).errors
      expect(errors.length).toBeGreaterThan(0)
      // The workbench assembled the methodology context from its own active
      // packs, so a criterion the Agent read somewhere else is simply not in it.
      expect(errors.map((item) => item.code)).toContain(
        'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
      )
      expect(errors.every((item) => item.path.length > 0 && item.message.length > 0)).toBe(true)
    }

    expect(service.selfCorrectionRounds(RUN)).toBe(2)
    const proposals = database.client
      .prepare('SELECT count(*) AS count FROM diagnosis_proposals')
      .get() as { count: number }
    expect(proposals.count).toBe(0)

    // A refused candidate leaves the registered grounds untouched, so the Agent
    // can correct and resubmit without duplicating anything.
    const claimCount = database.client.prepare('SELECT count(*) AS count FROM claims').get() as {
      count: number
    }
    expect(claimCount.count).toBe(1)
  })

  it('fails closed once the consultant sends the pack back for revision', async () => {
    seedSchool('school-1')
    const registry = activeRegistry()
    await syncPacks(registry)
    const active = writeService(registry)
    const context = { schoolId: 'school-1', agentRunId: RUN }
    const registered = await active.evidenceRegister(context, registration)
    const body = {
      type: 'state' as const,
      title: '改进实践开始可见',
      candidate: candidate(
        registered.claims[0]?.id ?? '',
        registered.observationFacts.map((item) => item.id),
        'school-1-target',
        registered.evidenceId,
      ),
    }
    await expect(active.diagnosisPropose(context, body)).resolves.toBeDefined()

    // Same chain, same candidate — but Data Wise is no longer active.
    const withdrawn = writeService(registryWith({ 'data-wise': 'review' }))
    await expect(withdrawn.diagnosisPropose(context, body)).rejects.toBeInstanceOf(
      WritePlaneProtocolError,
    )
    const rejection = await withdrawn
      .diagnosisPropose(context, body)
      .then(() => null)
      .catch((error: unknown) => error as WritePlaneProtocolError)
    expect(rejection?.errors.map((item) => item.code)).toContain(
      'ASSESSMENT_CRITERION_MAPPING_NOT_IN_CONTEXT',
    )
  })

  it('refuses a candidate that cites another school rows', async () => {
    seedSchool('school-1')
    seedSchool('school-2', '滨江学校')
    const registry = activeRegistry()
    await syncPacks(registry)
    const service = writeService(registry)

    const other = await service.evidenceRegister(
      { schoolId: 'school-2', agentRunId: RUN },
      registration,
    )

    await expect(
      service.diagnosisPropose(
        { schoolId: 'school-1', agentRunId: RUN },
        {
          type: 'state',
          title: '借用别校的判断',
          candidate: candidate(
            other.claims[0]?.id ?? '',
            other.observationFacts.map((item) => item.id),
            'school-1-target',
            other.evidenceId,
          ),
        },
      ),
    ).rejects.toBeInstanceOf(WritePlaneProtocolError)
  })
})

describe('stage_propose', () => {
  const proposalInput = {
    title: '建立共同推动改进的组织基础',
    summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
    focus: '这个阶段现在最需要看到：中层开始独立承担关键任务，学校形成可重复的协作方式。',
    targets: {
      leadership: { title: '领导力', description: '领导团队持续追问改进行动是否带来变化。' },
      key_tasks: { title: '关键任务', description: '关键改进任务由中层独立拆解和推进。' },
      structure: { title: '结构与机制', description: '形成稳定的任务分工、推进节奏和复盘机制。' },
      culture: { title: '文化', description: '中层能够公开讨论问题并对结果负责。' },
      capability: { title: '能力', description: '中层能够独立分析问题、制定行动并完成复盘。' },
    },
  }

  it('writes the first planned stage with five draft targets and no judgment links', async () => {
    database.client
      .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
      .run('school-stage-1', '从零开始的学校', NOW)
    const service = writeService(activeRegistry())

    const result = await service.stagePropose(
      { schoolId: 'school-stage-1', agentRunId: RUN },
      proposalInput,
    )

    expect(result.status).toBe('planned')
    expect(result.stageId).toMatch(/^[A-Z0-9]+$/u)
    expect(result.targets).toHaveLength(5)

    const stageRow = database.client
      .prepare('SELECT status, sequence FROM stages WHERE id = ?')
      .get(result.stageId) as { status: string; sequence: number }
    expect(stageRow.status).toBe('planned')
    expect(stageRow.sequence).toBe(1)

    const targetRows = database.client
      .prepare('SELECT status, dimension_key FROM stage_targets WHERE stage_id = ?')
      .all(result.stageId) as Array<{ status: string; dimension_key: string }>
    expect(targetRows).toHaveLength(5)
    expect(targetRows.every((target) => target.status === 'draft')).toBe(true)

    const links = database.client
      .prepare('SELECT judgment_id FROM stage_judgments WHERE stage_id = ?')
      .all(result.stageId)
    expect(links).toHaveLength(0)
  })

  it('refuses when the school already has a planned or active stage', async () => {
    seedSchool('school-1')
    const service = writeService(activeRegistry())
    await expect(
      service.stagePropose({ schoolId: 'school-1', agentRunId: RUN }, proposalInput),
    ).rejects.toThrowError(/already has a pending or current Stage/u)
  })

  it('refuses for a school that does not exist', async () => {
    const service = writeService(activeRegistry())
    await expect(
      service.stagePropose({ schoolId: 'missing-school', agentRunId: RUN }, proposalInput),
    ).rejects.toThrowError(/Scoped school was not found/u)
  })
})
