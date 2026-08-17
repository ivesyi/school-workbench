// @vitest-environment jsdom

import type { AssistantSettingsView, WorkbenchApi } from '@school-workbench/shared'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SettingsPage } from './settings-page'

function view(
  selected: AssistantSettingsView['selected'],
  availability: 'ready' | 'unavailable' = 'ready',
  detail: string | null = null,
): AssistantSettingsView {
  return {
    selected,
    options: [
      { key: 'codex', label: 'Codex', availability, detail },
      { key: 'none', label: '暂不使用 AI 助手', availability: 'ready', detail: null },
    ],
  }
}

function api(settings: Partial<WorkbenchApi['settings']> = {}): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn() },
    judgments: { submitSituation: vi.fn(), review: vi.fn(), listAccepted: vi.fn() },
    stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue(view('none')),
      chooseAssistant: vi.fn().mockResolvedValue(view('codex')),
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
  it('shows the choice and remembers it (PRD 15)', async () => {
    const workbench = api()
    renderPage(workbench)

    const codex = await screen.findByRole('radio', { name: /Codex/ })
    expect(codex).not.toBeChecked()
    expect(screen.getByText('目前没有使用 AI 助手')).toBeInTheDocument()

    await userEvent.setup().click(codex)

    expect(workbench.settings.chooseAssistant).toHaveBeenCalledWith({ assistant: 'codex' })
    expect(await screen.findByRole('radio', { name: /Codex/ })).toBeChecked()
    expect(screen.queryByText('目前没有使用 AI 助手')).not.toBeInTheDocument()
  })

  it('says in plain words when the assistant cannot be used here', async () => {
    renderPage(
      api({
        getAssistant: vi
          .fn()
          .mockResolvedValue(
            view('none', 'unavailable', '这台电脑上还没有装好 Codex，装好后重新启动工作台即可。'),
          ),
      }),
    )

    await screen.findByText(/这台电脑上还没有装好 Codex/)
    // Still selectable, and opting out is always available.
    expect(screen.getByRole('radio', { name: /暂不使用 AI 助手/ })).toBeInTheDocument()
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
