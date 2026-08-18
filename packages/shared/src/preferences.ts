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

export const assistantSettingsViewSchema = z.object({
  selected: assistantChoiceSchema,
  options: z.array(assistantOptionViewSchema).min(1),
  localTools: z.array(localToolStatusViewSchema).length(2),
})

export const chooseAssistantInputSchema = z
  .object({
    assistant: assistantChoiceSchema,
  })
  .strict()

export const settingsIpcChannels = {
  getAssistant: 'settings:get-assistant',
  chooseAssistant: 'settings:choose-assistant',
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
export type ChooseAssistantInput = z.infer<typeof chooseAssistantInputSchema>
export type PreferenceKey = z.infer<typeof preferenceKeySchema>
