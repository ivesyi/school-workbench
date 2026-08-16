import { createSchoolInputSchema, type CreateSchoolInput } from '@school-workbench/shared'
import { ulid } from 'ulid'

export type School = {
  id: string
  name: string
  createdAt: string
  archivedAt: string | null
}

export type SchoolFactoryDependencies = {
  createId(): string
  now(): Date
}

const defaultDependencies: SchoolFactoryDependencies = {
  createId: ulid,
  now: () => new Date(),
}

export function createSchool(
  input: CreateSchoolInput,
  dependencies: SchoolFactoryDependencies = defaultDependencies,
): School {
  const parsed = createSchoolInputSchema.parse(input)

  return {
    id: dependencies.createId(),
    name: parsed.name,
    createdAt: dependencies.now().toISOString(),
    archivedAt: null,
  }
}

export interface SchoolRepository {
  save(school: School): Promise<void>
  findById(id: string): Promise<School | null>
  listActive(): Promise<School[]>
}
