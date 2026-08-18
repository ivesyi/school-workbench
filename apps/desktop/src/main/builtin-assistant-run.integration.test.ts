import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Context,
  type Model,
} from '@earendil-works/pi-ai'
import { GroundedDiagnosisService, JudgmentService } from '@school-workbench/application'
import {
  openWorkbenchDatabase,
  SqliteAgentRuntimeRepository,
  SqliteGroundedDiagnosisRepository,
  SqliteJudgmentRepository,
  SqliteMethodologyRepository,
  SqliteReadPlaneRepository,
  SqliteWritePlaneRepository,
  type WorkbenchDatabase,
} from '@school-workbench/db'
import {
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
} from '@school-workbench/methodology'
import type { AgentProgressPhase } from '@school-workbench/shared'
import {
  createWorkbenchReadPlaneBootstrap,
  WorkbenchReadCapabilityService,
  WorkbenchWriteCapabilityService,
  type WorkbenchLoopbackReadPlane,
} from '@school-workbench/workbench-read-plane'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkbenchAgentTools } from '@school-workbench/agent-host'
import { readScopes } from '@school-workbench/workbench-read-plane'
import { progressLabel } from '../renderer/features/schools/assistant-flow'
import { runAgentOnce, type AgentRuntimeDependencies } from './agent-runtime'

/**
 * The built-in assistant, driven through the product's own composition root,
 * with everything on the workbench side real.
 *
 * Real SQLite with the real migrations. The real loopback read plane over real
 * HTTP on a real port. Real capability tokens carrying real scopes. The real
 * assessment gate. The real methodology packs off disk. The real agent loop
 * from the pinned harness, dispatching real tool calls over real fetch.
 *
 * The only substitution is the model, which is scripted — the same
 * substitution the manual Codex acceptance runs exist to cover. So this file is
 * not a claim that the built-in assistant works against a real model. It is a
 * claim that everything between the model and the database does.
 */
const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const NOW = '2026-08-19T00:00:00.000Z'
const SCHOOL = 'school-1'

let database: WorkbenchDatabase
let plane: WorkbenchLoopbackReadPlane
let endpoint = ''
let writeService: WorkbenchWriteCapabilityService
let judgments: JudgmentService

function activeRegistry(): MethodologyRegistry {
  const base = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  return new MethodologyRegistry(
    base.listPacks().map((pack) => ({ ...pack, status: 'active' }) as MethodologyPack),
  )
}

