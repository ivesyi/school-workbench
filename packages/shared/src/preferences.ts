import { z } from 'zod'

/**
 * The assistants the consultant can pick between.
 *
 * An assistant is not an enhancement the workbench can do without: professional
 * reasoning is the assistant's job, and the workbench has no second way to
 * produce it. So there is no "off" choice here. When no assistant can run, the
 * workbench still shows every school, judgement and state it already holds — it
 * simply cannot start new analysis.
 *
 * The two are **peers**, and PRD 15 means that literally: neither is a fallback
 * for the other, nothing ranks them, and nothing switches between them after a
 * failure. Which one runs is a standing choice a person made.
 *
 * They differ in where the reasoning runs, and that difference is what a
 * consultant is actually choosing between:
 *
 *  - `codex` — a command-line tool the consultant installed and logged into.
 *    The workbench never sees a credential, and never sees the tool coming
 *    either: it updates on its own schedule (ledger §14).
 *  - `builtin` — a model loop inside the workbench itself, pinned to an exact
 *    version by this repository. Nothing to install and nothing that moves
 *    underneath, in exchange for the model connection becoming something the
 *    consultant configures here.
 *
 * `builtin` is deliberately not named after the library it is built on. Which
 * library that is can change without the consultant's choice meaning anything
 * different, and the label they see never mentions one.
 */
export const assistantChoiceSchema = z.enum(['codex', 'builtin'])

export const assistantAvailabilitySchema = z.enum(['ready', 'unavailable'])

export const assistantOptionViewSchema = z.object({
  key: assistantChoiceSchema,
  /** What the consultant sees. Never a package name or a protocol. */
  label: z.string().min(1),
  availability: assistantAvailabilitySchema,
  /** One plain sentence about why it cannot be used, when it cannot. */
  detail: z.string().min(1).nullable(),
})

export const localToolKeySchema = z.enum(['codex_cli', 'lark_cli'])
export const localToolAvailabilitySchema = z.enum(['available', 'unavailable'])

/** Local prerequisites only; this never implies a logged-in external account. */
export const localToolStatusViewSchema = z.object({
  key: localToolKeySchema,
  label: z.string().min(1),
  availability: localToolAvailabilitySchema,
  detail: z.string().min(1),
})

/**
 * Whether Feishu on this computer can actually read a document.
 *
 * Three states a consultant can act on: the tool is missing, it is here but
 * nobody has signed in, or a named account is ready. The workbench never runs
 * the sign-in itself.
 */
export const feishuBindingStateSchema = z.enum(['uninstalled', 'unbound', 'bound'])

export const feishuBindingViewSchema = z.object({
  state: feishuBindingStateSchema,
  /** Present only when a signed-in account name could be read. */
  accountName: z.string().min(1).nullable(),
  /** The exact terminal command to run when the account is not bound. */
  bindCommand: z.string().min(1).nullable(),
  detail: z.string().min(1),
})

export const feishuReadFailureReasonSchema = z.enum([
  'unbound',
  'permission',
  'invalid_link',
  'timeout',
])

export const feishuReadTestInputSchema = z
  .object({
    url: z.string().trim().min(1).max(2000),
  })
  .strict()

/**
 * One throwaway read of a Feishu document the consultant pasted.
 *
 * Same shape as the assistant connection test: shown, never acted on, never
 * retried, and written in the consultant's words.
 */
export const feishuReadTestViewSchema = z.object({
  state: z.enum(['ok', 'failed']),
  headline: z.string().min(1),
  detail: z.string().min(1),
  /** The document title when the read worked. */
  title: z.string().min(1).nullable(),
  durationSeconds: z.number().int().nonnegative(),
  checkedAt: z.string().min(1),
  reason: feishuReadFailureReasonSchema.nullable(),
})

export const runtimeVersionKeySchema = z.enum(['codex_cli', 'codex_acp', 'builtin_harness'])

/**
 * Where an installed version sits against the versions this product has been
 * verified against.
 *
 * Shown and nothing else. It never blocks a run, never picks a different
 * assistant and never changes how anything behaves: SPEC 62 keeps the
 * compatibility verdict on what a runtime actually answers, not on its version
 * number. `unknown` means the version could not be read, which is not a fault.
 */
export const runtimeVersionStandingSchema = z.enum(['verified', 'unverified', 'unknown'])

export const runtimeVersionViewSchema = z.object({
  key: runtimeVersionKeySchema,
  /** What the consultant sees. Never a package name. */
  label: z.string().min(1),
  /** What is installed here, or null when it could not be read. */
  version: z.string().min(1).nullable(),
  standing: runtimeVersionStandingSchema,
  /** One plain line, present only when the version is not a verified one. */
  note: z.string().min(1).nullable(),
})

/**
 * The model connection the built-in assistant talks through.
 *
 * **The key is never in here.** This shape is what the settings page reads back
 * and renders, and a secret that is never read back cannot be leaked by a
 * surface that renders it. Whether one is stored is a boolean; changing it
 * means typing a new one.
 */
