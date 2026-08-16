import type { StateService } from '@school-workbench/application'
import { describe, expect, it, vi } from 'vitest'
import { createStateIpcHandlers } from './state-ipc'

const draft = {
  state: 'draft' as const,
  overview: {
    stage: {
      id: 'stage-1',
      title: '建立共同推动改进的组织基础',
      focus: '当前最需要看到组织基础逐步稳定。',
    },
    summary: '目前有四个方面可以形成初步判断，一个方面还需要更多观察。',
    limitations: ['文化方面还需要更多观察。'],
    dimensions: [
      {
        dimensionKey: 'leadership' as const,
        label: '领导力',
        target: '领导目标',
        status: 'far_below' as const,
        statusLabel: '明显低于阶段目标',
        summary: '领导力说明',
        basis: ['中层仍依赖校长。'],
      },
      {
        dimensionKey: 'key_tasks' as const,
        label: '关键任务',
        target: '关键任务目标',
        status: 'partial' as const,
        statusLabel: '部分达到阶段目标',
        summary: '关键任务说明',
        basis: ['关键任务开始拆解。'],
      },
      {
        dimensionKey: 'structure' as const,
        label: '结构与机制',
        target: '机制目标',
        status: 'mostly' as const,
        statusLabel: '基本达到阶段目标',
        summary: '机制说明',
        basis: ['教研复盘逐步稳定。'],
      },
      {
        dimensionKey: 'culture' as const,
        label: '文化',
        target: '文化目标',
        status: 'unverified' as const,
        statusLabel: '还需要更多观察',
        summary: '文化说明',
        basis: [],
      },
      {
        dimensionKey: 'capability' as const,
        label: '能力',
        target: '能力目标',
        status: 'partial' as const,
        statusLabel: '部分达到阶段目标',
        summary: '能力说明',
        basis: ['教师开始复盘。'],
      },
    ],
  },
}

describe('state IPC handlers', () => {
  it('validates input and forwards state operations', async () => {
    const service = {
      getWorkspace: vi.fn().mockResolvedValue(draft),
      adjust: vi.fn().mockResolvedValue(draft),
      confirm: vi.fn().mockResolvedValue({ ...draft, state: 'baseline' }),
    } as unknown as StateService
    const handlers = createStateIpcHandlers(service)

    await expect(handlers.getWorkspace('school-1')).resolves.toEqual(draft)
    await handlers.adjust({ schoolId: 'school-1', feedback: '领导力还需要更多观察' })
    await handlers.confirm({ schoolId: 'school-1' })

    expect(service.adjust).toHaveBeenCalledWith({
      schoolId: 'school-1',
      feedback: '领导力还需要更多观察',
    })
    expect(service.confirm).toHaveBeenCalledWith({ schoolId: 'school-1' })
  })
})
