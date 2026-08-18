// @vitest-environment jsdom

import type { StateWorkspaceView, WorkbenchApi } from '@school-workbench/shared'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SchoolStatePage } from './school-state-page'

const school = {
  id: 'school-1',
  name: '南山实验学校',
  currentStageId: 'stage-1',
  currentStageTitle: '建立共同推动改进的组织基础',
  createdAt: '2026-08-17T00:00:00.000Z',
}

const draft: StateWorkspaceView = {
  state: 'draft',
  overview: {
    stage: {
      id: 'stage-1',
      title: '建立共同推动改进的组织基础',
      focus: '当前最需要看到组织基础逐步稳定。',
    },
    summary: '目前有四个方面可以形成初步判断，1 个方面还需要更多观察。',
    limitations: ['还有 1 个方面依据不足，先不判断达到程度。'],
    dimensions: [
      {
        dimensionKey: 'leadership',
        label: '领导力',
        target: '校长从代办转向授权，中层承担真实责任。',
        status: 'far_below',
        statusLabel: '明显低于阶段目标',
        summary: '领导责任仍然过度集中。',
        basis: ['中层仍然依赖校长完成关键任务拆解。'],
      },
      {
        dimensionKey: 'key_tasks',
        label: '关键任务',
        target: '关键任务由中层独立拆解、推进和调整。',
        status: 'partial',
        statusLabel: '部分达到阶段目标',
        summary: '关键任务已有一些进展。',
        basis: ['中层仍然依赖校长完成关键任务拆解。'],
      },
      {
        dimensionKey: 'structure',
        label: '结构与机制',
        target: '形成稳定的分工、推进和复盘机制。',
        status: 'mostly',
        statusLabel: '基本达到阶段目标',
        summary: '教研复盘开始形成节奏。',
        basis: ['教师已经开始稳定教研复盘。'],
      },
      {
        dimensionKey: 'culture',
        label: '文化',
        target: '团队能够公开讨论问题并对结果负责。',
        status: 'unverified',
        statusLabel: '还需要更多观察',
        summary: '目前还没有足够的正式判断。',
        basis: [],
      },
      {
        dimensionKey: 'capability',
        label: '能力',
        target: '中层能够独立分析、协同推进并复盘。',
        status: 'partial',
        statusLabel: '部分达到阶段目标',
        summary: '独立推进能力开始出现。',
        basis: ['教师已经开始稳定教研复盘。'],
      },
    ],
  },
}

const updateDraft: StateWorkspaceView = {
  state: 'update_draft',
  overview: {
    ...draft.overview,
    summary: '目前五个方面都已经有新的正式判断可以参考。',
    dimensions: draft.overview.dimensions.map((item) =>
      item.dimensionKey === 'leadership'
        ? {
            ...item,
            status: 'partial' as const,
            statusLabel: '部分达到阶段目标',
            summary: '中层开始独立拆解任务，校长也开始授权。',
            basis: [
              '中层仍然依赖校长完成关键任务拆解。',
              '中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。',
            ],
          }
        : item,
    ),
  },
  change: {
    newJudgmentCount: 1,
    summary: '和上一次相比，有 1 个方面出现明确变化，其余方面目前基本不变。',
    dimensions: draft.overview.dimensions.map((item) => ({
      dimensionKey: item.dimensionKey,
      label: item.label,
      kind: item.dimensionKey === 'leadership' ? ('improved' as const) : ('unchanged' as const),
      kindLabel: item.dimensionKey === 'leadership' ? '改善' : '基本不变',
      symbol: item.dimensionKey === 'leadership' ? ('↑' as const) : ('→' as const),
      previousStatus: item.status,
      currentStatus: item.dimensionKey === 'leadership' ? ('partial' as const) : item.status,
      previousStatusLabel: item.statusLabel,
      currentStatusLabel:
        item.dimensionKey === 'leadership' ? '部分达到阶段目标' : item.statusLabel,
      previousSummary: item.summary,
      currentSummary:
        item.dimensionKey === 'leadership'
          ? '中层开始独立拆解任务，校长也开始授权。'
          : item.summary,
      basis:
        item.dimensionKey === 'leadership'
          ? ['中层已经能够独立完成关键任务拆解，校长开始授权中层承担真实责任。']
          : item.basis,
      summaryChanged: item.dimensionKey === 'leadership',
    })),
  },
}