export const modelChannelViewSchema = z.object({
  /** The endpoint, which is not a secret and is worth showing back. */
  baseUrl: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  hasApiKey: z.boolean(),
  /**
   * Whether this computer can keep a key safely at all. When it cannot, the
   * workbench refuses to store one rather than falling back to plain text.
   */
  secretStorageAvailable: z.boolean(),
  /** All three parts present, so the built-in assistant can be used. */
  configured: z.boolean(),
  /** One plain sentence about where this stands. */
  detail: z.string().min(1),
})

export const saveModelChannelInputSchema = z
  .object({
    baseUrl: z.string().trim().min(1).max(2000),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(4000),
  })
  .strict()

export const modelChannelSaveResultSchema = z.object({
  saved: z.boolean(),
  /** Why it was not saved, in the consultant's words. Null when it was. */
  problem: z.string().min(1).nullable(),
  channel: modelChannelViewSchema,
})

export const assistantSettingsViewSchema = z.object({
  selected: assistantChoiceSchema,
  options: z.array(assistantOptionViewSchema).min(1),
  localTools: z.array(localToolStatusViewSchema).length(2),
  runtimeVersions: z.array(runtimeVersionViewSchema).length(3),
  modelChannel: modelChannelViewSchema,
  feishu: feishuBindingViewSchema,
})

/**
 * The result of really running one throwaway turn against the assistant.
 *
 * Answers the question installation checks cannot: whether the model behind the
 * assistant can be reached from this computer right now. Written for a
 * consultant, so it carries no path, no error code and no protocol name — and
 * when it fails it says whose problem it is, because the honest answer is "the
 * assistant's environment", never "your school data" and never "what you typed".
 */
export const assistantConnectionCheckStateSchema = z.enum(['ok', 'failed'])

export const assistantConnectionCheckViewSchema = z.object({
  state: assistantConnectionCheckStateSchema,
  /** One short line: did it work. */
  headline: z.string().min(1),
  /** One or two plain sentences: what that means and what to try. */
  detail: z.string().min(1),
  /** Whole seconds the test took, so a slow answer is visibly slow. */
  durationSeconds: z.number().int().nonnegative(),
  checkedAt: z.string().min(1),
})

export const chooseAssistantInputSchema = z
  .object({
    assistant: assistantChoiceSchema,
  })
  .strict()

export const settingsIpcChannels = {
  getAssistant: 'settings:get-assistant',
  chooseAssistant: 'settings:choose-assistant',
  checkConnection: 'settings:check-connection',
  saveModelChannel: 'settings:save-model-channel',
  clearModelChannel: 'settings:clear-model-channel',
  testFeishuRead: 'settings:test-feishu-read',
} as const

/**
 * Preference keys the workbench knows about.
 *
 * Frozen on purpose: the store is a general key/value table so that adding a
 * preference needs no schema change, but adding a *key* is still a deliberate
 * edit here rather than something any caller can invent.
 */
export const preferenceKeys = [
  'default_assistant',
  /**
   * The built-in assistant's model connection.
   *
   * The endpoint and the model id are ordinary settings. The key is not: it is
   * stored under `model_channel_api_key` **encrypted by the operating system's
   * own secret store**, never as the value a consultant typed. A build that
   * cannot reach that store refuses to save a key at all rather than writing
   * one here in the clear — see `model-channel-store.ts`.
   */
  'model_channel_base_url',
  'model_channel_model',
  'model_channel_api_key',
] as const

export const preferenceKeySchema = z.enum(preferenceKeys)

export type AssistantChoice = z.infer<typeof assistantChoiceSchema>
export type AssistantOptionView = z.infer<typeof assistantOptionViewSchema>
export type AssistantSettingsView = z.infer<typeof assistantSettingsViewSchema>
export type LocalToolStatusView = z.infer<typeof localToolStatusViewSchema>
export type FeishuBindingState = z.infer<typeof feishuBindingStateSchema>
export type FeishuBindingView = z.infer<typeof feishuBindingViewSchema>
export type FeishuReadFailureReason = z.infer<typeof feishuReadFailureReasonSchema>
export type FeishuReadTestInput = z.infer<typeof feishuReadTestInputSchema>
export type FeishuReadTestView = z.infer<typeof feishuReadTestViewSchema>
export type RuntimeVersionKey = z.infer<typeof runtimeVersionKeySchema>
export type RuntimeVersionStanding = z.infer<typeof runtimeVersionStandingSchema>
export type RuntimeVersionView = z.infer<typeof runtimeVersionViewSchema>
export type AssistantConnectionCheckState = z.infer<typeof assistantConnectionCheckStateSchema>
export type AssistantConnectionCheckView = z.infer<typeof assistantConnectionCheckViewSchema>
export type ChooseAssistantInput = z.infer<typeof chooseAssistantInputSchema>
export type ModelChannelView = z.infer<typeof modelChannelViewSchema>
export type SaveModelChannelInput = z.infer<typeof saveModelChannelInputSchema>
export type ModelChannelSaveResult = z.infer<typeof modelChannelSaveResultSchema>
export type PreferenceKey = z.infer<typeof preferenceKeySchema>
