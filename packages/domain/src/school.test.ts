import { describe, expect, it } from 'vitest'
import { createSchool } from './school'

const dependencies = {
  createId: () => '01K00000000000000000000000',
  now: () => new Date('2026-08-17T00:00:00.000Z'),
}

describe('createSchool', () => {
  it('creates a school from the only required business field', () => {
    const school = createSchool({ name: '  南山实验学校  ' }, dependencies)

    expect(school).toEqual({
      id: '01K00000000000000000000000',
      name: '南山实验学校',
      currentStageId: null,
      baselineSnapshotId: null,
      currentSnapshotId: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      archivedAt: null,
    })
  })

  it('rejects an empty school name', () => {
    expect(() => createSchool({ name: '   ' }, dependencies)).toThrow('请输入学校名称')
  })
})
