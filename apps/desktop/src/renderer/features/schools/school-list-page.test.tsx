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
      },
      judgments: {
        submitSituation: vi.fn(),
        review: vi.fn(),
        listAccepted: vi.fn().mockResolvedValue([]),
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

    expect(await screen.findByText('还没有学校')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '新建学校' }))
    await userEvent.type(screen.getByLabelText('学校名称'), '南山实验学校')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(api.schools.create).toHaveBeenCalledWith({ name: '南山实验学校' }))
    expect(await screen.findByText('学校工作台已打开')).toBeInTheDocument()
  })
})
