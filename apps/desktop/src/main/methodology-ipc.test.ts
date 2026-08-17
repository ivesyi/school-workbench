import type { MethodologyReviewService } from '@school-workbench/application'
import { MethodologyRegistry } from '@school-workbench/methodology'
import type { PackReviewWorkbenchView } from '@school-workbench/shared'
import { describe, expect, it, vi } from 'vitest'
import { createMethodologyIpcHandlers } from './methodology-ipc'
import type { MethodologyRuntime } from './methodology-runtime'

const readyView: PackReviewWorkbenchView = {
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
      constructs: [],
      criteria: [
        {
          stableKey: 'SBD.C1.RESULT_CLARITY',
          title: '结果清晰度',
          description: '结果清晰度',
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
          gaps: ['还没有真正的描述：描述与名称完全相同。'],
          lastVerdict: null,
        },
      ],
      packGuardrails: [],
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

function readyRuntime(service: MethodologyReviewService): () => Promise<MethodologyRuntime> {
  // These handlers only use `service`; the registry and repository are the
  // collaborators the read plane needs, so they stay inert here.
  return async () => ({
    state: 'ready',
    service,
    registry: new MethodologyRegistry([]),
    repository: {
      listPacks: async () => [],
      getPack: async () => null,
      getCriterion: async () => null,
      findCriteria: async () => [],
    },
  })
}

describe('methodology IPC handlers', () => {
  it('validates input and forwards the review workbench', async () => {
    const service = {
      getWorkbench: vi.fn().mockResolvedValue(readyView),
      signOff: vi.fn().mockResolvedValue(readyView),
    } as unknown as MethodologyReviewService
    const handlers = createMethodologyIpcHandlers(readyRuntime(service))

    await expect(handlers.getReviewWorkbench()).resolves.toEqual(readyView)
    await handlers.signOff({
      packKey: 'schooling-by-design',
      packVersion: '1',
      note: null,
      verdicts: [
        { criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'needs_revision', note: '缺描述' },
      ],
    })

    expect(service.signOff).toHaveBeenCalledWith({
      packKey: 'schooling-by-design',
      packVersion: '1',
      note: null,
      verdicts: [
        { criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'needs_revision', note: '缺描述' },
      ],
    })
  })

  it('rejects malformed sign-off input before it reaches the service', async () => {
    const service = {
      getWorkbench: vi.fn(),
      signOff: vi.fn(),
    } as unknown as MethodologyReviewService
    const handlers = createMethodologyIpcHandlers(readyRuntime(service))

    await expect(handlers.signOff({ packKey: 'schooling-by-design' })).rejects.toThrow()
    await expect(
      handlers.signOff({
        packKey: 'schooling-by-design',
        packVersion: '1',
        note: null,
        verdicts: [{ criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'maybe', note: null }],
      }),
    ).rejects.toThrow()
    expect(service.signOff).not.toHaveBeenCalled()
  })

  it('reports a quiet unavailable surface instead of failing when methodology is missing', async () => {
    const handlers = createMethodologyIpcHandlers(async () => ({
      state: 'unavailable',
      detail: 'No methodology pack.json files found',
    }))

    await expect(handlers.getReviewWorkbench()).resolves.toEqual({
      state: 'unavailable',
      message: '方法论内容暂时读不到，工作台其他部分不受影响。',
      detail: 'No methodology pack.json files found',
    })
    await expect(
      handlers.signOff({
        packKey: 'schooling-by-design',
        packVersion: '1',
        note: null,
        verdicts: [{ criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'usable', note: null }],
      }),
    ).resolves.toMatchObject({ state: 'unavailable' })
  })
})
