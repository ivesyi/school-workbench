import { SqliteReadPlaneRepository, type WorkbenchDatabase } from '@school-workbench/db'
import {
  MethodologyRegistry,
  type CriterionFilter,
  type MethodologyPack,
  type MethodologyPackProjection,
  type MethodologyRepository,
  type ResolvedCriterion,
} from '@school-workbench/methodology'
import {
  createWorkbenchReadPlaneBootstrap,
  ReadPlaneError,
  WorkbenchReadCapabilityService,
  type SafeReadPlaneLogger,
  type WorkbenchLoopbackReadPlane,
} from '@school-workbench/workbench-read-plane'
import type { MethodologyRuntime } from './methodology-runtime'

function methodologyUnavailable(): never {
  // Fail closed, and only for `standards_get`. SPEC 73/74 do not allow a
  // judgement to be grounded in methodology content the workbench cannot
  // currently verify, so returning an empty projection would be worse than
  // returning an error.
  throw new ReadPlaneError(
    'STANDARDS_DRIFT',
    'Methodology content is not available in this session',
  )
}

/**
 * A `MethodologyRegistry` that is wired into the read plane immediately and
 * gains its content later.
 *
 * Methodology loading is deliberately off the startup path and is allowed to
 * fail (see `index.ts`). The loopback read plane must not inherit that: six of
 * the seven read capabilities do not touch methodology at all, and an agent
 * that cannot ask about school state because a pack file was unreadable would
 * be a much larger outage than the one that actually happened.
 */
class DeferredMethodologyRegistry extends MethodologyRegistry {
  #delegate: MethodologyRegistry | null = null

  constructor() {
    super([])
  }

  adopt(delegate: MethodologyRegistry): void {
    this.#delegate = delegate
  }

  get isAvailable(): boolean {
    return this.#delegate !== null
  }

  #require(): MethodologyRegistry {
    return this.#delegate ?? methodologyUnavailable()
  }

  override listPacks(): readonly MethodologyPack[] {
    return this.#require().listPacks()
  }

  override getPack(key: string, version: string): MethodologyPack | null {
    return this.#require().getPack(key, version)
  }

  override getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ): ResolvedCriterion | null {
    return selector === undefined
      ? this.#require().getCriterion(stableId)
      : this.#require().getCriterion(stableId, selector)
  }

  override findCriteria(filter?: CriterionFilter): readonly ResolvedCriterion[] {
    return filter === undefined
      ? this.#require().findCriteria()
      : this.#require().findCriteria(filter)
  }
}

class DeferredMethodologyRepository implements MethodologyRepository {
  #delegate: MethodologyRepository | null = null

  adopt(delegate: MethodologyRepository): void {
    this.#delegate = delegate
  }

  #require(): MethodologyRepository {
    return this.#delegate ?? methodologyUnavailable()
  }

  async listPacks(): Promise<readonly MethodologyPackProjection[]> {
    return this.#require().listPacks()
  }

  async getPack(key: string, version: string): Promise<MethodologyPackProjection | null> {
    return this.#require().getPack(key, version)
  }

  async getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ): Promise<MethodologyPackProjection['criteria'][number] | null> {
    return selector === undefined
      ? this.#require().getCriterion(stableId)
      : this.#require().getCriterion(stableId, selector)
  }

  async findCriteria(
    filter?: CriterionFilter,
  ): Promise<readonly MethodologyPackProjection['criteria'][number][]> {
    return filter === undefined
      ? this.#require().findCriteria()
      : this.#require().findCriteria(filter)
  }
}

export type ReadPlaneRuntime = Readonly<{
  plane: WorkbenchLoopbackReadPlane
  endpoint: string
  /** True once methodology content has been adopted, so `standards_get` works. */
  isMethodologyAvailable(): boolean
  stop(): Promise<void>
}>

export type ReadPlaneRuntimeInput = Readonly<{
  database: WorkbenchDatabase
  /**
   * Resolved methodology runtime. It is *not* awaited before the plane starts;
   * the seam adopts its content whenever it arrives, and never rejects.
   */
  methodology: Promise<MethodologyRuntime>
  safeLog?: SafeReadPlaneLogger
}>

/**
 * Starts the loopback read plane (SPEC 16) in the Electron main process.
 *
 * The plane binds 127.0.0.1 on a random port and issues short-lived capability
 * tokens per Agent Run; both invariants live in
 * `packages/workbench-read-plane` and are not relaxed here.
 */
export async function startWorkbenchReadPlane(
  input: ReadPlaneRuntimeInput,
): Promise<ReadPlaneRuntime> {
  const registry = new DeferredMethodologyRegistry()
  const repository = new DeferredMethodologyRepository()
  const service = new WorkbenchReadCapabilityService(
    new SqliteReadPlaneRepository(input.database),
    registry,
    repository,
  )

  void input.methodology.then((runtime) => {
    if (runtime.state !== 'ready') return
    registry.adopt(runtime.registry)
    repository.adopt(runtime.repository)
  })

  const plane = createWorkbenchReadPlaneBootstrap(service, {
    ...(input.safeLog ? { safeLog: input.safeLog } : {}),
  })
  const endpoint = await plane.start()

  return Object.freeze({
    plane,
    endpoint,
    isMethodologyAvailable: () => registry.isAvailable,
    stop: () => plane.stop(),
  })
}
