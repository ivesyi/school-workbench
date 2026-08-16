import {
  createSchool,
  type School,
  type SchoolRepository,
  type StageRepository,
} from '@school-workbench/domain'
import {
  createSchoolInputSchema,
  schoolIdSchema,
  type CreateSchoolInput,
  type SchoolView,
} from '@school-workbench/shared'

export class SchoolService {
  constructor(
    private readonly repository: SchoolRepository,
    private readonly stageReader?: Pick<StageRepository, 'findActive'>,
  ) {}

  private async toSchoolView(school: School): Promise<SchoolView> {
    const activeStage = this.stageReader ? await this.stageReader.findActive(school.id) : null
    return {
      id: school.id,
      name: school.name,
      currentStageId: activeStage?.stage.id ?? null,
      currentStageTitle: activeStage?.stage.title ?? null,
      createdAt: school.createdAt,
    }
  }

  async create(input: CreateSchoolInput): Promise<SchoolView> {
    const school = createSchool(createSchoolInputSchema.parse(input))
    await this.repository.save(school)
    return this.toSchoolView(school)
  }

  async list(): Promise<SchoolView[]> {
    const schools = await this.repository.listActive()
    return Promise.all(schools.map((school) => this.toSchoolView(school)))
  }

  async get(id: string): Promise<SchoolView | null> {
    const school = await this.repository.findById(schoolIdSchema.parse(id))
    return school ? this.toSchoolView(school) : null
  }
}
