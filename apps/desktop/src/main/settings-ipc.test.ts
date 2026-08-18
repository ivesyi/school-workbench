import type { AssistantConnectionCheckView, AssistantSettingsView } from '@school-workbench/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_PREFERENCE_KEY,
  createSettingsIpcHandlers,
  DEFAULT_ASSISTANT,
  type AssistantReadiness,
} from './settings-ipc'

const connectionCheckOk: AssistantConnectionCheckView = {
  state: 'ok',
  headline: '连接正常',
  detail: 'AI 助手在这台电脑上能正常回应，可以开始新的分析。',
  durationSeconds: 4,
  checkedAt: '2026-08-18T00:00:00.000Z',
}

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => {
      values.set(key, value)
    },
    localToolStatuses: () => localTools,
    runtimeVersions: async () => versions,
    checkConnection: vi.fn(async () => connectionCheckOk),
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
const versions: AssistantSettingsView['runtimeVersions'] = [
  { key: 'codex_cli', label: 'Codex', version: '0.147.0', standing: 'verified', note: null },
  {
    key: 'codex_acp',
    label: '工作台与 Codex 之间的连接组件',
    version: '1.4.0',
    standing: 'verified',
    note: null,
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

describe('version information (reported, never enforced)', () => {
  it('reports what is installed alongside the assistant choice', async () => {
    const handlers = createSettingsIpcHandlers({ ...store(), readiness: () => ready })
    const view = await handlers.getAssistant()
    expect(view.runtimeVersions.map((item) => item.key)).toEqual(['codex_cli', 'codex_acp'])
    expect(view.runtimeVersions.every((item) => item.note === null)).toBe(true)
  })

  it('never lets an unverified version take the assistant away', async () => {
    const unverified: AssistantSettingsView['runtimeVersions'] = versions.map((item) => ({
      ...item,
      version: '99.0.0',
      standing: 'unverified' as const,
      note: '此版本未经产品验证。',
    }))
    const handlers = createSettingsIpcHandlers({
      ...store(),
      runtimeVersions: async () => unverified,
      readiness: () => ready,
    })
    const view = await handlers.getAssistant()

    // Said once, and then it changes nothing: the assistant is still selected
    // and still ready. SPEC 62 keeps the verdict on what the runtime answers.
    expect(view.runtimeVersions.every((item) => item.note === '此版本未经产品验证。')).toBe(true)
    expect(view.selected).toBe('codex')
    expect(view.options[0]?.availability).toBe('ready')
  })
})

describe('the connection test', () => {
  it('only runs when it is asked to, and hands back what happened', async () => {
    const backing = store()
    const handlers = createSettingsIpcHandlers({ ...backing, readiness: () => ready })

    // Reading settings and choosing an assistant must never cost a real turn.
    await handlers.getAssistant()
    await handlers.chooseAssistant({ assistant: 'codex' })
    expect(backing.checkConnection).not.toHaveBeenCalled()

    expect(await handlers.checkConnection()).toEqual(connectionCheckOk)
    expect(backing.checkConnection).toHaveBeenCalledTimes(1)
  })

  it('refuses to pass on a result the consultant could not read', async () => {
    const handlers = createSettingsIpcHandlers({
      ...store(),
      readiness: () => ready,
      checkConnection: async () => ({ state: 'nope' }) as unknown as AssistantConnectionCheckView,
    })
    await expect(handlers.checkConnection()).rejects.toThrow()
  })
})
