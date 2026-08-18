import type { AssistantSettingsView } from '@school-workbench/shared'
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
    localToolStatuses: () => localTools,
  }
}

const localTools: AssistantSettingsView['localTools'] = [
  {
    key: 'codex_cli',
    label: 'Codex 命令行工具',
    availability: 'available',
    detail: '已检测到，可用于新的学校分析。',
  },
  {
    key: 'lark_cli',
    label: '飞书命令行工具',
    availability: 'unavailable',
    detail: '未检测到。启用飞书材料接入前需要先安装飞书命令行工具。',
  },
]
const ready: AssistantReadiness = { ready: true, detail: null }
const notReady: AssistantReadiness = {
  ready: false,
  detail: '这台电脑上还没有装好 Codex，装好后重新启动工作台即可。',
}

describe('choosing a default assistant', () => {
  it('defaults to the one assistant that exists, because analysis needs one', () => {
    expect(DEFAULT_ASSISTANT).toBe('codex')
  })

  it('offers exactly the assistants that exist, and no way to decline', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => ready })
    const view = await handlers.getAssistant()

    expect(view.selected).toBe('codex')
    // DeepSeek Harness is a later slice; nothing offers what does not exist.
    expect(view.options.map((option) => option.key)).toEqual(['codex'])
    expect(view.options.map((option) => option.label)).toEqual(['Codex'])
    expect(view.localTools).toEqual(localTools)
  })

  it('remembers the choice', async () => {
    const backing = store()
    const handlers = createSettingsIpcHandlers({ ...backing, readiness: () => ready })

    const saved = await handlers.chooseAssistant({ assistant: 'codex' })
    expect(saved.selected).toBe('codex')
    expect(backing.values.get(ASSISTANT_PREFERENCE_KEY)).toBe('codex')
    expect((await handlers.getAssistant()).selected).toBe('codex')
  })

  it('refuses a choice it does not know about', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => ready })
    await expect(handlers.chooseAssistant({ assistant: 'gpt' })).rejects.toThrow()
    await expect(handlers.chooseAssistant({})).rejects.toThrow()
    // The retired "no assistant" option is not a choice any more, either.
    await expect(handlers.chooseAssistant({ assistant: 'none' })).rejects.toThrow()
  })

  it('upgrades a stored choice that no longer exists instead of failing to start', async () => {
    for (const stored of ['none', 'something-else']) {
      const handlers = createSettingsIpcHandlers({
        ...store({ [ASSISTANT_PREFERENCE_KEY]: stored }),
        readiness: () => ready,
      })
      const view = await handlers.getAssistant()
      expect(view.selected).toBe(DEFAULT_ASSISTANT)
      expect(view.options).toHaveLength(1)
    }
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

  it('still reports the chosen assistant when it cannot start on this computer', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => notReady })
    const view = await handlers.getAssistant()
    expect(view.selected).toBe('codex')
    expect(view.options.every((option) => option.availability === 'unavailable')).toBe(true)
  })
})
