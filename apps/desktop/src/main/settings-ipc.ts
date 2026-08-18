import {
  assistantConnectionCheckViewSchema,
  assistantSettingsViewSchema,
  chooseAssistantInputSchema,
  settingsIpcChannels,
  type AssistantChoice,
  type AssistantConnectionCheckView,
  type AssistantSettingsView,
  type LocalToolStatusView,
  type RuntimeVersionView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'

/**
 * The assistant the workbench uses when nobody has said otherwise.
 *
 * Codex, because an assistant is not optional: professional reasoning is its
 * job and the workbench has no path of its own that could stand in. PRD 15 puts
 * the choice in settings for the day there is more than one runtime; with one,
 * the honest default is that one, and PRD 14 then holds so nothing asks again.
 *
 * A previously stored `none` — from the build where declining was offered —
 * lands here too rather than leaving the workbench without an assistant.
 */
export const DEFAULT_ASSISTANT: AssistantChoice = 'codex'

export const ASSISTANT_PREFERENCE_KEY = 'default_assistant'

export type AssistantReadiness = Readonly<{
  ready: boolean
  /** One plain sentence, shown only when the assistant cannot be used. */
  detail: string | null
}>

export type SettingsIpcHandlers = {
  getAssistant(): Promise<AssistantSettingsView>
  chooseAssistant(input: unknown): Promise<AssistantSettingsView>
  /**
   * Really runs one throwaway turn against the chosen assistant.
   *
   * Deliberately only ever reached from a button. It costs a real turn, so
   * nothing starts it on launch, and its answer is shown rather than acted on.
   */
  checkConnection(): Promise<AssistantConnectionCheckView>
}

export type SettingsDependencies = Readonly<{
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  readiness(): AssistantReadiness
  localToolStatuses(): readonly LocalToolStatusView[]
  /** Installed versions next to the ones this product was verified against. */
  runtimeVersions(): Promise<readonly RuntimeVersionView[]>
  checkConnection(): Promise<AssistantConnectionCheckView>
}>

function toView(
  selected: AssistantChoice,
  readiness: AssistantReadiness,
  localTools: readonly LocalToolStatusView[],
  versions: readonly RuntimeVersionView[],
): AssistantSettingsView {
  return assistantSettingsViewSchema.parse({
    selected,
    localTools: [...localTools],
    runtimeVersions: [...versions],
    options: [
      {
        key: 'codex',
        label: 'Codex',
        availability: readiness.ready ? 'ready' : 'unavailable',
        detail: readiness.ready ? null : readiness.detail,
      },
    ],
  })
}

async function currentChoice(dependencies: SettingsDependencies): Promise<AssistantChoice> {
  const stored = await dependencies.read(ASSISTANT_PREFERENCE_KEY)
  // An unreadable, unknown, or retired stored value — `none` from the build
  // that offered declining — falls back to the default rather than leaving the
  // workbench without an assistant it can name.
  return stored === 'codex' ? stored : DEFAULT_ASSISTANT
}

export function createSettingsIpcHandlers(dependencies: SettingsDependencies): SettingsIpcHandlers {
  return {
    async getAssistant() {
      return toView(
        await currentChoice(dependencies),
        dependencies.readiness(),
        dependencies.localToolStatuses(),
        await dependencies.runtimeVersions(),
      )
    },
    async chooseAssistant(input) {
      const parsed = chooseAssistantInputSchema.parse(input)
      await dependencies.write(ASSISTANT_PREFERENCE_KEY, parsed.assistant)
      return toView(
        parsed.assistant,
        dependencies.readiness(),
        dependencies.localToolStatuses(),
        await dependencies.runtimeVersions(),
      )
    },
    async checkConnection() {
      return assistantConnectionCheckViewSchema.parse(await dependencies.checkConnection())
    },
  }
}

export function registerSettingsIpc(ipcMain: IpcMain, handlers: SettingsIpcHandlers): void {
  ipcMain.handle(settingsIpcChannels.getAssistant, () => handlers.getAssistant())
  ipcMain.handle(settingsIpcChannels.chooseAssistant, (_event, input: unknown) =>
    handlers.chooseAssistant(input),
  )
  ipcMain.handle(settingsIpcChannels.checkConnection, () => handlers.checkConnection())
}
