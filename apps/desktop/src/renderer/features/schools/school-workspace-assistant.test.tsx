// @vitest-environment jsdom

import type {
  AgentProgressEvent,
  AgentRunView,
  JudgmentReviewView,
  WorkbenchApi,
} from '@school-workbench/shared'
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
  createdAt: '2026-08-18T00:00:00.000Z',
}

const assistantReview: JudgmentReviewView = {
  evidence: [
    {
      id: 'e-1',
      title: '《9月教研观察记录》',
      sourceType: 'observation',
      sourceLabel: '现场观察',
      uri: null,
      excerpt: '教研组把三节课的课堂记录贴到了公共墙上。',
    },
  ],
  facts: [
    {
      id: 'af-1',
      text: '教研组把课堂记录贴到了公共墙上。',
      directness: 'high',
      evidenceId: 'e-1',
    },
    { id: 'af-2', text: '其他年级教师到公共墙前查看。', directness: 'medium', evidenceId: 'e-1' },
  ],
  counterFacts: [
    { id: 'af-3', text: '只有一个教研组这样做。', directness: 'medium', evidenceId: 'e-1' },
  ],
  claims: [{ id: 'c-1', text: '改进实践开始在公共空间被同伴看见。' }],
  source: 'assistant',
  grounding: {
    schoolName: '南山实验学校',
    stageTitle: '让改进实践变得可见',
    stageTargets: [
      {
        id: 'target-1',
        dimensionKey: 'structure',
        label: '结构与机制',
        text: '教研与课堂实践能够被同伴看见。',
      },
    ],
    criteria: [
      {
        id: 'criterion-1',
        stableKey: 'DW.C2.PRACTICE_VISIBILITY',
        title: '实践可见性',
        description: '成人实践的改变是否可被同伴观察到。',
        packTitle: 'Data Wise',
        packVersion: '3',
      },
    ],
  },
  proposal: {
    id: 'p-assistant',
    title: '改进实践开始可见',
    interpretations: ['贴到公共空间意味着实践开始可被同伴检视。'],
    provisionalJudgment: '改进实践已经开始可见，但还只发生在一个教研组。',
    mechanism: '公共展示让同伴之间的相互检视成为常态。',
    alternativeHypotheses: ['也可能只是这一次公开课的临时安排。'],
    unresolvedQuestions: ['其他教研组是否也会这样做？'],
    proposedActions: ['把公共墙的做法带到另一个教研组试一轮。'],
    recommendedObservations: ['下月再看一次公共墙是否仍在更新。'],
    impactMeasures: ['比较下月两个教研组的公共记录数量。'],
    evidenceQuality: { directness: 'high', triangulated: false },
    confidence: 'medium',
    evidenceCount: 1,
    status: 'proposed',
    createdAt: '2026-08-18T00:00:00.000Z',
  },
}

function agentRun(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    runId: 'run-1',
    status: 'completed',
    outcome: 'proposal_ready',
    proposal: assistantReview,
    abstention: null,
    usedWorkbenchTools: true,
    unrecognisedUpdateKinds: [],
    runtimeCompatibility: 'verified',
    failureCode: null,
    failureMessage: null,
    ...overrides,
  }
}

const activeStage = {
  state: 'active' as const,
  stage: {
    id: 'stage-1',
    title: '让改进实践变得可见',
    summary: '我理解这个学校目前大致处于“让改进实践变得可见”的阶段。',
    focus: '这个阶段现在最需要看到：教研与课堂实践能够被同伴看见。',
    targets: [
      { id: 't1', dimensionKey: 'leadership' as const, label: '领导力', text: '目标 1' },
      { id: 't2', dimensionKey: 'key_tasks' as const, label: '关键任务', text: '目标 2' },
      { id: 't3', dimensionKey: 'structure' as const, label: '结构与机制', text: '目标 3' },
      { id: 't4', dimensionKey: 'culture' as const, label: '文化', text: '目标 4' },
      { id: 't5', dimensionKey: 'capability' as const, label: '能力', text: '目标 5' },
    ],
  },
}
function api(
  availability: 'ready' | 'unavailable' = 'ready',
  overrides: Partial<WorkbenchApi['agent']> = {},
): WorkbenchApi {
  return {
    schools: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(school),
      archive: vi.fn(),
    },
    judgments: {
      listAccepted: vi.fn().mockResolvedValue([]),
      review: vi.fn().mockResolvedValue({ decision: 'accepted', acceptedJudgment: null }),
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
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue({
        selected: 'codex',
        localTools: [],
        options: [
          {
            key: 'codex',
            label: 'Codex',
            availability,
            detail:
              availability === 'ready' ? null : '这台电脑上还没有装好 Codex，装好后重新启动即可。',
          },
        ],
      }),
      chooseAssistant: vi.fn(),
    },
    agent: {
      run: vi.fn().mockResolvedValue(agentRun()),
      onProgress: vi.fn().mockReturnValue(() => undefined),
      ...overrides,
    },
  }
}

