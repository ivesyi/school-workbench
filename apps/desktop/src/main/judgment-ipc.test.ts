import type { JudgmentService } from '@school-workbench/application'
import { describe, expect, it, vi } from 'vitest'
import { createJudgmentIpcHandlers } from './judgment-ipc'

const reviewView = {
  evidence: [{ id: 'e-1', title: '顾问输入', sourceType: 'pasted_text' }],
  facts: [{ id: 'f-1', text: '新的情况', directness: 'medium' as const }],
  claims: [{ id: 'c-1', text: '当前有迹象表明：新的情况' }],
  proposal: {
    id: 'd-1',
    title: '一个新的情况',
    interpretations: [],
    provisionalJudgment: '新的情况',
    alternativeHypotheses: [],
    unresolvedQuestions: [],
    proposedActions: [],
    recommendedObservations: [],
    impactMeasures: [],
    evidenceQuality: { directness: 'medium' as const, triangulated: false },
    confidence: 'low' as const,
    evidenceCount: 1,
    status: 'proposed' as const,
    createdAt: '2026-08-17T00:00:00.000Z',
  },
}

describe('judgment IPC handlers', () => {
  it('validates input and returns a structured review view', async () => {
    const submitSituation = vi.fn().mockResolvedValue(reviewView)
    const service = {
      submitSituation,
      review: vi.fn(),
      listAccepted: vi.fn(),
    } as unknown as JudgmentService
    const handlers = createJudgmentIpcHandlers(service)

    await expect(handlers.submitSituation({ schoolId: 'school-1', text: '  ' })).rejects.toThrow(
      '请先说说发生了什么',
    )
    expect(submitSituation).not.toHaveBeenCalled()

    await expect(
      handlers.submitSituation({ schoolId: 'school-1', text: '新的情况' }),
    ).resolves.toEqual(reviewView)
  })
})
