// @vitest-environment jsdom

import type { WorkbenchApi } from '@school-workbench/shared'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { SchoolWorkspacePage } from './school-workspace-page'

const school = {
  id: 'school-1',
  name: '南山实验学校',
  currentStageId: null,
  currentStageTitle: null,
  createdAt: '2026-08-17T00:00:00.000Z',
}

const reviewView = {
  evidence: [{ id: 'e-1', title: '顾问输入', sourceType: 'pasted_text' }],
  facts: [
    {
      id: 'f-1',
      text: '中层会议里仍由校长完成任务拆解。',
      directness: 'medium' as const,
    },
  ],
  claims: [{ id: 'c-1', text: '中层当前可能仍依赖校长完成任务拆解。' }],
  proposal: {
    id: 'd-1',
    title: '一个新的情况',
    interpretations: ['这条情况来自顾问直接输入，当前只形成暂定解释。'],
    provisionalJudgment: '中层会议里仍由校长完成任务拆解。',
    alternativeHypotheses: ['这可能只是一次局部现象，还不能代表稳定状态。'],
    unresolvedQuestions: ['还有没有独立材料支持或反驳这条判断？'],
    proposedActions: [],
    recommendedObservations: ['寻找至少一条独立材料进行交叉验证。'],
    impactMeasures: [],
    evidenceQuality: { directness: 'medium' as const, triangulated: false },
    confidence: 'low' as const,
    evidenceCount: 1,
    status: 'proposed' as const,
    createdAt: '2026-08-17T00:00:00.000Z',
  },
}

const suggestedStage = {
  state: 'suggested' as const,
  stage: {
    id: 'stage-1',
    title: '建立共同推动改进的组织基础',
    summary: '我理解这个学校目前大致处于“建立共同推动改进的组织基础”的阶段。',
    focus: '这个阶段现在最需要看到：中层开始独立承担关键任务。',
    targets: [
      { id: 't1', dimensionKey: 'leadership' as const, label: '领导力', text: '目标 1' },
      { id: 't2', dimensionKey: 'key_tasks' as const, label: '关键任务', text: '目标 2' },
      { id: 't3', dimensionKey: 'structure' as const, label: '结构与机制', text: '目标 3' },
      { id: 't4', dimensionKey: 'culture' as const, label: '文化', text: '目标 4' },
      { id: 't5', dimensionKey: 'capability' as const, label: '能力', text: '目标 5' },
    ],
  },
}

const activeStage = { ...suggestedStage, state: 'active' as const }

function baseApi(): WorkbenchApi {
  return {
    schools: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(school),
    },
    judgments: {
      listAccepted: vi.fn().mockResolvedValue([]),
      submitSituation: vi.fn().mockResolvedValue(reviewView),
      review: vi.fn(),
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
  }
}

function renderWorkspace(api: WorkbenchApi): void {
  render(
    <WorkbenchApiProvider api={api}>
      <MemoryRouter initialEntries={['/schools/school-1']}>
        <Routes>
          <Route path="/schools/:schoolId" element={<SchoolWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </WorkbenchApiProvider>,
  )
}

async function submitSituation(): Promise<void> {
  expect(await screen.findByText('南山实验学校')).toBeInTheDocument()
  await userEvent.type(
    screen.getByPlaceholderText(/例如：今天的中层会议里/),
    '中层会议里仍由校长完成任务拆解。',
  )
  await userEvent.click(screen.getByRole('button', { name: '提交情况' }))
  expect(await screen.findByText('我发现一个新的情况，想让你确认')).toBeInTheDocument()
}

afterEach(cleanup)

describe('SchoolWorkspacePage', () => {
  it('submits a situation, reviews the proposed judgment and records acceptance', async () => {
    const acceptedJudgment = {
      id: 'j-1',
      proposalId: 'd-1',
      text: reviewView.proposal.provisionalJudgment,
      createdAt: '2026-08-17T00:01:00.000Z',
    }
    const api = baseApi()
    vi.mocked(api.judgments.review).mockResolvedValue({ decision: 'accepted', acceptedJudgment })

    renderWorkspace(api)
    await submitSituation()
    await userEvent.click(screen.getByRole('button', { name: /^认同$/ }))

    await waitFor(() =>
      expect(api.judgments.review).toHaveBeenCalledWith({
        schoolId: 'school-1',
        diagnosisId: 'd-1',
        decision: 'accepted',
      }),
    )
    expect(await screen.findByText('已经记录这条判断。')).toBeInTheDocument()
    expect(screen.getByText(acceptedJudgment.text)).toBeInTheDocument()
    await waitFor(() => expect(api.stages.getWorkspace).toHaveBeenCalledTimes(2))
  })

  it('lets the consultant request more evidence without creating an accepted judgment', async () => {
    const api = baseApi()
    vi.mocked(api.judgments.review).mockResolvedValue({
      decision: 'needs_more_evidence',
      acceptedJudgment: null,
    })

    renderWorkspace(api)
    await submitSituation()
    await userEvent.click(screen.getByRole('button', { name: '先补充更多依据' }))

    await waitFor(() =>
      expect(api.judgments.review).toHaveBeenCalledWith({
        schoolId: 'school-1',
        diagnosisId: 'd-1',
        decision: 'needs_more_evidence',
      }),
    )
    expect(
      await screen.findByText('已记下：先补充更多依据，这条判断暂不进入正式记录。'),
    ).toBeInTheDocument()
    expect(screen.queryByText('已由你确认')).not.toBeInTheDocument()
  })

  it('shows a quiet stage suggestion, accepts natural-language adjustment, then confirms it', async () => {
    const adjustedStage = {
      ...suggestedStage,
      stage: {
        ...suggestedStage.stage,
        title: '让改进进入教师实践',
        summary: '我理解这个学校目前大致处于“让改进进入教师实践”的阶段。',
      },
    }
    const api = baseApi()
    vi.mocked(api.stages.getWorkspace).mockResolvedValue(suggestedStage)
    vi.mocked(api.stages.adjust).mockResolvedValue(adjustedStage)
    vi.mocked(api.stages.confirm).mockResolvedValue({
      ...activeStage,
      stage: adjustedStage.stage,
    })

    renderWorkspace(api)

    expect(await screen.findByText(suggestedStage.stage.summary)).toBeInTheDocument()
    expect(screen.getByText('这样理解基本对吗？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '调整一下' }))
    await userEvent.type(screen.getByLabelText('哪里需要调整？'), '目前更需要稳定教研复盘机制')
    await userEvent.click(screen.getByRole('button', { name: '重新整理建议' }))

    expect(await screen.findByText(adjustedStage.stage.summary)).toBeInTheDocument()
    expect(api.stages.adjust).toHaveBeenCalledWith({
      schoolId: 'school-1',
      stageId: 'stage-1',
      feedback: '目前更需要稳定教研复盘机制',
    })

    await userEvent.click(screen.getByRole('button', { name: '基本对' }))
    expect(await screen.findByText('当前阶段')).toBeInTheDocument()
    expect(screen.getByText('让改进进入教师实践')).toBeInTheDocument()
  })
})
