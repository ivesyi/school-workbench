import type { StageService } from '@school-workbench/application'
import { describe, expect, it, vi } from 'vitest'
import { createStageIpcHandlers } from './stage-ipc'

const suggested = {
  state: 'suggested' as const,
  stage: {
    id: 'stage-1',
    title: '建立共同推动改进的组织基础',
    summary: '我理解这个学校目前大致处于组织基础阶段。',
    focus: '这个阶段现在最需要看到中层开始独立承担关键任务。',
    targets: [
      { id: 't1', dimensionKey: 'leadership' as const, label: '领导与责任', text: '目标 1' },
      { id: 't2', dimensionKey: 'critical_tasks' as const, label: '关键工作', text: '目标 2' },
      {
        id: 't3',
        dimensionKey: 'structure_systems' as const,
        label: '协作机制',
        text: '目标 3',
      },
      { id: 't4', dimensionKey: 'culture' as const, label: '团队氛围', text: '目标 4' },
      { id: 't5', dimensionKey: 'capacity' as const, label: '推进能力', text: '目标 5' },
    ],
  },
}

describe('stage IPC handlers', () => {
  it('validates input and forwards stage operations', async () => {
    const service = {
      getWorkspace: vi.fn().mockResolvedValue(suggested),
      adjust: vi.fn().mockResolvedValue(suggested),
      confirm: vi.fn().mockResolvedValue({ ...suggested, state: 'active' }),
    } as unknown as StageService
    const handlers = createStageIpcHandlers(service)

    await expect(handlers.getWorkspace('school-1')).resolves.toEqual(suggested)
    await handlers.adjust({ schoolId: 'school-1', stageId: 'stage-1', feedback: '需要调整' })
    await handlers.confirm({ schoolId: 'school-1', stageId: 'stage-1' })

    expect(service.adjust).toHaveBeenCalledWith({
      schoolId: 'school-1',
      stageId: 'stage-1',
      feedback: '需要调整',
    })
    expect(service.confirm).toHaveBeenCalledWith({ schoolId: 'school-1', stageId: 'stage-1' })
  })
})
