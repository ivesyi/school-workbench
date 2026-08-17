import {
  assistantSettingsViewSchema,
  chooseAssistantInputSchema,
  settingsIpcChannels,
  type AssistantChoice,
  type AssistantSettingsView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

/**
 * The assistant the workbench uses when nobody has said otherwise.
 *
 * Off until chosen. PRD 15 puts this choice in settings, and it is a real
 * choice rather than a technical detail the product could make on the
 * consultant's behalf: an assistant takes a minute of waiting and costs money
 * per question. Shipping it switched on would mean the very first sentence
 * someone types silently does both. Once chosen, PRD 14 holds and nothing asks
 * again.
 */
export const DEFAULT_ASSISTANT: AssistantChoice = 'none'

export const ASSISTANT_PREFERENCE_KEY = 'default_assistant'

export type AssistantReadiness = Readonly<{
  ready: boolean
  /** One plain sentence, shown only when the assistant cannot be used. */
  detail: string | null
}>

export type SettingsIpcHandlers = {
  getAssistant(): Promise<AssistantSettingsView>
  chooseAssistant(input: unknown): Promise<AssistantSettingsView>
}

export type SettingsDependencies = Readonly<{
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  readiness(): AssistantReadiness
}>

function toView(selected: AssistantChoice, readiness: AssistantReadiness): AssistantSettingsView {
  return assistantSettingsViewSchema.parse({
    selected,
    options: [
      {
        key: 'codex',
        label: 'Codex',
        availability: readiness.ready ? 'ready' : 'unavailable',
        detail: readiness.ready ? null : readiness.detail,
      },
      {
        key: 'none',
        label: '暂不使用 AI 助手',
        availability: 'ready',
        detail: null,
      },
    ],
  })
}

async function currentChoice(dependencies: SettingsDependencies): Promise<AssistantChoice> {
  const stored = await dependencies.read(ASSISTANT_PREFERENCE_KEY)
  // An unreadable or unknown stored value falls back to the default rather than
  // leaving the workbench without an answer.
  return stored === 'codex' || stored === 'none' ? stored : DEFAULT_ASSISTANT
}

export function createSettingsIpcHandlers(dependencies: SettingsDependencies): SettingsIpcHandlers {
  return {
    async getAssistant() {
      return toView(await currentChoice(dependencies), dependencies.readiness())
    },
    async chooseAssistant(input) {
      const parsed = chooseAssistantInputSchema.parse(input)
      await dependencies.write(ASSISTANT_PREFERENCE_KEY, parsed.assistant)
      return toView(parsed.assistant, dependencies.readiness())
    },
  }
}

export function registerSettingsIpc(ipcMain: IpcMain, handlers: SettingsIpcHandlers): void {
  ipcMain.handle(settingsIpcChannels.getAssistant, () => handlers.getAssistant())
  ipcMain.handle(settingsIpcChannels.chooseAssistant, (_event, input: unknown) =>
    handlers.chooseAssistant(input),
  )
}
