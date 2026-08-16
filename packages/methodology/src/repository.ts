import type { MethodologyPackProjection } from './contracts'
import type { CriterionFilter } from './registry'

export interface MethodologyRepository {
  listPacks(): Promise<readonly MethodologyPackProjection[]>
  getPack(key: string, version: string): Promise<MethodologyPackProjection | null>
  getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ): Promise<MethodologyPackProjection['criteria'][number] | null>
  findCriteria(
    filter?: CriterionFilter,
  ): Promise<readonly MethodologyPackProjection['criteria'][number][]>
}
