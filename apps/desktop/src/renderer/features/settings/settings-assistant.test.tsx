// @vitest-environment jsdom

import type {
  AssistantConnectionCheckView,
  AssistantSettingsView,
  WorkbenchApi,
} from '@school-workbench/shared'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SettingsPage } from './settings-page'

function view(
  availability: 'ready' | 'unavailable' = 'ready',
  detail: string | null = null,
): AssistantSettingsView {
  return {
    selected: 'codex',
    localTools: [
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
    ],
    runtimeVersions: [
      {
        key: 'codex_cli',
        label: 'Codex',
        version: '0.147.0',
        standing: 'verified',
        note: null,
      },
      {
        key: 'codex_acp',
        label: '工作台与 Codex 之间的连接组件',
        version: '9.9.9',
        standing: 'unverified',
        note: '此版本未经产品验证。',
      },
    ],
    options: [{ key: 'codex', label: 'Codex', availability, detail }],
  }
}

const passedCheck: AssistantConnectionCheckView = {
  state: 'ok',
  headline: '连接正常',
  detail: 'AI 助手在这台电脑上能正常回应，可以开始新的分析。',
  durationSeconds: 6,
  checkedAt: '2026-08-18T00:00:00.000Z',
}

const failedCheck: AssistantConnectionCheckView = {
  state: 'failed',
  headline: '这次没有连上',
  detail:
    'AI 助手启动了，但它背后的模型服务没有回应。这是 AI 助手环境的问题，不是你的操作或学校资料的问题。常见原因是还没登录，或者模型服务这会儿用不了。',
  durationSeconds: 61,
  checkedAt: '2026-08-18T00:00:00.000Z',
}

function api(settings: Partial<WorkbenchApi['settings']> = {}): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn(), archive: vi.fn() },
    judgments: { review: vi.fn(), listAccepted: vi.fn() },
    stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue(view()),
      chooseAssistant: vi.fn().mockResolvedValue(view()),
      checkConnection: vi.fn().mockResolvedValue(passedCheck),
      ...settings,
    },
    agent: { run: vi.fn(), onProgress: vi.fn().mockReturnValue(() => undefined) },
  }
}

function renderPage(workbench: WorkbenchApi): void {
  render(
    <WorkbenchApiProvider api={workbench}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </WorkbenchApiProvider>,
  )
}

afterEach(cleanup)

describe('choosing a default AI assistant in settings', () => {
  it('shows the assistant in use, and offers no way to work without one (PRD 15)', async () => {
    renderPage(api())

    const radios = await screen.findAllByRole('radio')
    expect(radios).toHaveLength(1)
    expect(radios[0]).toBeChecked()
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeInTheDocument()
    expect(screen.queryByText(/暂不使用/)).not.toBeInTheDocument()
  })

  it('shows the local Codex and Feishu CLI status separately from assistant choice', async () => {
    renderPage(api())
    expect(await screen.findByText('本机工具状态')).toBeInTheDocument()
    expect(screen.getByText('Codex 命令行工具')).toBeInTheDocument()
    expect(screen.getByText('飞书命令行工具')).toBeInTheDocument()
    expect(screen.getByText('已检测到')).toBeInTheDocument()
    expect(screen.getByText('未检测到')).toBeInTheDocument()
    expect(screen.getByText(/不会读取你的登录信息或飞书内容/)).toBeInTheDocument()
  })

  it('says in plain words when the assistant cannot be used here', async () => {
    renderPage(
      api({
        getAssistant: vi
          .fn()
          .mockResolvedValue(
            view('unavailable', '这台电脑上还没有装好 Codex，装好后重新启动工作台即可。'),
          ),
      }),
    )

    await screen.findByText(/这台电脑上还没有装好 Codex/)
    // What still works is stated, so the workbench does not look broken.
    expect(screen.getByText(/都还能照常查看，只是不能开始新的分析/)).toBeInTheDocument()
  })

  it('never puts a technical name in front of the consultant', async () => {
    renderPage(api())
    await screen.findByRole('radio', { name: /Codex/ })

    const shown = document.body.textContent ?? ''
    for (const word of [
      'ACP',
      'MCP',
      'loopback',
      'stdio',
      'token',
      'Token',
      'scope',
      'schema',
      'runtime',
      'Runtime',
      'session',
      'SQLite',
    ]) {
      expect(shown, word).not.toContain(word)
    }
  })

  it('reminds the consultant that nothing becomes formal without them', async () => {
    renderPage(api())
    await screen.findByRole('radio', { name: /Codex/ })
    expect(screen.getByText(/都要你确认之后才会进入这所学校的正式记录/)).toBeInTheDocument()
  })
})

describe('the connection test in settings', () => {
  it('never runs on its own — a real turn costs something', async () => {
    const workbench = api()
    renderPage(workbench)
    await screen.findByRole('radio', { name: /Codex/ })
    expect(workbench.settings.checkConnection).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '运行连接测试' })).toBeInTheDocument()
  })

  it('says plainly when the assistant really does answer', async () => {
    const workbench = api()
    renderPage(workbench)
    await userEvent.setup().click(await screen.findByRole('button', { name: '运行连接测试' }))

    expect(await screen.findByText('连接正常')).toBeInTheDocument()
    expect(workbench.settings.checkConnection).toHaveBeenCalledTimes(1)
    // And it stays a report: the choice on the page is untouched.
    expect(workbench.settings.chooseAssistant).not.toHaveBeenCalled()
  })

  it('blames the assistant environment, never the consultant or the school material', async () => {
    const workbench = api({ checkConnection: vi.fn().mockResolvedValue(failedCheck) })
    renderPage(workbench)
    await userEvent.setup().click(await screen.findByRole('button', { name: '运行连接测试' }))

    await screen.findByText('这次没有连上')
    expect(
      screen.getByText(/这是 AI 助手环境的问题，不是你的操作或学校资料的问题/),
    ).toBeInTheDocument()
    // A failure is never allowed to move the consultant onto something else.
    expect(workbench.settings.chooseAssistant).not.toHaveBeenCalled()
  })

  it('says so without machinery when the test itself could not be run', async () => {
    const workbench = api({
      checkConnection: vi.fn().mockRejectedValue(new Error('ipc exploded at /Users/x/main.js')),
    })
    renderPage(workbench)
    await userEvent.setup().click(await screen.findByRole('button', { name: '运行连接测试' }))

    expect(await screen.findByText('这次没能完成连接测试，请稍后再试一次。')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('ipc exploded')
  })
})

describe('version information in settings', () => {
  it('shows what is installed and marks a version nobody has verified', async () => {
    renderPage(api())
    expect(await screen.findByText('版本信息')).toBeInTheDocument()
    expect(screen.getByText('0.147.0')).toBeInTheDocument()
    expect(screen.getByText('9.9.9')).toBeInTheDocument()
    expect(screen.getByText('此版本未经产品验证。')).toBeInTheDocument()
  })

  it('does not turn an unverified version into a block', async () => {
    renderPage(api())
    await screen.findByText('此版本未经产品验证。')
    // The assistant is still the chosen one and still usable; nothing on the
    // page tells the consultant to stop or to upgrade before continuing.
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked()
    expect(screen.queryByText(/都还能照常查看，只是不能开始新的分析/)).not.toBeInTheDocument()
    expect(screen.getByText(/版本不影响工作台怎么运行/)).toBeInTheDocument()
  })
})
