// @vitest-environment jsdom

import type { AssistantSettingsView, WorkbenchApi } from '@school-workbench/shared'
import { cleanup, render, screen } from '@testing-library/react'
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
    options: [{ key: 'codex', label: 'Codex', availability, detail }],
  }
}

function api(settings: Partial<WorkbenchApi['settings']> = {}): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn() },
    judgments: { review: vi.fn(), listAccepted: vi.fn() },
    stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue(view()),
      chooseAssistant: vi.fn().mockResolvedValue(view()),
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