function baseApi(stateView: StateWorkspaceView = draft): WorkbenchApi {
  return {
    schools: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(school),
      archive: vi.fn(),
    },
    judgments: {
      review: vi.fn(),
      listAccepted: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]),
    },
    stages: {
      getWorkspace: vi.fn(),
      adjust: vi.fn(),
      confirm: vi.fn(),
    },
    states: {
      getWorkspace: vi.fn().mockResolvedValue(stateView),
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
      saveModelChannel: vi.fn(),
      clearModelChannel: vi.fn(),
    },
    agent: {
      run: vi.fn(),
      onProgress: vi.fn().mockReturnValue(() => undefined),
    },
  }
}

function renderPage(api: WorkbenchApi): void {
  render(
    <WorkbenchApiProvider api={api}>
      <MemoryRouter initialEntries={['/schools/school-1/state']}>
        <Routes>
          <Route path="/schools/:schoolId/state" element={<SchoolStatePage />} />
          <Route path="/schools/:schoolId" element={<div>工作台页面</div>} />
        </Routes>
      </MemoryRouter>
    </WorkbenchApiProvider>,
  )
}

afterEach(cleanup)

describe('SchoolStatePage', () => {
  it('shows five human-readable dimensions, adjusts transiently, then confirms the baseline', async () => {
    const adjusted: StateWorkspaceView = {
      ...draft,
      overview: {
        ...draft.overview,
        summary: '结合你的补充，我重新整理了当前状态。',
        dimensions: draft.overview.dimensions.map((item) =>
          item.dimensionKey === 'leadership'
            ? {
                ...item,
                status: 'unverified' as const,
                statusLabel: '还需要更多观察',
                summary: '根据你的调整，这里先不判断达到程度。',
              }
            : item,
        ),
      },
    }
    const baseline: StateWorkspaceView = { ...adjusted, state: 'baseline' }
    const api = baseApi()
    vi.mocked(api.states.adjust).mockResolvedValue(adjusted)
    vi.mocked(api.states.confirm).mockResolvedValue(baseline)

    renderPage(api)

    expect(await screen.findByText('南山实验学校')).toBeInTheDocument()
    expect(screen.getAllByText(/阶段目标|还需要更多观察/).length).toBeGreaterThan(0)
    expect(screen.getByText('文化')).toBeInTheDocument()
    expect(
      screen.getByText('这还只是待你确认的整理。你确认之前，不会成为这所学校的正式状态记录。'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '我想调整' }))
    await userEvent.type(
      screen.getByLabelText('哪里需要调整？'),
      '领导力这部分先别判断，还需要更多观察',
    )
    await userEvent.click(screen.getByRole('button', { name: '重新整理当前状态' }))

    await waitFor(() =>
      expect(api.states.adjust).toHaveBeenCalledWith({
        schoolId: 'school-1',
        feedback: '领导力这部分先别判断，还需要更多观察',
      }),
    )
    expect(await screen.findByText('结合你的补充，我重新整理了当前状态。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '确认现在的状态' }))
    expect(await screen.findByText('已经记录这所学校当前的起点状态。')).toBeInTheDocument()
    expect(screen.getByText('起点状态')).toBeInTheDocument()
    expect(api.states.confirm).toHaveBeenCalledWith({ schoolId: 'school-1' })
  })

  it('shows new changes, keeps adjustment transient and confirms the current state with comparison', async () => {
    const adjusted: StateWorkspaceView = {
      ...updateDraft,
      overview: {
        ...updateDraft.overview,
        summary: '结合你的补充，我重新整理了当前状态。',
      },
    }
    const current: StateWorkspaceView = { ...adjusted, state: 'current' }
    const api = baseApi(updateDraft)
    vi.mocked(api.states.adjust).mockResolvedValue(adjusted)
    vi.mocked(api.states.confirm).mockResolvedValue(current)

    renderPage(api)

    expect(
      await screen.findByText('这轮你已经确认了 1 个新的变化，我重新整理了一下学校现在的状态。'),
    ).toBeInTheDocument()
    expect(screen.getByText('和上一次相比')).toBeInTheDocument()
    expect(screen.getByText('改善')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '我想调整' }))
    await userEvent.type(screen.getByLabelText('哪里需要调整？'), '文化这部分先别判断')
    await userEvent.click(screen.getByRole('button', { name: '重新整理当前状态' }))
    expect(await screen.findByText('结合你的补充，我重新整理了当前状态。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '确认现在的状态' }))
    expect(await screen.findByText('已经记录这所学校现在的状态。')).toBeInTheDocument()
    expect(screen.getByText('和上一次相比')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认现在的状态' })).not.toBeInTheDocument()
  })

  it('gives an actionable empty state when there is no active stage', async () => {
    const api = baseApi({ state: 'needs_stage' })
    renderPage(api)

    expect(await screen.findByText('还没有可以用来判断状态的当前阶段')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '回工作台确认阶段' }))
    expect(await screen.findByText('工作台页面')).toBeInTheDocument()
  })
})
