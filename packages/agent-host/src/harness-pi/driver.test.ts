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
    const driver = new PiHarnessDriver(dependencies({ createChannel: scripted.channel, call }))
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
      dependencies({ createChannel: scripted.channel, call: async () => ({}) }),
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
    expect(result.status).toBe('completed')
    expect(diagnostics.some((message) => message.includes('turn bound'))).toBe(true)
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
