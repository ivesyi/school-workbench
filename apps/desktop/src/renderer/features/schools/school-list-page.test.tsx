// @vitest-environment jsdom

import type { WorkbenchApi } from '@school-workbench/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SchoolListPage } from './school-list-page'

describe('SchoolListPage', () => {
  it('creates a school with one field and navigates into its workspace', async () => {
    const school = {
      id: '01K00000000000000000000000',
      name: '南山实验学校',
      currentStageId: null,
      currentStageTitle: null,
      createdAt: '2026-08-17T00:00:00.000Z',
    }
    const api: WorkbenchApi = {
      schools: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(school),
        get: vi.fn(),
        archive: vi.fn(),
      },
      judgments: {
        review: vi.fn(),
        listAccepted: vi.fn().mockResolvedValue([]),
      },
      stages: {
        getWorkspace: vi.fn().mockResolvedValue({ state: 'none' }),
        adjust: vi.fn(),
        confirm: vi.fn(),
      },
      states: {
        getWorkspace: vi.fn().mockResolvedValue({ state: 'needs_stage' }),
        adjust: vi.fn(),
        confirm: vi.fn(),
      },
      methodology: {
        getReviewWorkbench: vi.fn(),
        signOff: vi.fn(),
      },
      settings: {
        getAssistant: vi.fn().mockResolvedValue({
          selected: 'codex',
          localTools: [],
          options: [{ key: 'codex', label: 'Codex', availability: 'ready', detail: null }],
        }),
        chooseAssistant: vi.fn(),
        checkConnection: vi.fn(),
      },
      agent: {
        run: vi.fn(),
        onProgress: vi.fn().mockReturnValue(() => undefined),
      },
    }

    render(
      <WorkbenchApiProvider api={api}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<SchoolListPage />} />
            <Route path="/schools/:schoolId" element={<div>学校工作台已打开</div>} />
          </Routes>
        </MemoryRouter>
      </WorkbenchApiProvider>,
    )

    expect(await screen.findByText('先新建一所学校')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '新建学校' }))
    const schoolNameInput = screen.getByLabelText('学校名称')
    expect(schoolNameInput).toHaveValue('')
    expect(schoolNameInput).not.toHaveAttribute('placeholder')
    await userEvent.type(schoolNameInput, '南山实验学校')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(api.schools.create).toHaveBeenCalledWith({ name: '南山实验学校' }))
    expect(await screen.findByText('学校工作台已打开')).toBeInTheDocument()
  })
})

describe('SchoolListPage archive action', () => {
  it('asks for confirmation, then archives the school and removes its card', async () => {
    const school = {
      id: '01K00000000000000000000000',
      name: '南山实验学校',
      currentStageId: null,
      currentStageTitle: null,
      createdAt: '2026-08-17T00:00:00.000Z',
    }
    const archive = vi.fn().mockResolvedValue(undefined)
    const api: WorkbenchApi = {
      schools: {
        list: vi.fn().mockResolvedValue([school]),
        create: vi.fn(),
        get: vi.fn(),
        archive,
      },
      judgments: { review: vi.fn(), listAccepted: vi.fn() },
      stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
      states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
      methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
      settings: {
        getAssistant: vi.fn(),
        chooseAssistant: vi.fn(),
        checkConnection: vi.fn(),
      },
      agent: { run: vi.fn(), onProgress: vi.fn().mockReturnValue(() => undefined) },
    }

    render(
      <WorkbenchApiProvider api={api}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<SchoolListPage />} />
          </Routes>
        </MemoryRouter>
      </WorkbenchApiProvider>,
    )

    await screen.findByRole('link', { name: /南山实验学校/ })
    await userEvent.click(screen.getByRole('button', { name: '归档南山实验学校' }))
    expect(screen.getByRole('heading', { name: '归档“南山实验学校”吗？' })).toBeInTheDocument()
    expect(screen.getByText(/材料、判断和状态都会保留/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(archive).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /南山实验学校/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '归档南山实验学校' }))
    await userEvent.click(screen.getByRole('button', { name: '确认归档' }))
    await waitFor(() => expect(archive).toHaveBeenCalledWith({ schoolId: school.id }))
    expect(await screen.findByText('先新建一所学校')).toBeInTheDocument()
  })
})

describe('SchoolListPage recovery guidance', () => {
  it('tells the consultant what to do next when local data cannot be read', async () => {
    const api: WorkbenchApi = {
      schools: {
        list: vi.fn().mockRejectedValue(new Error('database is closed')),
        create: vi.fn(),
        get: vi.fn(),
        archive: vi.fn(),
      },
      judgments: { review: vi.fn(), listAccepted: vi.fn() },
      stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
      states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
      methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
      settings: { getAssistant: vi.fn(), chooseAssistant: vi.fn(), checkConnection: vi.fn() },
      agent: { run: vi.fn(), onProgress: vi.fn().mockReturnValue(() => undefined) },
    }

    render(
      <WorkbenchApiProvider api={api}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<SchoolListPage />} />
          </Routes>
        </MemoryRouter>
      </WorkbenchApiProvider>,
    )

    expect(await screen.findByText('请重新打开应用后继续')).toBeInTheDocument()
    expect(screen.getByText(/从右上角“新建学校”开始/)).toBeInTheDocument()
    expect(screen.queryByText('本地数据暂时不可用')).not.toBeInTheDocument()
  })
})
