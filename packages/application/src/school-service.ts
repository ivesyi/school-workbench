import { createSchool, type School, type SchoolRepository } from '@school-workbench/domain'
import {
  createSchoolInputSchema,
  schoolIdSchema,
  type CreateSchoolInput,
  type SchoolView,
} from '@school-workbench/shared'

function toSchoolView(school: School): SchoolView {
  return {
    id: school.id,
    name: school.name,
    currentStageId: school.currentStageId,
    currentStageTitle: null,
    createdAt: school.createdAt,
  }
}

export class SchoolService {
  constructor(private readonly repository: SchoolRepository) {}

  async create(input: CreateSchoolInput): Promise<SchoolView> {
    const school = createSchool(createSchoolInputSchema.parse(input))
    await this.repository.save(school)
    return toSchoolView(school)
  }

  async list(): Promise<SchoolView[]> {
    const schools = await this.repository.listActive()
    return schools.map(toSchoolView)
  }

  async get(id: string): Promise<SchoolView | null> {
    const school = await this.repository.findById(schoolIdSchema.parse(id))
    return school ? toSchoolView(school) : null
  }
}
