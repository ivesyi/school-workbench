import type { JudgmentService } from '@school-workbench/application'
import { judgmentIpcChannels } from '@school-workbench/shared'
import { describe, expect, it, vi } from 'vitest'
import { createJudgmentIpcHandlers } from './judgment-ipc'

describe('judgment IPC handlers', () => {
  it('exposes no channel that creates a judgement', () => {
    // listPending is read-only: it rehydrates proposed rows, it does not write them.
    expect(Object.keys(judgmentIpcChannels).sort()).toEqual([
      'listAccepted',
      'listPending',
      'review',
    ])
    const handlers = createJudgmentIpcHandlers({} as unknown as JudgmentService)
    expect(Object.keys(handlers).sort()).toEqual(['listAccepted', 'listPending', 'review'])
  })

  it('validates a review before it reaches the service', async () => {
    const review = vi
      .fn()
      .mockResolvedValue({ decision: 'rejected' as const, acceptedJudgment: null })
    const service = { review, listAccepted: vi.fn() } as unknown as JudgmentService
    const handlers = createJudgmentIpcHandlers(service)

    await expect(
      handlers.review({ schoolId: 'school-1', diagnosisId: 'd-1', decision: 'modified' }),
    ).rejects.toThrow('请写下你确认后的判断')
    expect(review).not.toHaveBeenCalled()

    await expect(
      handlers.review({ schoolId: 'school-1', diagnosisId: 'd-1', decision: 'rejected' }),
    ).resolves.toEqual({ decision: 'rejected', acceptedJudgment: null })
  })
})
