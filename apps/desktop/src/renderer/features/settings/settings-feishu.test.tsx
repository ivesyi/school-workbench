// @vitest-environment jsdom

import type {
  AssistantSettingsView,
  FeishuBindingView,
  FeishuReadTestView,
  WorkbenchApi,
} from '@school-workbench/shared'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SettingsPage } from './settings-page'

const baseFeishu: FeishuBindingView = {
  state: 'uninstalled',
  accountName: null,
  bindCommand: null,
  detail: '这台电脑上还没装好飞书。装好后再打开设置，就能继续绑定。',
}

function view(feishu: FeishuBindingView = baseFeishu): AssistantSettingsView {
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
        availability: feishu.state === 'uninstalled' ? 'unavailable' : 'available',
        detail:
          feishu.state === 'uninstalled'
            ? '未检测到。要让 AI 助手读飞书文档，需要先在这台电脑上装好飞书。'
            : '已检测到。绑定情况和读取测试见下方「飞书」。',
      },
    ],
    runtimeVersions: [
      { key: 'codex_cli', label: 'Codex', version: '0.147.0', standing: 'verified', note: null },
      {
        key: 'codex_acp',
        label: '工作台与 Codex 之间的连接组件',
        version: '9.9.9',
        standing: 'unverified',
        note: '此版本未经产品验证。',
      },
      {
        key: 'builtin_harness',
        label: '工作台自带助手的推理组件',
        version: '0.84.2',
        standing: 'unverified',
        note: '此版本未经产品验证。',
      },
    ],
    modelChannel: {
      baseUrl: null,
      model: null,
      hasApiKey: false,
      secretStorageAvailable: true,
      configured: false,
      detail: '还没填。',
    },
    feishu,
    options: [{ key: 'codex', label: 'Codex', availability: 'ready', detail: null }],
  }
}

function api(settings: Partial<WorkbenchApi['settings']> = {}): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn(), archive: vi.fn() },
    judgments: { review: vi.fn(), listPending: vi.fn(), listAccepted: vi.fn() },
    stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue(view()),
      chooseAssistant: vi.fn(),
      checkConnection: vi.fn(),
      saveModelChannel: vi.fn(),
      clearModelChannel: vi.fn(),
      testFeishuRead: vi.fn(),
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

describe('the Feishu block in settings', () => {
  it('says the tool is missing', async () => {
    renderPage(api())
    expect(await screen.findByText('飞书')).toBeInTheDocument()
    expect(screen.getByText('未安装')).toBeInTheDocument()
    expect(screen.getByText('还没装好飞书')).toBeInTheDocument()
    expect(screen.getByText(/装好后再打开设置/)).toBeInTheDocument()
    expect(screen.queryByText('lark-cli auth login --domain docs')).not.toBeInTheDocument()
  })

  it('shows the exact bind command when the account is not bound', async () => {
    renderPage(
      api({
        getAssistant: vi.fn().mockResolvedValue(
          view({
            state: 'unbound',
            accountName: null,
            bindCommand: 'lark-cli auth login --domain docs',
            detail: '飞书已经装好，但还没绑定账号。请在终端运行下面这行。',
          }),
        ),
      }),
    )

    expect(await screen.findByText('未绑定')).toBeInTheDocument()
    expect(screen.getByText('lark-cli auth login --domain docs')).toBeInTheDocument()
  })

  it('shows the account name when Feishu is bound', async () => {
    renderPage(
      api({
        getAssistant: vi.fn().mockResolvedValue(
          view({
            state: 'bound',
            accountName: '易虎',
            bindCommand: null,
            detail: '已绑定：易虎',
          }),
        ),
      }),
    )

    expect(await screen.findByText('已绑定')).toBeInTheDocument()
    expect(screen.getByText('已绑定：易虎')).toBeInTheDocument()
  })

  it('never runs a read test on its own', async () => {
    const workbench = api()
    renderPage(workbench)
    await screen.findByText('飞书')
    expect(workbench.settings.testFeishuRead).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '读取测试' })).toBeInTheDocument()
  })

  it('reads a pasted link and says the title', async () => {
    const passed: FeishuReadTestView = {
      state: 'ok',
      headline: '能读到：《课堂观察纪要》',
      detail: '这份文档现在可以读。',
      title: '课堂观察纪要',
      durationSeconds: 2,
      checkedAt: '2026-08-19T04:00:00.000Z',
      reason: null,
    }
    const workbench = api({ testFeishuRead: vi.fn().mockResolvedValue(passed) })
    renderPage(workbench)
    await userEvent.setup().click(await screen.findByRole('button', { name: '读取测试' }))
    await userEvent
      .setup()
      .type(screen.getByLabelText('飞书文档链接'), 'https://sample.feishu.cn/docx/Abc')
    await userEvent.setup().click(screen.getByRole('button', { name: '开始读取' }))

    expect(await screen.findByText('能读到：《课堂观察纪要》')).toBeInTheDocument()
    expect(workbench.settings.testFeishuRead).toHaveBeenCalledWith({
      url: 'https://sample.feishu.cn/docx/Abc',
    })
  })
})
