import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { createModels, createProvider, type Model, type Models } from '@earendil-works/pi-ai'
import { z } from 'zod'
import { AgentHostError } from '../contracts'

/**
 * The one thing the controlled harness cannot supply itself: a model to talk to.
 *
 * Codex brings its own — the consultant logs into it and the workbench never
 * sees a credential (decision L1, SPEC 12/64). A harness running inside this
 * process has no such account, so the endpoint and key have to come from the
 * consultant through the settings page. That is a real difference between the
 * two assistants and it is not smoothed over: the built-in assistant is not
 * usable until somebody fills this in, and it says so plainly rather than
 * failing later with a network error.
 *
 * Only an OpenAI-compatible chat-completions endpoint is accepted. Not a
 * limitation worth apologising for — it is what almost every hosted Chinese
 * model service speaks, including the one this workbench is heading for — and
 * one wire protocol means one code path to keep honest.
 */

/** How the endpoint may be written. */
const baseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return false
    }
    // Plain http is allowed only for a loopback address. A key travelling in
    // clear text to another machine is not something to leave to the
    // consultant to notice.
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  }, '模型地址必须是 https 开头的网址（本机地址除外）。')

export const modelChannelConfigSchema = z
  .object({
    baseUrl: baseUrlSchema,
    /** The model id the endpoint expects, e.g. an inference endpoint id. */
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(4000),
  })
  .strict()

export type ModelChannelConfig = z.infer<typeof modelChannelConfigSchema>

/**
 * What the settings page holds, which is not the same thing.
 *
 * The key is absent here on purpose: this shape is read back for display, and
 * a secret that is never read back cannot be leaked by a surface that displays
 * it. Whether one is stored is a boolean.
 */
export type ModelChannelStatus = Readonly<{
  baseUrl: string | null
  model: string | null
  hasApiKey: boolean
}>

export function isModelChannelComplete(status: ModelChannelStatus): boolean {
  return Boolean(status.baseUrl) && Boolean(status.model) && status.hasApiKey
}

/** Internal provider id. Never shown; it names a route inside the harness. */
export const workbenchModelProviderId = 'workbench-model-channel'

/**
 * Builds the single-route provider the built-in assistant talks through.
 *
 * `resolve()` hands back the configured key and nothing else — no environment
 * variable is consulted, so a stray `OPENAI_API_KEY` on the consultant's
 * machine can never silently become the credential a school's analysis was run
 * with. Returning `undefined` is how "not configured" is expressed, and the
 * harness turns that into a refused run rather than an attempted request.
 */
export function createWorkbenchModelChannel(config: ModelChannelConfig): Readonly<{
  models: Models
  model: Model<'openai-completions'>
}> {
  const parsed = modelChannelConfigSchema.safeParse(config)
  if (!parsed.success) {
    throw new AgentHostError(
      'MODEL_CHANNEL_NOT_CONFIGURED',
      'The model connection is incomplete or malformed.',
    )
  }
  const { baseUrl, model: modelId, apiKey } = parsed.data

  const model: Model<'openai-completions'> = {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: workbenchModelProviderId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    // Nothing here is billed by this workbench and no cost is ever shown, so
    // the honest value is zero rather than a made-up price list.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Deliberately conservative defaults: the endpoint is whatever the
    // consultant pointed at, and its real limits are not discoverable from
    // here. The provider is the authority and will refuse an oversized
    // request itself.
    contextWindow: 128_000,
    maxTokens: 8_192,
  }

  const provider = createProvider<'openai-completions'>({
    id: workbenchModelProviderId,
    name: 'Workbench model connection',
    baseUrl,
    auth: {
      apiKey: {
        name: 'Workbench model connection key',
        resolve: async ({ signal }) => {
          signal.throwIfAborted()
          return { auth: { apiKey }, source: 'workbench settings' }
        },
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  })

  const models = createModels()
  models.setProvider(provider)
  return Object.freeze({ models, model })
}
