import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Model,
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { agentBootstrapText } from '../bootstrap'
import type { HarnessCapabilityGrant } from '../harness/contracts'
import {
  CONNECTION_CHECK_MAX_TURNS,
  DEFAULT_MAX_TURNS,
  PiHarnessDriver,
  piHarnessAgentName,
  type PiHarnessChannel,
  type PiHarnessDependencies,
} from './driver'
import type { ModelChannelConfig } from './model-channel'
import { WorkbenchToolCallError, type WorkbenchToolCaller } from './workbench-tools'

const grant: HarnessCapabilityGrant = Object.freeze({
  endpoint: 'http://127.0.0.1:1/internal/v1',
  token: 'a'.repeat(43),
  schoolId: 'school-1',
  agentRunId: 'run-1',
})

const channelConfig: ModelChannelConfig = Object.freeze({
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  apiKey: 'k'.repeat(12),
})

type Scripted = Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]

/**
 * A scripted model behind the real channel seam.
 *
 * The harness ships this faux provider itself, so the loop under test is the
 * production loop: same `runAgentLoop`, same tool dispatch, same message
 * assembly. Only the wire call at the far end is replaced.
 */
function scriptedChannel(responses: Scripted): {
  channel: (config: ModelChannelConfig) => PiHarnessChannel
  seenTools: () => readonly string[]
  seenSystemPrompts: () => readonly string[]
  configs: ModelChannelConfig[]
} {
  const seenTools: string[][] = []
  const seenSystemPrompts: string[] = []
  const configs: ModelChannelConfig[] = []
  const faux = fauxProvider({ provider: 'test-faux', models: [{ id: 'test-model' }] })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)

  return {
    channel: (config) => {
      configs.push(config)
      return {
        models: {
          ...models,
          streamSimple: (model, context, options) => {
            seenTools.push((context.tools ?? []).map((tool) => tool.name))
            seenSystemPrompts.push(context.systemPrompt ?? '')
            return models.streamSimple(model, context, options)
          },
        },
        model: faux.getModel() as Model<string>,
      }
    },
    seenTools: () => seenTools.at(-1) ?? [],
    seenSystemPrompts: () => seenSystemPrompts,
    configs,
  }
}

function dependencies(
  overrides: Partial<PiHarnessDependencies> & Pick<PiHarnessDependencies, 'createChannel'>,
): PiHarnessDependencies {
  return {
    resolveChannel: async () => channelConfig,
    harnessVersion: '0.0.0-test',
    ...overrides,
  }
}

