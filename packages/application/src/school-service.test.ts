import type {
  School,
  SchoolRepository,
  StageRecommendation,
  StageRepository,
} from '@school-workbench/domain'
import { describe, expect, it, vi } from 'vitest'
import { SchoolService } from './school-service'

const school: School = {
  id: 'school-1',
  name: '南山实验学校',
  createdAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
}

const activeStage: StageRecommendation = {
  stage: {
    id: 'stage-1',
    schoolId: school.id,
    title: '让改进进入教师实践',
    summary: '阶段摘要',
    focus: '阶段重点',
    sequence: 1,
    status: 'active',
    startsAt: '2026-08-17T01:00:00.000Z',
    endsAt: null,
    adjustmentFeedback: null,
    createdAt: '2026-08-17T00:30:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  },
  targets: [],
  judgmentIds: ['judgment-1'],
}

function schoolRepository(): SchoolRepository {
  return {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(school),
    listActive: vi.fn().mockResolvedValue([school]),
    archive: vi.fn().mockResolvedValue(true),
  }
}

describe('SchoolService read model', () => {
  it('derives the current stage from the active stage instead of a school pointer', async () => {
    const stageReader: Pick<StageRepository, 'findActive'> = {
      findActive: vi.fn().mockResolvedValue(activeStage),
    }
    const service = new SchoolService(schoolRepository(), stageReader)

    await expect(service.list()).resolves.toEqual([
      {
        id: school.id,
        name: school.name,
        currentStageId: 'stage-1',
        currentStageTitle: '让改进进入教师实践',
        createdAt: school.createdAt,
      },
    ])
    await expect(service.get(school.id)).resolves.toMatchObject({
      currentStageId: 'stage-1',
      currentStageTitle: '让改进进入教师实践',
    })
  })
})

describe('SchoolService archive', () => {
  it('marks an active school as archived without deleting it', async () => {
    const repository = schoolRepository()
    const service = new SchoolService(repository)

    await service.archive(school.id)

    expect(repository.archive).toHaveBeenCalledWith(
      school.id,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    )
  })

  it('does not report success when the school is already archived or missing', async () => {
    const repository = schoolRepository()
    vi.mocked(repository.archive).mockResolvedValue(false)
    const service = new SchoolService(repository)

    await expect(service.archive(school.id)).rejects.toThrow('已归档或不存在')
  })
})
