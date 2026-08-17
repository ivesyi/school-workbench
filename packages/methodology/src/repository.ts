import type { MethodologyPackProjection, MethodologyPackStatus } from './contracts'
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

/**
 * The narrow write capability the review surface needs: a consultant conclusion
 * moves the persisted lifecycle status and nothing else. It stays separate from
 * `MethodologyRepository` so read-only consumers keep a read-only dependency.
 */
export interface MethodologyPackStatusWriter {
  setPackStatus(key: string, version: string, status: MethodologyPackStatus): Promise<void>
}