/** Schema-valid enough for the harness to dispatch the tool. */
const validDiagnosisProposeInput = Object.freeze({
  type: 'state',
  title: '改进实践开始可见',
  candidate: {
    protocolVersion: 1,
    claimRefs: ['c1'],
    criterionMappings: [
      {
        packKey: 'data-wise',
        version: '3',
        criterionId: 'DW.C2.PRACTICE_VISIBILITY',
        reason: '公共墙上的课堂记录正对应实践可见性这条准则。',
      },
    ],
    stageTargetRefs: ['target-1'],
    supportingFactRefs: ['f1'],
    counterFactRefs: [],
    counterEvidenceSearch: {
      completed: true,
      summary: '查了同一份记录里是否有相反迹象，没有发现。',
      searchedEvidenceRefs: ['e1'],
      searchedFactRefs: ['f1'],
    },
    interpretations: [
      {
        kind: 'interpretation',
        id: 'i1',
        summary: '贴到公共空间意味着实践开始可被同伴检视。',
        factRefs: ['f1'],
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
  },
})

const validStageProposeInput = Object.freeze({
  title: '起始阶段',
  summary: '建立共同推动改进的组织基础',
  focus: '结构与机制',
  targets: {
    leadership: { title: '领导', description: '领导层把改进排进日常议程。' },
    key_tasks: { title: '任务', description: '明确本阶段要推动的关键任务。' },
    structure: { title: '结构', description: '让教研改进有固定的组织位置。' },
    culture: { title: '文化', description: '把公开讨论实践当成常态。' },
    capability: { title: '能力', description: '教师能看见并讨论彼此的课。' },
  },
})

describe('built-in assistant driver', () => {
  it('drives one turn, calls a workbench tool, and reports the outcome', async () => {
    const calls: Array<{ tool: string; input: unknown }> = []
    const call: WorkbenchToolCaller = async (tool, input) => {
      calls.push({ tool, input })
      return { school: { id: 'school-1', name: '示范小学' } }
    }
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxToolCall('school_context', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('看完了。')], { stopReason: 'stop' }),
    ])

    const progress: string[] = []
    const statuses: string[] = []
    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: scripted.channel,
        call,
        requireExplicitOutcome: false,
      }),
    )
    const result = await driver.run(
      { grant, consultantMessage: '看看这所学校' },
      {
        onStatus: (status) => statuses.push(status),
        onWorkbenchToolCall: (tool) => progress.push(tool),
      },
    )

    expect(result.status).toBe('completed')
    expect(result.failure).toBeNull()
    expect(result.usedWorkbenchTools).toBe(true)
    expect(result.workbenchToolCalls).toEqual(['school_context'])
    expect(progress).toEqual(['school_context'])
    expect(statuses).toEqual(['running', 'completed'])
    expect(calls).toEqual([{ tool: 'school_context', input: {} }])
    expect(result.text).toContain('看完了。')
  })

  it('offers the model exactly the ten frozen workbench tools and the SPEC 26 bootstrap', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('好的。')])])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
    )
    await driver.run({ grant, consultantMessage: '你好' })

    expect([...scripted.seenTools()].sort()).toEqual([
      'diagnosis_list',
      'diagnosis_propose',
      'evidence_list',
      'evidence_register',
      'school_context',
      'stage_current',
      'stage_propose',
      'standards_get',
      'state_current',
      'state_history',
    ])
    expect(scripted.seenSystemPrompts()).toEqual([agentBootstrapText])
  })

  it('refuses to run at all when no model connection has been configured', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('never')])])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, resolveChannel: async () => null }),
    )

    const result = await driver.run({ grant, consultantMessage: '看看这所学校' })

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('MODEL_CHANNEL_NOT_CONFIGURED')
    // Fail closed: nothing was asked of a model and no tool was reached.
    expect(scripted.configs).toEqual([])
    expect(result.usedWorkbenchTools).toBe(false)
  })

  it('reads the model connection at run time, not at construction time', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxText('一')]),
      fauxAssistantMessage([fauxText('二')]),
    ])
    let configured: ModelChannelConfig | null = null
    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: scripted.channel,
        resolveChannel: async () => configured,
        call: async () => ({}),
        requireExplicitOutcome: false,
      }),
    )

    const before = await driver.run({ grant, consultantMessage: '你好' })
    expect(before.failure?.code).toBe('MODEL_CHANNEL_NOT_CONFIGURED')

    configured = channelConfig
    const after = await driver.run({ grant, consultantMessage: '你好' })
    expect(after.status).toBe('completed')
  })

  it('hands a refused workbench call back to the model verbatim so it can be corrected', async () => {
    const seen: unknown[] = []
    const call: WorkbenchToolCaller = async (tool) => {
      if (tool === 'evidence_register') {
        throw new WorkbenchToolCallError('ASSESSMENT_REFUSED', 'Candidate refused', [
          { code: 'ASSESSMENT_EVIDENCE_MISSING', path: 'claims[0]' },
        ])
      }
      return {}
    }
    const scripted = scriptedChannel([
      fauxAssistantMessage(
        [
          fauxToolCall('evidence_register', {
            sourceType: 'observation',
            title: '课堂观察',
            inlineText: '第三节课，教师提问后平均等待 1 秒。',
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([fauxText('收到，我会修正。')], { stopReason: 'stop' }),
    ])

    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: (config) => {
          const built = scripted.channel(config)
          return {
            models: {
              ...built.models,
              streamSimple: (model, context, options) => {
                seen.push(
                  context.messages
                    .filter((message) => message.role === 'toolResult')
                    .map((message) => message.content),
                )
                return built.models.streamSimple(model, context, options)
              },
            },
            model: built.model,
          }
        },
        call,
        requireExplicitOutcome: false,
      }),
    )

    const result = await driver.run({ grant, consultantMessage: '提交判断' })

    expect(result.status).toBe('completed')
    const lastToolResults = seen.at(-1) as Array<Array<{ type: string; text: string }>>
    expect(lastToolResults).toHaveLength(1)
    // The findings arrive as the exact JSON payload the MCP surface returns,
    // so a refusal is equally correctable on either assistant (decision L5).
    expect(JSON.parse(lastToolResults[0]![0]!.text)).toEqual({
      code: 'ASSESSMENT_REFUSED',
      message: 'Candidate refused',
      errors: [{ code: 'ASSESSMENT_EVIDENCE_MISSING', path: 'claims[0]' }],
    })
  })

  it('records an in-process session identity without inventing protocol facts', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('好的。')])])
    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: scripted.channel,
        call: async () => ({}),
        requireExplicitOutcome: false,
      }),
    )

    const result = await driver.run({ grant, consultantMessage: '你好' })

    expect(result.session).toEqual({
      externalSessionId: null,
      cwd: null,
      compatibility: 'verified',
      protocolVersion: null,
      agentName: piHarnessAgentName,
      agentVersion: '0.0.0-test',
    })
  })

  it('stops at the turn bound instead of looping forever', async () => {
    const scripted = scriptedChannel(
      Array.from({ length: 10 }, () =>
        fauxAssistantMessage([fauxToolCall('school_context', {})], { stopReason: 'toolUse' }),
      ),
    )
    const diagnostics: string[] = []
    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: scripted.channel,
        call: async () => ({}),
        maxTurns: 3,
      }),
    )

    const result = await driver.run(
      { grant, consultantMessage: '一直读' },
      { onDiagnostic: (message) => diagnostics.push(message) },
    )

    expect(result.workbenchToolCalls).toHaveLength(3)
    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('NO_EXPLICIT_OUTCOME')
    expect(diagnostics.some((message) => message.includes('turn bound'))).toBe(true)
  })

  it('keeps the analysis turn bound far above the connection-check bound', () => {
    expect(CONNECTION_CHECK_MAX_TURNS).toBe(1)
    expect(DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(120)
  })

  it('lets an analysis run take more than ten tool turns and still submit a proposal', async () => {
    const reads = Array.from({ length: 12 }, () =>
      fauxAssistantMessage([fauxToolCall('school_context', {})], { stopReason: 'toolUse' }),
    )
    const scripted = scriptedChannel([
      ...reads,
      fauxAssistantMessage([fauxToolCall('diagnosis_propose', validDiagnosisProposeInput)], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxText('判断已经提交。')], { stopReason: 'stop' }),
    ])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
    )

    const result = await driver.run({ grant, consultantMessage: '分析这所学校' })

    expect(result.status).toBe('completed')
    expect(result.failure).toBeNull()
    expect(result.workbenchToolCalls.filter((name) => name === 'school_context')).toHaveLength(12)
    expect(result.workbenchToolCalls).toContain('diagnosis_propose')
  })

  it('fails a run that chats without submitting a proposal or abstaining', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxText('看了一圈，先到这儿。')], { stopReason: 'stop' }),
    ])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
    )

    const result = await driver.run({ grant, consultantMessage: '分析这所学校' })

    expect(result.status).toBe('failed')
    expect(result.status).not.toBe('completed')
    expect(result.failure?.code).toBe('NO_EXPLICIT_OUTCOME')
  })

  it('treats a successful stage proposal as an explicit outcome', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxToolCall('stage_propose', validStageProposeInput)], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxText('阶段已经提议。')], { stopReason: 'stop' }),
    ])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
    )

    const result = await driver.run({ grant, consultantMessage: '这所学校还没有阶段' })

    expect(result.status).toBe('completed')
    expect(result.failure).toBeNull()
    expect(result.workbenchToolCalls).toEqual(['stage_propose'])
  })

  it('does not treat a refused proposal as an explicit outcome', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxToolCall('diagnosis_propose', validDiagnosisProposeInput)], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxText('提交被拒，先停在这儿。')], { stopReason: 'stop' }),
    ])
    const driver = new PiHarnessDriver(
      dependencies({
        createChannel: scripted.channel,
        call: async () => {
          throw new WorkbenchToolCallError('ASSESSMENT_REFUSED', 'Candidate refused')
        },
      }),
    )

    const result = await driver.run({ grant, consultantMessage: '提交判断' })

    expect(result.status).toBe('failed')
    expect(result.failure?.code).toBe('NO_EXPLICIT_OUTCOME')
    expect(result.workbenchToolCalls).toEqual(['diagnosis_propose'])
  })

  it('reports a model service failure as a failed run rather than a silent empty answer', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxText('')], {
        stopReason: 'error',
        errorMessage: 'upstream refused the request',
      }),
    ])
    const driver = new PiHarnessDriver(
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
    )

    const result = await driver.run({ grant, consultantMessage: '你好' })

    expect(result.status).toBe('failed')
    expect(result.failure).toEqual({
      code: 'MODEL_REQUEST_FAILED',
      message: 'upstream refused the request',
    })
  })
})
