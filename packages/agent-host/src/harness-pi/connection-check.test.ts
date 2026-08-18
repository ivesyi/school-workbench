import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Model,
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { connectionCheckOutcomes, connectionCheckPromptText } from '../connection-check'
import type { HarnessCapabilityGrant } from '../harness/contracts'
import { runBuiltinAssistantConnectionCheck } from './connection-check'
import type { PiHarnessChannel } from './driver'
import type { ModelChannelConfig } from './model-channel'

const grant: HarnessCapabilityGrant = Object.freeze({
  endpoint: 'http://127.0.0.1:1/internal/v1',
  token: 'a'.repeat(43),
  schoolId: 'connection-check-probe',
  agentRunId: 'connection-check-probe',
})

const channelConfig: ModelChannelConfig = Object.freeze({
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  apiKey: 'k'.repeat(12),
})

type Scripted = Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]

function scriptedChannel(responses: Scripted): {
  create: (config: ModelChannelConfig) => PiHarnessChannel
  systemPrompts: string[]
} {
  const systemPrompts: string[] = []
  const faux = fauxProvider({ provider: 'probe-faux', models: [{ id: 'test-model' }] })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return {
    systemPrompts,
    create: () => ({
      models: {
        ...models,
        streamSimple: (model, context, options) => {
          systemPrompts.push(context.systemPrompt ?? '')
          return models.streamSimple(model, context, options)
        },
      },
      model: faux.getModel() as Model<string>,
    }),
  }
}

describe('the built-in assistant’s connection test', () => {
  it('reports ok when the model answers a trivial prompt', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('可以')])])
    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => channelConfig,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
      },
      { grant },
    )

    expect(result.outcome).toBe('ok')
    expect(result.modelAnswered).toBe(true)
    // The probe must not send the Agent Bootstrap: that text tells the
    // assistant to go and read a school, and this one has no school.
    expect(scripted.systemPrompts).toEqual([connectionCheckPromptText])
    expect(scripted.systemPrompts[0]).not.toContain('school_context')
  })

  it('says the assistant is not set up yet rather than blaming the model', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('never')])])
    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => null,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
      },
      { grant },
    )

    expect(result.outcome).toBe('runtime_unavailable')
    expect(result.detail).toContain('MODEL_CHANNEL_NOT_CONFIGURED')
    // Nothing was asked of any model.
    expect(scripted.systemPrompts).toEqual([])
  })

  it('blames the model service when the request itself fails', async () => {
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxText('')], {
        stopReason: 'error',
        errorMessage: '401 Unauthorized',
      }),
    ])
    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => channelConfig,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
      },
      { grant },
    )

    expect(result.outcome).toBe('model_backend_unreachable')
    expect(result.detail).toContain('401 Unauthorized')
  })

  it('treats a silent turn as the model not answering', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('')], { stopReason: 'stop' })])
    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => channelConfig,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
      },
      { grant },
    )

    expect(result.outcome).toBe('model_backend_unreachable')
    expect(result.modelAnswered).toBe(false)
  })

  it('reports honestly about the two outcomes an in-process harness cannot produce', async () => {
    const scripted = scriptedChannel([fauxAssistantMessage([fauxText('可以')])])
    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => channelConfig,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
      },
      { grant },
    )

    // The six outcomes are shared vocabulary. This harness starts no MCP
    // subprocess, so it never has a startup report to classify — stated here
    // rather than left for somebody to wonder about.
    expect(connectionCheckOutcomes).toContain('workbench_tools_cancelled')
    expect(result.mcpStartup).toBe('not_reported')
    expect(result.outcome).not.toBe('workbench_tools_cancelled')
    expect(result.protocolVersion).toBeNull()
  })

  it('spends nothing on a school even if the model ignores the prompt and calls a tool', async () => {
    const calls: string[] = []
    const scripted = scriptedChannel([
      fauxAssistantMessage([fauxToolCall('school_context', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('可以')], { stopReason: 'stop' }),
    ])

    const result = await runBuiltinAssistantConnectionCheck(
      {
        resolveChannel: async () => channelConfig,
        harnessVersion: '0.0.0-test',
        createChannel: scripted.create,
        call: async (tool) => {
          calls.push(tool)
          return {}
        },
      },
      { grant },
    )

    // The grant it was handed belongs to no school, so even this reaches
    // nothing real — and it is reported rather than hidden.
    expect(calls).toEqual(['school_context'])
    expect(result.workbenchToolCalls).toEqual(['school_context'])
    // One turn only: a probe that kept going would be a run, not a check.
    expect(scripted.systemPrompts).toHaveLength(1)
  })
})
