import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_PREFERENCE_KEY,
  createSettingsIpcHandlers,
  DEFAULT_ASSISTANT,
  type AssistantReadiness,
} from './settings-ipc'

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

const ready: AssistantReadiness = { ready: true, detail: null }
const notReady: AssistantReadiness = {
  ready: false,
  detail: '这台电脑上还没有装好 Codex，装好后重新启动工作台即可。',
}

describe('choosing a default assistant', () => {
  it('starts switched off so a first launch never waits or spends', () => {
    expect(DEFAULT_ASSISTANT).toBe('none')
  })

  it('offers exactly the assistants that exist, plus opting out', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => ready })
    const view = await handlers.getAssistant()

    expect(view.selected).toBe('none')
    expect(view.options.map((option) => option.key)).toEqual(['codex', 'none'])
    // DeepSeek Harness is a later slice; nothing offers what does not exist.
    expect(view.options.map((option) => option.label)).toEqual(['Codex', '暂不使用 AI 助手'])
  })

  it('remembers the choice', async () => {
    const backing = store()
    const handlers = createSettingsIpcHandlers({ ...backing, readiness: () => ready })

    const saved = await handlers.chooseAssistant({ assistant: 'codex' })
    expect(saved.selected).toBe('codex')
    expect(backing.values.get(ASSISTANT_PREFERENCE_KEY)).toBe('codex')
    expect((await handlers.getAssistant()).selected).toBe('codex')

    await handlers.chooseAssistant({ assistant: 'none' })
    expect((await handlers.getAssistant()).selected).toBe('none')
  })

  it('refuses a choice it does not know about', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => ready })
    await expect(handlers.chooseAssistant({ assistant: 'gpt' })).rejects.toThrow()
    await expect(handlers.chooseAssistant({})).rejects.toThrow()
  })

  it('falls back to the default when the stored value makes no sense', async () => {
    const handlers = createSettingsIpcHandlers({
      ...store({ [ASSISTANT_PREFERENCE_KEY]: 'something-else' }),
      readiness: () => ready,
    })
    expect((await handlers.getAssistant()).selected).toBe(DEFAULT_ASSISTANT)
  })

  it('says in plain words when an assistant cannot be used', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => notReady })
    const view = await handlers.getAssistant()
    const codex = view.options.find((option) => option.key === 'codex')

    expect(codex?.availability).toBe('unavailable')
    expect(codex?.detail).toBe(notReady.detail)
    for (const word of ['ACP', 'MCP', 'stdio', 'token', 'scope', 'node_modules']) {
      expect(codex?.detail ?? '', word).not.toContain(word)
    }
  })

  it('still lets the consultant opt out when nothing is available', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => notReady })
    const view = await handlers.getAssistant()
    expect(view.options.find((option) => option.key === 'none')?.availability).toBe('ready')
  })
})
