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
 * Only Codex is integrated today, so this reads as a list of one. It stays an
 * enum because PRD 15 is written for the day there is more than one.
 */
export const assistantChoiceSchema = z.enum(['codex'])

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

export const runtimeVersionKeySchema = z.enum(['codex_cli', 'codex_acp'])

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

export const assistantSettingsViewSchema = z.object({
  selected: assistantChoiceSchema,
  options: z.array(assistantOptionViewSchema).min(1),
  localTools: z.array(localToolStatusViewSchema).length(2),
  runtimeVersions: z.array(runtimeVersionViewSchema).length(2),
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
} as const

/**
 * Preference keys the workbench knows about.
 *
 * Frozen on purpose: the store is a general key/value table so that adding a
 * preference needs no schema change, but adding a *key* is still a deliberate
 * edit here rather than something any caller can invent.
 */
export const preferenceKeys = ['default_assistant'] as const

export const preferenceKeySchema = z.enum(preferenceKeys)

export type AssistantChoice = z.infer<typeof assistantChoiceSchema>
export type AssistantOptionView = z.infer<typeof assistantOptionViewSchema>
export type AssistantSettingsView = z.infer<typeof assistantSettingsViewSchema>
export type LocalToolStatusView = z.infer<typeof localToolStatusViewSchema>
export type RuntimeVersionKey = z.infer<typeof runtimeVersionKeySchema>
export type RuntimeVersionStanding = z.infer<typeof runtimeVersionStandingSchema>
export type RuntimeVersionView = z.infer<typeof runtimeVersionViewSchema>
export type AssistantConnectionCheckState = z.infer<typeof assistantConnectionCheckStateSchema>
export type AssistantConnectionCheckView = z.infer<typeof assistantConnectionCheckViewSchema>
export type ChooseAssistantInput = z.infer<typeof chooseAssistantInputSchema>
export type PreferenceKey = z.infer<typeof preferenceKeySchema>