function renderPage(workbench: WorkbenchApi): void {
  render(
    <WorkbenchApiProvider api={workbench}>
      <MemoryRouter initialEntries={['/schools/school-1']}>
        <Routes>
          <Route path="/schools/:schoolId" element={<SchoolWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </WorkbenchApiProvider>,
  )
}

async function type(text: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(await screen.findByPlaceholderText(/例如：今天的中层会议里/), text)
}

async function say(text: string, button = '提交情况'): Promise<void> {
  await type(text)
  await userEvent.setup().click(screen.getByRole('button', { name: button }))
}

afterEach(cleanup)

describe('the workbench when the assistant can run', () => {
  it('lets a school with no stage start: the assistant proposes the first stage', async () => {
    const workbench = api()
    vi.mocked(workbench.stages.getWorkspace)
      .mockResolvedValueOnce({ state: 'none' })
      .mockResolvedValue({ state: 'suggested', stage: activeStage.stage })
    vi.mocked(workbench.agent.run).mockResolvedValue(
      agentRun({ outcome: 'no_new_judgment', proposal: null }),
    )
    renderPage(workbench)

    await screen.findByText(/AI 助手会先看一遍/)
    await say('教研组把三节课的记录贴到了公共墙上。')

    expect(workbench.agent.run).toHaveBeenCalledWith({
      schoolId: 'school-1',
      message: '教研组把三节课的记录贴到了公共墙上。',
    })
    expect(
      await screen.findByText('AI 助手根据你说的情况，先提议了一个当前阶段。请确认后再继续。'),
    ).toBeInTheDocument()
    expect(await screen.findByText('这样理解基本对吗？')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交情况' })).toBeDisabled()
  })

  it('still blocks a new run while a stage suggestion is waiting for confirmation', async () => {
    const workbench = api()
    vi.mocked(workbench.stages.getWorkspace).mockResolvedValue({
      state: 'suggested',
      stage: activeStage.stage,
    })
    renderPage(workbench)
    expect(
      await screen.findByText('请先确认或调整上方的阶段建议，再开始新的分析。'),
    ).toBeInTheDocument()
    await type('教研组把三节课的记录贴到了公共墙上。')
    expect(screen.getByRole('button', { name: '提交情况' })).toBeDisabled()
    expect(workbench.agent.run).not.toHaveBeenCalled()
  })

  it('sends the sentence to the assistant and shows the judgement it produced', async () => {
    const workbench = api()
    renderPage(workbench)

    await screen.findByText(/AI 助手会先看一遍/)
    await say('教研组把三节课的记录贴到了公共墙上。')

    await screen.findByText('改进实践已经开始可见，但还只发生在一个教研组。')
    expect(workbench.agent.run).toHaveBeenCalledWith({
      schoolId: 'school-1',
      message: '教研组把三节课的记录贴到了公共墙上。',
    })

    // PRD 17: the counter evidence is shown next to the judgement.
    expect(screen.getByText(/依据 1 条 · 有 1 条相反迹象/)).toBeInTheDocument()
    expect(screen.getByText(/这条是 AI 助手看过这所学校的情况后整理的/)).toBeInTheDocument()

    // And it still has to be confirmed by a person.
    expect(screen.getByRole('button', { name: '认同' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不认同' })).toBeInTheDocument()
  })

  it('shows everything PRD 18 requires when the consultant asks why', async () => {
    renderPage(api())
    await screen.findByText(/AI 助手会先看一遍/)
    await say('教研组把三节课的记录贴到了公共墙上。')
    await screen.findByText('改进实践已经开始可见，但还只发生在一个教研组。')

    for (const heading of [
      '我看到的事实',
      '这些事实可能说明什么',
      '支持这个判断的依据',
      '与这个判断不一致的依据',
      '还有哪些可能的解释',
      '目前还不能确定什么',
      '我认为背后的机制',
      '下一轮值得重点观察什么',
      '建议采取的行动',
      '怎么验证这些行动是否起作用',
      '这条判断的出处',
    ]) {
      expect(screen.getByText(heading), heading).toBeInTheDocument()
    }

    // The grounds themselves, with where they came from and which versioned
    // standard the judgement was measured against.
    expect(screen.getByText(/《9月教研观察记录》（现场观察）/)).toBeInTheDocument()
    expect(screen.getByText(/只有一个教研组这样做。/)).toBeInTheDocument()
    expect(screen.getByText(/公共展示让同伴之间的相互检视成为常态。/)).toBeInTheDocument()
    expect(screen.getByText(/判断标准 · 实践可见性（Data Wise 第 3 版）/)).toBeInTheDocument()
    expect(screen.getByText(/本阶段目标 · 结构与机制/)).toBeInTheDocument()
  })

  it('keeps the assistant judgement, the feedback and the final text on a rewrite', async () => {
    const workbench = api()
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('教研组把三节课的记录贴到了公共墙上。')
    await screen.findByText('改进实践已经开始可见，但还只发生在一个教研组。')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '我想改一下' }))
    await user.type(screen.getByLabelText('你觉得哪里不准确？'), '只有一个组，说学校太大了。')
    await user.click(screen.getByRole('button', { name: '确认修改' }))

    await waitFor(() => {
      expect(workbench.judgments.review).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'modified',
          feedback: '只有一个组，说学校太大了。',
          finalText: '改进实践已经开始可见，但还只发生在一个教研组。',
        }),
      )
    })
  })

  it('ignores progress meant for another school', async () => {
    const listeners: Array<(event: AgentProgressEvent) => void> = []
    const workbench = api('ready', {
      onProgress: vi.fn().mockImplementation((handler: (event: AgentProgressEvent) => void) => {
        listeners.push(handler)
        return () => undefined
      }),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)

    for (const listener of listeners) listener({ schoolId: 'another-school', phase: 'comparing' })
    await waitFor(() => {
      expect(screen.queryByText('正在比较最近变化……')).not.toBeInTheDocument()
    })
  })

  it('respects an abstention instead of producing a judgement anyway', async () => {
    const workbench = api('ready', {
      run: vi.fn().mockResolvedValue(
        agentRun({
          outcome: 'needs_more_evidence',
          proposal: null,
          abstention: {
            unresolvedQuestions: ['一次转述还不足以判断这是稳定实践。'],
            nextObservations: ['再看一次同类会议的分工记录。'],
          },
        }),
      ),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('今天中层会议还是校长在拆任务。')

    await screen.findByText(/目前依据不足，暂不形成判断/)
    expect(screen.getByText('再看一次同类会议的分工记录。')).toBeInTheDocument()
    // Nothing to accept, and no second path that would produce something.
    expect(screen.queryByRole('button', { name: '认同' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '我想改一下' })).not.toBeInTheDocument()
    expect(workbench.judgments.review).not.toHaveBeenCalled()
    // The consultant's words are still in the box.
    expect(screen.getByDisplayValue('今天中层会议还是校长在拆任务。')).toBeInTheDocument()
  })

  it('keeps the sentence and offers a retry when the assistant fails', async () => {
    const workbench = api('ready', {
      run: vi.fn().mockResolvedValue(
        agentRun({
          status: 'failed',
          outcome: 'failed',
          proposal: null,
          usedWorkbenchTools: false,
          failureCode: 'RUNTIME_NOT_FOUND',
          failureMessage:
            'SWB_CODEX_ACP_ENTRY points at a path that does not exist: /Users/x/node_modules/@agentclientprotocol/codex-acp/dist/index.js',
        }),
      ),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('中层会议上任务拆解还是校长在做。')

    await screen.findByText(/AI 助手在这台电脑上还没准备好/)
    expect(screen.getByDisplayValue('中层会议上任务拆解还是校长在做。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    // No judgement appeared out of nowhere.
    expect(screen.queryByRole('button', { name: '认同' })).not.toBeInTheDocument()
    expect(workbench.judgments.review).not.toHaveBeenCalled()

    const shown = document.body.textContent ?? ''
    for (const leak of [
      'SWB_CODEX_ACP_ENTRY',
      'node_modules',
      'codex-acp',
      'RUNTIME_NOT_FOUND',
      'run-1',
    ]) {
      expect(shown, leak).not.toContain(leak)
    }
  })

  it('says so plainly when the assistant call throws, and writes nothing down', async () => {
    const workbench = api('ready', {
      run: vi.fn().mockRejectedValue(new Error('ipc exploded at /Users/x/main.js')),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('先记一条。')

    await screen.findByText(/AI 助手这次没能完成/)
    expect(document.body.textContent ?? '').not.toContain('ipc exploded')
    expect(screen.getByDisplayValue('先记一条。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '认同' })).not.toBeInTheDocument()
    expect(workbench.judgments.review).not.toHaveBeenCalled()
  })
})

describe('the workbench when no assistant can run', () => {
  it('cannot start new analysis, and says so without blaming the consultant', async () => {
    const workbench = api('unavailable')
    renderPage(workbench)

    await screen.findByText('现在还不能开始新的分析')
    expect(screen.getByText(/这台电脑上还没有装好 Codex/)).toBeInTheDocument()

    const box = screen.getByPlaceholderText(/例如：今天的中层会议里/)
    expect(box).toBeDisabled()
    expect(screen.getByRole('button', { name: '提交情况' })).toBeDisabled()
    expect(workbench.agent.run).not.toHaveBeenCalled()
  })

  it('still shows what has already been recorded', async () => {
    const workbench = api('unavailable')
    workbench.judgments.listAccepted = vi.fn().mockResolvedValue([
      {
        id: 'j-1',
        proposalId: 'p-1',
        text: '中层已经能够独立完成关键任务拆解。',
        createdAt: '2026-08-18T00:00:00.000Z',
      },
    ])
    renderPage(workbench)

    await screen.findByText('中层已经能够独立完成关键任务拆解。')
    expect(screen.getByText('已由你确认')).toBeInTheDocument()
  })
})
