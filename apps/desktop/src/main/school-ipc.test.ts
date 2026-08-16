import type { SchoolService } from '@school-workbench/application'
import { describe, expect, it, vi } from 'vitest'
import { createSchoolIpcHandlers } from './school-ipc'

const school = {
  id: '01K00000000000000000000000',
  name: '南山实验学校',
  currentStageId: null,
  currentStageTitle: null,
  createdAt: '2026-08-17T00:00:00.000Z',
}

describe('school IPC handlers', () => {
  it('validates input before invoking the application service', async () => {
    const create = vi.fn().mockResolvedValue(school)
    const service = { create, list: vi.fn(), get: vi.fn() } as unknown as SchoolService
    const handlers = createSchoolIpcHandlers(service)

    await expect(handlers.create({ name: '  ' })).rejects.toThrow('请输入学校名称')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns a validated school view', async () => {
    const service = {
      create: vi.fn().mockResolvedValue(school),
      list: vi.fn().mockResolvedValue([school]),
      get: vi.fn().mockResolvedValue(school),
    } as unknown as SchoolService
    const handlers = createSchoolIpcHandlers(service)

    await expect(handlers.list()).resolves.toEqual([school])
    await expect(handlers.get(school.id)).resolves.toEqual(school)
  })
})