function seed(target: WorkbenchDatabase): void {
  target.client
    .prepare('INSERT INTO schools (id, name, created_at, archived_at) VALUES (?, ?, ?, NULL)')
    .run(SCHOOL, '南山实验学校', NOW)
  target.client
    .prepare(
      `INSERT INTO stages (id, school_id, title, summary, focus, sequence, status, starts_at,
                           ends_at, adjustment_feedback, created_at, updated_at)
       VALUES ('stage-1', ?, '阶段一', '建立共同推动改进的组织基础', '结构与机制', 1, 'active', ?, NULL, NULL, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW, NOW)
  target.client
    .prepare(
      `INSERT INTO stage_targets (id, stage_id, school_id, dimension_key, title, description,
                                  status, sequence, created_at, updated_at)
       VALUES ('target-1', 'stage-1', ?, 'structure', '让改进实践变得可见',
               '教研与课堂实践能够被同伴看见。', 'confirmed', 1, ?, ?)`,
    )
    .run(SCHOOL, NOW, NOW)
}

beforeEach(async () => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
  const registry = activeRegistry()
  await new SqliteMethodologyRepository(database.db).syncRegistry(registry)
  seed(database)

  writeService = new WorkbenchWriteCapabilityService(
    new SqliteWritePlaneRepository(database, registry),
    new GroundedDiagnosisService(registry, new SqliteGroundedDiagnosisRepository(database.db)),
  )
  plane = createWorkbenchReadPlaneBootstrap(
    new WorkbenchReadCapabilityService(
      new SqliteReadPlaneRepository(database),
      registry,
      new SqliteMethodologyRepository(database.db),
    ),
    { writeService },
  )
  endpoint = await plane.start()
  judgments = new JudgmentService(new SqliteJudgmentRepository(database.db))
})

afterEach(async () => {
  await plane.stop()
  database.close()
})

type Scripted = Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]

function scriptedChannel(responses: Scripted) {
  const faux = fauxProvider({ provider: 'integration-faux', models: [{ id: 'integration-model' }] })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return () => ({ models, model: faux.getModel() as Model<string> })
}

/**
 * Reads the last successful tool result out of the conversation.
 *
 * This is how the scripted model learns the identifiers `evidence_register`
 * minted, the same way a real one would: by reading its own tool results. It
 * keeps the test from having to know or fake ids the write plane owns.
 */
function lastToolResult(context: Context, toolName: string): Record<string, unknown> {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index]
    if (!message || message.role !== 'toolResult' || message.toolName !== toolName) continue
    const block = message.content.find((item) => item.type === 'text')
    if (!block || block.type !== 'text') continue
    return JSON.parse(block.text) as Record<string, unknown>
  }
  throw new Error(`no ${toolName} result in the conversation`)
}

const readSchool = fauxAssistantMessage([fauxToolCall('school_context', {})], {
  stopReason: 'toolUse',
})
const readStandards = fauxAssistantMessage(
  [
    fauxToolCall('standards_get', {
      packKey: 'data-wise',
      version: '3',
      criterionRefs: ['DW.C2.PRACTICE_VISIBILITY'],
    }),
  ],
  { stopReason: 'toolUse' },
)
const readHistory = fauxAssistantMessage([fauxToolCall('state_history', { limit: 5 })], {
  stopReason: 'toolUse',
})
const registerGrounds = fauxAssistantMessage(
  [
    fauxToolCall('evidence_register', {
      sourceType: 'observation',
      title: '九月教研观察记录',
      inlineText: '教研组把三节课的课堂记录贴到了公共墙上。\n其他年级也来看。',
      locator: 'p.1',
      observationFacts: [
        {
          ref: 'f1',
          factType: 'organization',
          text: '教研组把三节课的课堂记录贴到公共墙上。',
          locator: 'p.1 段2',
          directness: 'high',
        },
      ],
      claims: [
        {
          ref: 'c1',
          statement: '这所学校的改进实践已经开始在公共空间被同伴看见。',
          facts: [{ factRef: 'f1', stance: 'supporting' }],
        },
      ],
    }),
  ],
  { stopReason: 'toolUse' },
)

/**
 * Submits a judgement citing what the previous step actually registered.
 *
 * `overrides` lets a test bend one field to see the strict contract refuse it.
 */
function proposeJudgment(overrides: Record<string, unknown> = {}) {
  return (context: Context) => {
    const registration = lastToolResult(context, 'evidence_register')
    const facts = registration.observationFacts as Array<{ id: string }>
    const claims = registration.claims as Array<{ id: string }>
    const factId = facts[0]!.id
    const claimId = claims[0]!.id
    return fauxAssistantMessage(
      [
        fauxToolCall('diagnosis_propose', {
          type: 'state',
          title: '改进实践开始可见',
          candidate: {
            protocolVersion: 1,
            claimRefs: [claimId],
            criterionMappings: [
              {
                packKey: 'data-wise',
                version: '3',
                criterionId: 'DW.C2.PRACTICE_VISIBILITY',
                reason: '公共墙上的课堂记录正对应实践可见性这条准则。',
              },
            ],
            stageTargetRefs: ['target-1'],
            supportingFactRefs: [factId],
            counterFactRefs: [],
            counterEvidenceSearch: {
              completed: true,
              summary: '查了同一份记录里是否有相反迹象，没有发现。',
              searchedEvidenceRefs: [registration.evidenceId as string],
              searchedFactRefs: [factId],
            },
            interpretations: [
              {
                kind: 'interpretation',
                id: 'i1',
                summary: '贴到公共空间意味着实践开始可被同伴检视。',
                factRefs: [factId],
              },
            ],
            provisionalJudgment: '改进实践已经开始可见，但还只发生在一个教研组。',
            mechanism: null,
            alternativeHypotheses: ['也可能只是这一次公开课的临时安排。'],
            unresolvedQuestions: [],
            recommendedActions: [],
            nextObservations: ['下月再看一次公共墙是否仍在更新。'],
            impactEvidencePlan: [],
            evidenceQuality: {
              directness: 'high',
              triangulation: 'single_source',
              limitations: ['只有一份观察记录。'],
            },
            confidence: 'medium',
            status: 'proposed',
            ...overrides,
          },
        }),
      ],
      { stopReason: 'toolUse' },
    )
  }
}

const done = fauxAssistantMessage([fauxText('判断已经提交，等你确认。')], { stopReason: 'stop' })

function dependencies(overrides: Partial<AgentRuntimeDependencies> = {}): AgentRuntimeDependencies {
  return {
    assistant: 'builtin',
    resolveModelChannel: async () => ({
      baseUrl: 'https://example.invalid/v1',
      model: 'integration-model',
      apiKey: 'test-key',
    }),
    readPlane: plane,
    writeService,
    endpoint,
    repository: new SqliteAgentRuntimeRepository(database),
    mainDirectory: resolve('apps/desktop/out/main'),
    execPath: process.execPath,
    userDataDirectory: resolve('apps/desktop/out'),
    judgments,
    ...overrides,
  }
}

describe('the built-in assistant against the real workbench', () => {
  it('produces a judgement that passed the strict contract, in real SQLite', async () => {
    const phases: AgentProgressPhase[] = []
    const view = await runAgentOnce(
      dependencies({
        createModelChannel: scriptedChannel([
          readSchool,
          readStandards,
          readHistory,
          registerGrounds,
          proposeJudgment(),
          done,
        ]),
        onProgress: (phase) => phases.push(phase),
      }),
      { schoolId: SCHOOL, message: '看看这所学校最近的变化' },
    )

    expect(view.failureCode).toBeNull()
    expect(view.status).toBe('completed')
    expect(view.usedWorkbenchTools).toBe(true)
    expect(view.outcome).toBe('proposal_ready')
    expect(view.proposal).not.toBeNull()
    expect(view.runtimeCompatibility).toBe('verified')

    // The grounds really landed, through the loopback, under the scoped school.
    const evidenceCount = database.client
      .prepare('SELECT COUNT(*) AS count FROM evidence WHERE school_id = ?')
      .get(SCHOOL) as { count: number }
    expect(evidenceCount.count).toBe(1)

    // And so did the judgement, awaiting a human, tied to this run.
    const stored = database.client
      .prepare(
        'SELECT status, agent_run_id, school_id FROM diagnosis_proposals ORDER BY created_at DESC LIMIT 1',
      )
      .get() as { status: string; agent_run_id: string; school_id: string }
    expect(stored).toEqual({ status: 'proposed', agent_run_id: view.runId, school_id: SCHOOL })

    // SPEC 25: nothing was confirmed on the consultant's behalf.
    const accepted = database.client
      .prepare('SELECT COUNT(*) AS count FROM accepted_judgments')
      .get() as { count: number }
    expect(accepted.count).toBe(0)

    // PRD 16: the four steps, in order, and nothing else on screen.
    //
    // The first one is pushed before any tool call, because the wait starts
    // immediately and the first call can be a long way off; `school_context`
    // then reports the same step again. Identical to the Codex path — the same
    // `nextProgressPhase` and the same opening nudge drive both.
    expect(phases).toEqual(['understanding', 'understanding', 'gathering', 'comparing', 'drafting'])
    expect([...new Set(phases)].map(progressLabel)).toEqual([
      '正在理解学校现在的情况……',
      '正在寻找相关材料……',
      '正在比较最近变化……',
      '正在整理需要你确认的判断……',
    ])
  })

  it('lets the assistant correct a refused candidate and counts the round', async () => {
    const view = await runAgentOnce(
      dependencies({
        createModelChannel: scriptedChannel([
          registerGrounds,
          // A criterion nobody can cite: the assessment gate must refuse it and
          // hand back findings specific enough to fix.
          proposeJudgment({
            criterionMappings: [
              {
                packKey: 'data-wise',
                version: '3',
                criterionId: 'DW.NOT.A.REAL.CRITERION',
                reason: '这条准则并不存在。',
              },
            ],
          }),
          proposeJudgment(),
          done,
        ]),
      }),
      { schoolId: SCHOOL, message: '看看这所学校最近的变化' },
    )

    expect(view.outcome).toBe('proposal_ready')

    // Decision L5: the refused round is recorded rather than smoothed over.
    const run = database.client
      .prepare('SELECT self_correction_rounds FROM agent_runs WHERE id = ?')
      .get(view.runId) as { self_correction_rounds: number }
    expect(run.self_correction_rounds).toBe(1)

    // The refusal wrote nothing: exactly one proposal exists.
    const proposals = database.client
      .prepare('SELECT COUNT(*) AS count FROM diagnosis_proposals')
      .get() as { count: number }
    expect(proposals.count).toBe(1)
  })

  it('records the run against its own runtime profile without inventing protocol facts', async () => {
    const view = await runAgentOnce(
      dependencies({
        createModelChannel: scriptedChannel([
          fauxAssistantMessage([fauxText('这次没有形成新的判断。')], { stopReason: 'stop' }),
        ]),
      }),
      { schoolId: SCHOOL, message: '随便看看' },
    )

    expect(view.outcome).toBe('no_new_judgment')

    const session = database.client
      .prepare(
        `SELECT s.acp_session_id, s.protocol_version, s.agent_name, s.agent_version, s.compatibility, p.key
           FROM agent_sessions s JOIN runtime_profiles p ON p.id = s.runtime_profile_id
          ORDER BY s.created_at DESC LIMIT 1`,
      )
      .get() as {
      acp_session_id: string | null
      protocol_version: number | null
      agent_name: string | null
      agent_version: string | null
      compatibility: string
      key: string
    }

    expect(session.key).toBe('builtin')
    // No protocol was negotiated and no ACP session existed, so neither is
    // filled in with a plausible-looking value.
    expect(session.acp_session_id).toBeNull()
    expect(session.protocol_version).toBeNull()
    expect(session.agent_name).toBe('workbench-builtin-harness')
    expect(session.agent_version).toBe('0.84.2')
    expect(session.compatibility).toBe('verified')
  })

  it('refuses a run with no model connection without touching the school', async () => {
    const view = await runAgentOnce(
      dependencies({
        resolveModelChannel: async () => null,
        createModelChannel: scriptedChannel([fauxAssistantMessage([fauxText('never')])]),
      }),
      { schoolId: SCHOOL, message: '看看这所学校' },
    )

    expect(view.status).toBe('failed')
    expect(view.outcome).toBe('failed')
    expect(view.failureCode).toBe('MODEL_CHANNEL_NOT_CONFIGURED')
    expect(view.usedWorkbenchTools).toBe(false)
    const evidence = database.client.prepare('SELECT COUNT(*) AS count FROM evidence').get() as {
      count: number
    }
    expect(evidence.count).toBe(0)
  })
})

/**
 * The tools an in-process harness holds are ordinary function objects, so the
 * obvious worry is that they carry more authority than the MCP surface does.
 * They do not: the authority is in the token they spend, which the loopback
 * checks on every call. These tests spend a deliberately weaker token against
 * the real plane to show where the refusal comes from.
 */
describe('what the built-in assistant’s tools are actually allowed to do', () => {
  function toolsWith(scopes: readonly string[], schoolId = SCHOOL) {
    const grant = plane.issueToken({ schoolId, agentRunId: 'run-scope-test', scopes })
    return createWorkbenchAgentTools({
      endpoint,
      token: grant.token,
      schoolId,
      agentRunId: 'run-scope-test',
    })
  }

  function tool(tools: ReturnType<typeof createWorkbenchAgentTools>, name: string) {
    const found = tools.find((entry) => entry.name === name)
    if (!found) throw new Error(`missing tool ${name}`)
    return found
  }

  it('refuses a write when the token carries only read scopes', async () => {
    // Every tool is still *present* — the model sees the same ten either way,
    // exactly as it does over MCP. What it can spend is the difference.
    const tools = toolsWith(readScopes)

    await expect(
      tool(tools, 'evidence_register').execute('call-1', {
        sourceType: 'observation',
        title: '不该写进去的材料',
        inlineText: '这次调用不该成功。',
      }),
    ).rejects.toThrow(/AUTH_SCOPE_DENIED/u)

    // And nothing was written on the way to being refused.
    const evidence = database.client.prepare('SELECT COUNT(*) AS count FROM evidence').get() as {
      count: number
    }
    expect(evidence.count).toBe(0)
  })

  it('reads nothing at all when the token names a different school', async () => {
    const tools = toolsWith(readScopes, 'some-other-school')

    // The token is valid; the school it names simply is not this one, and the
    // read plane answers about the token's school rather than the argument's.
    await expect(
      tool(tools, 'school_context').execute('call-1', { schoolId: SCHOOL }),
    ).rejects.toThrow()

    const result = await tool(tools, 'school_context')
      .execute('call-2', {})
      .catch((error: unknown) => error)
    expect(String(result)).not.toContain('南山实验学校')
  })

  it('has no route at all to the four capabilities SPEC 25 forbids', async () => {
    const tools = toolsWith(readScopes)
    for (const forbidden of [
      'diagnosis_accept',
      'diagnosis_reject',
      'state_commit',
      'stage_activate',
    ]) {
      expect(
        tools.some((entry) => entry.name === forbidden),
        forbidden,
      ).toBe(false)
    }

    // Not merely absent from the tool list: the loopback has no such route, so
    // a driver that invented one would still be refused.
    const grant = plane.issueToken({
      schoolId: SCHOOL,
      agentRunId: 'run-scope-test',
      scopes: readScopes,
    })
    const response = await fetch(`${endpoint}/state_commit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${grant.token}`,
        'content-type': 'application/json',
        'x-swb-school-id': SCHOOL,
        'x-swb-agent-run-id': 'run-scope-test',
      },
      body: '{}',
    })
    expect(response.status).toBe(404)
  })
})
