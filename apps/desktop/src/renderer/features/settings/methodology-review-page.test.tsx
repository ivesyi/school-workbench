// @vitest-environment jsdom

import type { PackReviewWorkbenchView, WorkbenchApi } from '@school-workbench/shared'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchApiProvider } from '../../lib/workbench-api'
import { MethodologyReviewPage } from './methodology-review-page'
import { SettingsPage } from './settings-page'

function criterion(stableKey: string, title: string, gaps: string[]) {
  return {
    stableKey,
    title,
    description: title,
    constructTitle: '长期使命与学习结果',
    assessmentQuestion: '变革要让学习者最终获得什么？',
    practiceType: 'school_design',
    dimensionLabel: null,
    appliesTo: ['学校使命'],
    doesNotApplyTo: ['单次课堂评价'],
    applicabilityNotes: [],
    supportingIndicators: ['使命被转译为具体的学习结果。'],
    counterIndicators: ['目标只写活动。'],
    insufficientEvidence: ['只有一份愿景文件。'],
    counterexampleChecks: [],
    collectionPrinciples: [],
    adjustmentConditions: [],
    guardrails: [],
    behaviorAnchorCount: 0,
    sourceLocator: {
      label: '从使命和项目目标逆向规划',
      chapter: 'Chapter 8',
      printedPages: '199–203',
      figure: null,
    },
    gaps,
    lastVerdict: null,
  }
}

const pending: PackReviewWorkbenchView = {
  state: 'ready',
  packs: [
    {
      key: 'schooling-by-design',
      version: '1',
      title: 'Schooling by Design Methodology Pack v1',
      status: 'review',
      statusLabel: '待审核',
      statusDetail: '还没有人审核过这份内容，它不会用于正式判断。',
      inUse: false,
      sourceLabel: '书籍',
      constructs: [
        {
          stableKey: 'SBD.MISSION',
          title: '长期使命与学习结果',
          assessmentQuestion: '变革要让学习者最终获得什么？',
          sourceLocator: {
            label: '六项全校设计支柱',
            chapter: 'Introduction',
            printedPages: '6–9',
            figure: null,
          },
        },
      ],
      criteria: [
        criterion('SBD.C1.RESULT_CLARITY', '结果清晰度', [
          '还没有真正的描述：描述与名称完全相同。',
          '还没有对应到五个维度中的任何一个。',
        ]),
        criterion('SBD.C2.EVIDENCE_BEFORE_ACTION', '证据先于行动', [
          '还没有真正的描述：描述与名称完全相同。',
        ]),
      ],
      packGuardrails: ['必须关联 Criterion ID。'],
      behaviorAnchorCount: 0,
      review: null,
      technical: {
        packId: 'schooling-by-design-v1',
        sourceRef: 'references/books/schooling-by-design-2007.pdf',
        sourceFingerprint: 'b'.repeat(64),
        contentHash: 'c'.repeat(64),
        fileStatus: 'review',
        storedStatus: 'review',
        reviewedContentHash: null,
      },
    },
  ],
}

const reviewed: PackReviewWorkbenchView = {
  state: 'ready',
  packs: [
    {
      ...pending.packs[0]!,
      statusDetail: '上次审核认为这份内容还需要修订，因此没有启用。',
      review: {
        decision: 'changes_requested',
        decisionLabel: '需要修订',
        decidedAt: '2026-08-17T09:00:00.000Z',
        note: '描述需要回到原书措辞。',
        usableCount: 1,
        needsRevisionCount: 1,
        outdated: false,
      },
      technical: { ...pending.packs[0]!.technical, reviewedContentHash: 'c'.repeat(64) },
    },
  ],
}

function apiWith(methodology: WorkbenchApi['methodology']): WorkbenchApi {
  return {
    schools: { list: vi.fn(), create: vi.fn(), get: vi.fn() },
    judgments: { submitSituation: vi.fn(), review: vi.fn(), listAccepted: vi.fn() },
    stages: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    states: { getWorkspace: vi.fn(), adjust: vi.fn(), confirm: vi.fn() },
    methodology,
  }
}

function renderPage(api: WorkbenchApi, initialEntry = '/settings/methodology-review'): void {
  render(
    <WorkbenchApiProvider api={api}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/methodology-review" element={<MethodologyReviewPage />} />
        </Routes>
      </MemoryRouter>
    </WorkbenchApiProvider>,
  )
}

