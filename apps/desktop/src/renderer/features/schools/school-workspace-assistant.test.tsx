// @vitest-environment jsdom

import type { AgentProgressEvent, AgentRunView, WorkbenchApi } from '@school-workbench/shared'
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

const workbenchReview = {
  evidence: [{ id: 'e-1', title: '顾问输入', sourceType: 'pasted_text' }],
  facts: [{ id: 'f-1', text: '顾问报告的情况', directness: 'medium' as const }],
  counterFacts: [],
  source: 'workbench' as const,
  claims: [{ id: 'c-1', text: '当前有迹象表明……' }],
  proposal: {
    id: 'p-workbench',
    title: '一个新的情况',
    interpretations: ['目前只有顾问的一条直接报告。'],
    provisionalJudgment: '中层仍然依赖校长完成关键任务拆解。',
    alternativeHypotheses: [],
    unresolvedQuestions: [],
    proposedActions: [],
    recommendedObservations: [],
    impactMeasures: [],
    evidenceQuality: { directness: 'medium' as const, triangulated: false },
    confidence: 'low' as const,
    evidenceCount: 1,
    status: 'proposed' as const,
    createdAt: '2026-08-18T00:00:00.000Z',
  },
}

const assistantReview = {
  ...workbenchReview,
  source: 'assistant' as const,
  facts: [
    { id: 'af-1', text: '教研组把课堂记录贴到了公共墙上。', directness: 'high' as const },
    { id: 'af-2', text: '其他年级教师到公共墙前查看。', directness: 'medium' as const },
  ],
  counterFacts: [{ id: 'af-3', text: '只有一个教研组这样做。', directness: 'medium' as const }],
  proposal: {
    ...workbenchReview.proposal,
    id: 'p-assistant',
    provisionalJudgment: '改进实践已经开始可见，但还只发生在一个教研组。',
    evidenceCount: 2,
  },
}

function agentRun(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    runId: 'run-1',
    status: 'completed',
    outcome: 'proposal_ready',
    proposal: assistantReview,
    usedWorkbenchTools: true,
    unrecognisedUpdateKinds: [],
    runtimeCompatibility: 'verified',
    failureCode: null,
    failureMessage: null,
    ...overrides,
  }
}

function api(
  selected: 'codex' | 'none',
  overrides: Partial<WorkbenchApi['agent']> = {},
): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn().mockResolvedValue(school) },
    judgments: {
      listAccepted: vi.fn().mockResolvedValue([]),
      submitSituation: vi.fn().mockResolvedValue(workbenchReview),
      review: vi.fn().mockResolvedValue({ decision: 'accepted', acceptedJudgment: null }),
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
    methodology: { getReviewWorkbench: vi.fn(), signOff: vi.fn() },
    settings: {
      getAssistant: vi.fn().mockResolvedValue({
        selected,
        options: [
          { key: 'codex', label: 'Codex', availability: 'ready', detail: null },
          { key: 'none', label: '暂不使用 AI 助手', availability: 'ready', detail: null },
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

async function say(text: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(await screen.findByPlaceholderText(/例如：今天的中层会议里/), text)
  await user.click(screen.getByRole('button', { name: '提交情况' }))
}

afterEach(cleanup)

describe('the workbench when an assistant has been chosen', () => {
  it('sends the sentence to the assistant and shows the judgement it produced', async () => {
    const workbench = api('codex')
    renderPage(workbench)

    await screen.findByText(/AI 助手会先看一遍/)
    await say('教研组把三节课的记录贴到了公共墙上。')

    await screen.findByText('改进实践已经开始可见，但还只发生在一个教研组。')
    expect(workbench.agent.run).toHaveBeenCalledWith({
      schoolId: 'school-1',
      message: '教研组把三节课的记录贴到了公共墙上。',
    })
    // One sentence produces one pending judgement, never two.
    expect(workbench.judgments.submitSituation).not.toHaveBeenCalled()

    // PRD 17: the counter evidence is shown next to the judgement.
    expect(screen.getByText(/依据 2 条 · 有 1 条相反迹象/)).toBeInTheDocument()
    expect(screen.getByText(/这条是 AI 助手看过这所学校的情况后整理的/)).toBeInTheDocument()

    // And it still has to be confirmed by a person.
    expect(screen.getByRole('button', { name: '认同' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不认同' })).toBeInTheDocument()
  })

  it('shows only the four allowed steps while it works', async () => {
    const listeners: Array<(event: AgentProgressEvent) => void> = []
    const workbench = api('codex', {
      onProgress: vi.fn().mockImplementation((handler: (event: AgentProgressEvent) => void) => {
        listeners.push(handler)
        return () => undefined
      }),
      run: vi.fn().mockImplementation(async () => {
        for (const listener of listeners) listener({ schoolId: 'school-1', phase: 'gathering' })
        return agentRun()
      }),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('看看最近的教研。')

    await waitFor(() => {
      expect(workbench.agent.run).toHaveBeenCalled()
    })
    await screen.findByText('改进实践已经开始可见，但还只发生在一个教研组。')
  })

  it('ignores progress meant for another school', async () => {
    const listeners: Array<(event: AgentProgressEvent) => void> = []
    const workbench = api('codex', {
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

  it('keeps the sentence when the assistant comes back with nothing', async () => {
    const workbench = api('codex', {
      run: vi.fn().mockResolvedValue(agentRun({ outcome: 'no_new_judgment', proposal: null })),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('今天没什么特别的。')

    await screen.findByText(/这次没有形成需要你确认的新判断/)
    expect(workbench.judgments.submitSituation).toHaveBeenCalled()
    // The workbench's own judgement is there to confirm, so nothing was lost.
    expect(screen.getByText('中层仍然依赖校长完成关键任务拆解。')).toBeInTheDocument()
  })

  it('keeps working when the assistant fails, and never shows the reason verbatim', async () => {
    const workbench = api('codex', {
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

    await screen.findByText('中层仍然依赖校长完成关键任务拆解。')
    expect(screen.getByText(/AI 助手在这台电脑上还没准备好/)).toBeInTheDocument()

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

  it('records the sentence itself when the assistant call throws', async () => {
    const workbench = api('codex', {
      run: vi.fn().mockRejectedValue(new Error('ipc exploded at /Users/x/main.js')),
    })
    renderPage(workbench)
    await screen.findByText(/AI 助手会先看一遍/)
    await say('先记一条。')

    await screen.findByText('中层仍然依赖校长完成关键任务拆解。')
    expect(document.body.textContent ?? '').not.toContain('ipc exploded')
  })
})

describe('the workbench when no assistant has been chosen', () => {
  it('records the sentence immediately and never calls one', async () => {
    const workbench = api('none')
    renderPage(workbench)

    await screen.findByText(/你可以在设置里让 AI 助手参与进来/)
    await say('中层会议上任务拆解还是校长在做。')

    await screen.findByText('中层仍然依赖校长完成关键任务拆解。')
    expect(workbench.agent.run).not.toHaveBeenCalled()
    expect(workbench.judgments.submitSituation).toHaveBeenCalled()
  })
})
