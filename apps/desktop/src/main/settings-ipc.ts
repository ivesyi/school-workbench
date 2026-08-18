import {
  assistantConnectionCheckViewSchema,
  assistantSettingsViewSchema,
  chooseAssistantInputSchema,
  feishuBindingViewSchema,
  feishuReadTestInputSchema,
  feishuReadTestViewSchema,
  modelChannelSaveResultSchema,
  saveModelChannelInputSchema,
  settingsIpcChannels,
  type AssistantChoice,
  type AssistantConnectionCheckView,
  type AssistantSettingsView,
  type FeishuBindingView,
  type FeishuReadTestView,
  type LocalToolStatusView,
  type ModelChannelSaveResult,
  type RuntimeVersionView,
} from '@school-workbench/shared'
import type { IpcMain } from 'electron'
import type { ModelChannelStore } from './model-channel-store'

/**
 * The assistant the workbench uses when nobody has said otherwise.
 *
 * Codex, because it is the one that has actually been driven end to end against
 * a real model (ledger §11). An assistant is not optional — professional
 * reasoning is its job and the workbench has no path of its own that could
 * stand in — so the default has to be the one with a verified run behind it,
 * not the newer one. PRD 14 then holds so nothing asks again.
 *
 * A previously stored `none` — from the build where declining was offered —
 * lands here too rather than leaving the workbench without an assistant.
 */
export const DEFAULT_ASSISTANT: AssistantChoice = 'codex'

export const ASSISTANT_PREFERENCE_KEY = 'default_assistant'

/**
 * What a consultant sees in the assistant list.
 *
 * Neither label names a protocol, a package or a company's harness. "Codex" is
 * there because it is a thing the consultant installed and can go and look at;
 * the other is described by where it runs, which is the only part of it they
 * have any reason to care about.
 */
export const ASSISTANT_LABELS: Readonly<Record<AssistantChoice, string>> = Object.freeze({
  codex: 'Codex',
  builtin: '工作台自带助手',
})

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
  saveModelChannel(input: unknown): Promise<ModelChannelSaveResult>
  clearModelChannel(): Promise<AssistantSettingsView>
  testFeishuRead(input: unknown): Promise<FeishuReadTestView>
}

export type SettingsDependencies = Readonly<{
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  /** Whether one named assistant could be started on this computer. */
  readiness(assistant: AssistantChoice): AssistantReadiness
  localToolStatuses(): readonly LocalToolStatusView[]
  /** Installed versions next to the ones this product was verified against. */
  runtimeVersions(): Promise<readonly RuntimeVersionView[]>
  checkConnection(assistant: AssistantChoice): Promise<AssistantConnectionCheckView>
  feishuBinding(): Promise<FeishuBindingView>
  testFeishuRead(url: string): Promise<FeishuReadTestView>
  modelChannel: ModelChannelStore
}>

const assistantOrder: readonly AssistantChoice[] = Object.freeze(['codex', 'builtin'])

async function toView(
  selected: AssistantChoice,
  dependencies: SettingsDependencies,
): Promise<AssistantSettingsView> {
  const [versions, modelChannel, feishu] = await Promise.all([
    dependencies.runtimeVersions(),
    dependencies.modelChannel.readView(),
    dependencies.feishuBinding(),
  ])
  return assistantSettingsViewSchema.parse({
    selected,
    localTools: [...dependencies.localToolStatuses()],
    runtimeVersions: [...versions],
    modelChannel,
    feishu: feishuBindingViewSchema.parse(feishu),
    // Every assistant is listed, ready or not. An assistant that cannot run
    // today still says *why* — hiding it would leave a consultant with no way
    // to find out what to do about it, and no way to pick it once fixed.
    options: assistantOrder.map((key) => {
      const readiness = dependencies.readiness(key)
      return {
        key,
        label: ASSISTANT_LABELS[key],
        availability: readiness.ready ? 'ready' : 'unavailable',
        detail: readiness.ready ? null : readiness.detail,
      }
    }),
  })
}

function isAssistantChoice(value: string | null): value is AssistantChoice {
  return value === 'codex' || value === 'builtin'
}

async function currentChoice(dependencies: SettingsDependencies): Promise<AssistantChoice> {
  const stored = await dependencies.read(ASSISTANT_PREFERENCE_KEY)
  // An unreadable, unknown, or retired stored value — `none` from the build
  // that offered declining — falls back to the default rather than leaving the
  // workbench without an assistant it can name.
  return isAssistantChoice(stored) ? stored : DEFAULT_ASSISTANT
}

export function createSettingsIpcHandlers(dependencies: SettingsDependencies): SettingsIpcHandlers {
  return {
    async getAssistant() {
      return toView(await currentChoice(dependencies), dependencies)
    },
    async chooseAssistant(input) {
      const parsed = chooseAssistantInputSchema.parse(input)
      // Deliberately stored whether or not that assistant is ready right now:
      // the choice is the consultant's, and an assistant they are in the middle
      // of configuring must not be silently refused.
      await dependencies.write(ASSISTANT_PREFERENCE_KEY, parsed.assistant)
      return toView(parsed.assistant, dependencies)
    },
    async checkConnection() {
      return assistantConnectionCheckViewSchema.parse(
        await dependencies.checkConnection(await currentChoice(dependencies)),
      )
    },
    async saveModelChannel(input) {
      const parsed = saveModelChannelInputSchema.parse(input)
      const saved = await dependencies.modelChannel.save(parsed)
      return modelChannelSaveResultSchema.parse({
        saved: saved.saved,
        problem: saved.problem,
        channel: await dependencies.modelChannel.readView(),
      })
    },
    async clearModelChannel() {
      await dependencies.modelChannel.clear()
      return toView(await currentChoice(dependencies), dependencies)
    },
    async testFeishuRead(input) {
      const parsed = feishuReadTestInputSchema.parse(input)
      return feishuReadTestViewSchema.parse(await dependencies.testFeishuRead(parsed.url))
    },
  }
}

export function registerSettingsIpc(ipcMain: IpcMain, handlers: SettingsIpcHandlers): void {
  ipcMain.handle(settingsIpcChannels.getAssistant, () => handlers.getAssistant())
  ipcMain.handle(settingsIpcChannels.chooseAssistant, (_event, input: unknown) =>
    handlers.chooseAssistant(input),
  )
  ipcMain.handle(settingsIpcChannels.checkConnection, () => handlers.checkConnection())
  ipcMain.handle(settingsIpcChannels.saveModelChannel, (_event, input: unknown) =>
    handlers.saveModelChannel(input),
  )
  ipcMain.handle(settingsIpcChannels.clearModelChannel, () => handlers.clearModelChannel())
  ipcMain.handle(settingsIpcChannels.testFeishuRead, (_event, input: unknown) =>
    handlers.testFeishuRead(input),
  )
}