afterEach(() => cleanup())

describe('MethodologyReviewPage', () => {
  it('reaches the review workbench only through advanced settings, never the main navigation', async () => {
    renderPage(
      apiWith({ getReviewWorkbench: vi.fn().mockResolvedValue(pending), signOff: vi.fn() }),
      '/settings',
    )

    await userEvent.click(screen.getByText('高级设置'))
    await userEvent.click(screen.getByRole('link', { name: /方法论内容审核/ }))

    expect(await screen.findByRole('heading', { name: '方法论内容审核' })).toBeInTheDocument()
  })

  it('shows the reviewable content, its current status and the gaps in this translation', async () => {
    renderPage(
      apiWith({ getReviewWorkbench: vi.fn().mockResolvedValue(pending), signOff: vi.fn() }),
    )

    expect(await screen.findByText('Schooling by Design Methodology Pack v1')).toBeInTheDocument()
    expect(screen.getByText('待审核')).toBeInTheDocument()
    expect(screen.getByText('还没有人审核过这份内容，它不会用于正式判断。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '结果清晰度' })).toBeInTheDocument()
    // The translated description is still identical to the title.
    expect(screen.getAllByText('结果清晰度')).toHaveLength(2)
    expect(screen.getAllByText('· 还没有真正的描述：描述与名称完全相同。')).toHaveLength(2)
    expect(screen.getByText('· 还没有对应到五个维度中的任何一个。')).toBeInTheDocument()
    expect(screen.getByText('还有 2 条没有给出结论。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交审核结论' })).toBeDisabled()

    // Technical vocabulary stays inside the advanced disclosure.
    expect(screen.queryByText(/canonicalContentHash/)).not.toBeInTheDocument()
    expect(screen.queryByText(/syncRegistry/)).not.toBeInTheDocument()
  })

  it('submits one conclusion per criterion and shows the recorded outcome', async () => {
    const signOff = vi.fn().mockResolvedValue(reviewed)
    renderPage(apiWith({ getReviewWorkbench: vi.fn().mockResolvedValue(pending), signOff }))

    const first = await screen.findByRole('group', { name: '结果清晰度：这条可以用来判断吗？' })
    await userEvent.click(within(first).getByRole('radio', { name: '需要修订' }))
    await userEvent.type(screen.getByLabelText('结果清晰度的未决意见'), '描述与名称完全相同。')

    expect(screen.getByRole('button', { name: '提交审核结论' })).toBeDisabled()

    const second = screen.getByRole('group', { name: '证据先于行动：这条可以用来判断吗？' })
    await userEvent.click(within(second).getByRole('radio', { name: '可以用于判断' }))
    await userEvent.type(
      screen.getByLabelText('Schooling by Design Methodology Pack v1的未决意见'),
      '需要补翻译后再看。',
    )
    await userEvent.click(screen.getByRole('button', { name: '提交审核结论' }))

    await waitFor(() =>
      expect(signOff).toHaveBeenCalledWith({
        packKey: 'schooling-by-design',
        packVersion: '1',
        note: '需要补翻译后再看。',
        verdicts: [
          {
            criterionStableKey: 'SBD.C1.RESULT_CLARITY',
            verdict: 'needs_revision',
            note: '描述与名称完全相同。',
          },
          {
            criterionStableKey: 'SBD.C2.EVIDENCE_BEFORE_ACTION',
            verdict: 'usable',
            note: null,
          },
        ],
      }),
    )
    expect(await screen.findByText(/上次结论：需要修订/)).toBeInTheDocument()
    expect(screen.getByText('可以用于判断 1 条 · 需要修订 1 条')).toBeInTheDocument()
    expect(screen.getByText('上次审核认为这份内容还需要修订，因此没有启用。')).toBeInTheDocument()
  })

  it('stays usable and quiet when methodology content cannot be read', async () => {
    renderPage(
      apiWith({
        getReviewWorkbench: vi.fn().mockResolvedValue({
          state: 'unavailable',
          message: '方法论内容暂时读不到，工作台其他部分不受影响。',
          detail: 'No methodology pack.json files found',
        }),
        signOff: vi.fn(),
      }),
    )

    expect(await screen.findByText('暂时看不到方法论内容')).toBeInTheDocument()
    expect(screen.getByText('方法论内容暂时读不到，工作台其他部分不受影响。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交审核结论' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No methodology pack.json files found/)).not.toBeInTheDocument()
  })
})
