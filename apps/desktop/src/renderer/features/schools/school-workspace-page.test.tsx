// @vitest-environment jsdom

import type { AgentRunView, JudgmentReviewView, WorkbenchApi } from '@school-workbench/shared'
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

const reviewView: JudgmentReviewView = {
  evidence: [
    {
      id: 'e-1',
      title: '《8月中层会议纪要》',
      sourceType: 'feishu_doc',
      sourceLabel: '飞书文档',
      uri: null,
      excerpt: '三项关键任务都由校长拆解。',
    },
  ],
  facts: [
    {
      id: 'f-1',
      text: '中层会议里仍由校长完成任务拆解。',
      directness: 'medium',
      evidenceId: 'e-1',
    },
  ],
  counterFacts: [],
  source: 'assistant',
  claims: [{ id: 'c-1', text: '中层当前可能仍依赖校长完成任务拆解。' }],
  grounding: {
    schoolName: '南山实验学校',
    stageTitle: '中层承接机制建立',
    stageTargets: [
      {
        id: 't-1',
        dimensionKey: 'key_tasks',
        label: '关键任务',
        text: '中层开始独立完成任务转译。',
      },
    ],
    criteria: [
      {
        id: 'criterion-1',
        stableKey: 'SBD.C4.SYSTEM_ALIGNMENT',
        title: '系统一致性',
        description: '关键任务与阶段目标是否一致。',
        packTitle: 'Schooling by Design',
        packVersion: '1',
      },
    ],
  },
  proposal: {
    id: 'd-1',
    title: '一个新的情况',
    interpretations: ['这条情况当前只形成暂定解释。'],
    provisionalJudgment: '中层会议里仍由校长完成任务拆解。',
    mechanism: null,
    alternativeHypotheses: ['这可能只是一次局部现象，还不能代表稳定状态。'],
    unresolvedQuestions: ['还有没有独立材料支持或反驳这条判断？'],
    proposedActions: [],
    recommendedObservations: ['寻找至少一条独立材料进行交叉验证。'],
    impactMeasures: [],
    evidenceQuality: { directness: 'medium', triangulated: false },
    confidence: 'low',
    evidenceCount: 1,
    status: 'proposed',
    createdAt: '2026-08-17T00:00:00.000Z',
  },
}

const assistantRun: AgentRunView = {
  runId: 'run-1',
  status: 'completed',
  outcome: 'proposal_ready',
  proposal: reviewView,
  abstention: null,
  usedWorkbenchTools: true,
  unrecognisedUpdateKinds: [],
  runtimeCompatibility: 'verified',
  failureCode: null,
  failureMessage: null,
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
      archive: vi.fn(),
    },
    judgments: {
      listAccepted: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([]),
      review: vi.fn(),
    },
    stages: {
      getWorkspace: vi.fn().mockResolvedValue(activeStage),
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
      saveModelChannel: vi.fn(),
      clearModelChannel: vi.fn(),
      testFeishuRead: vi.fn(),
    },
    agent: {
      run: vi.fn().mockResolvedValue(assistantRun),
      onProgress: vi.fn().mockReturnValue(() => undefined),
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

  it('renders a pending judgement that was already in the school when the page opens', async () => {
    const api = baseApi()
    vi.mocked(api.judgments.listPending).mockResolvedValue([reviewView])

    renderWorkspace(api)

    expect(await screen.findByText('我发现一个新的情况，想让你确认')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: reviewView.proposal.provisionalJudgment }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^认同$/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '我想改一下' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不认同' })).toBeEnabled()
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('removes a mount-loaded pending card after the consultant accepts it', async () => {
    const acceptedJudgment = {
      id: 'j-1',
      proposalId: 'd-1',
      text: reviewView.proposal.provisionalJudgment,
      createdAt: '2026-08-17T00:01:00.000Z',
    }
    const api = baseApi()
    vi.mocked(api.judgments.listPending).mockResolvedValue([reviewView])
    vi.mocked(api.judgments.review).mockResolvedValue({ decision: 'accepted', acceptedJudgment })

    renderWorkspace(api)
    expect(await screen.findByText('我发现一个新的情况，想让你确认')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^认同$/ }))

    await waitFor(() =>
      expect(api.judgments.review).toHaveBeenCalledWith({
        schoolId: 'school-1',
        diagnosisId: 'd-1',
        decision: 'accepted',
      }),
    )
    expect(await screen.findByText('已经记录这条判断。')).toBeInTheDocument()
    expect(screen.queryByText('我发现一个新的情况，想让你确认')).not.toBeInTheDocument()
    expect(screen.getByText(acceptedJudgment.text)).toBeInTheDocument()
  })

  it('shows every pending judgement newest first', async () => {
    const older: JudgmentReviewView = {
      ...reviewView,
      proposal: {
        ...reviewView.proposal,
        id: 'd-old',
        provisionalJudgment: '较早的待确认判断。',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    }
    const newer: JudgmentReviewView = {
      ...reviewView,
      proposal: {
        ...reviewView.proposal,
        id: 'd-new',
        provisionalJudgment: '较新的待确认判断。',
        createdAt: '2026-08-18T00:00:00.000Z',
      },
    }
    const api = baseApi()
    vi.mocked(api.judgments.listPending).mockResolvedValue([newer, older])

    renderWorkspace(api)

    expect(await screen.findByText('较新的待确认判断。')).toBeInTheDocument()
    expect(screen.getByText('较早的待确认判断。')).toBeInTheDocument()
    const newerHeading = screen.getByRole('heading', { name: '较新的待确认判断。' })
    const olderHeading = screen.getByRole('heading', { name: '较早的待确认判断。' })
    expect(
      newerHeading.compareDocumentPosition(olderHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getAllByText('我发现一个新的情况，想让你确认')).toHaveLength(2)
  })
})
