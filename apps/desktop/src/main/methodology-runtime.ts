import { MethodologyReviewService } from '@school-workbench/application'
import {
  SqliteMethodologyRepository,
  SqliteMethodologyReviewRepository,
  type WorkbenchDatabase,
} from '@school-workbench/db'
import {
  loadMethodologyRegistry,
  type MethodologyRegistry,
  type MethodologyRepository,
} from '@school-workbench/methodology'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type MethodologyPaths = Readonly<{
  methodologyRoot: string
  sourceManifestPath: string
  origin: 'environment' | 'bundled' | 'repository'
}>

/**
 * A ready runtime exposes the registry and repository alongside the review
 * service, because the read plane's `standards_get` needs exactly the same two
 * collaborators. They are surfaced here rather than rebuilt at the call site:
 * a second `SqliteMethodologyRepository` would mean a second `syncRegistry`.
 */
export type MethodologyRuntime =
  | Readonly<{
      state: 'ready'
      service: MethodologyReviewService
      registry: MethodologyRegistry
      repository: MethodologyRepository
    }>
  | Readonly<{ state: 'unavailable'; detail: string }>

/**
 * The methodology registry and its source manifest are read-only build inputs.
 * `electron-vite` copies them next to the main bundle, so the packaged app reads
 * them from its own output directory and a development run falls back to the
 * repository checkout. Both may be overridden for tests.
 */
export function resolveMethodologyPaths(
  currentDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): MethodologyPaths {
  const overriddenRoot = environment.SWB_METHODOLOGY_ROOT
  const overriddenManifest = environment.SWB_SOURCE_MANIFEST
  if (overriddenRoot || overriddenManifest) {
    return {
      methodologyRoot: resolve(
        overriddenRoot ?? join(currentDirectory, 'knowledge', 'methodology'),
      ),
      sourceManifestPath: resolve(
        overriddenManifest ?? join(currentDirectory, 'references', 'SOURCE_MANIFEST.md'),
      ),
      origin: 'environment',
    }
  }

  const bundledRoot = join(currentDirectory, 'knowledge', 'methodology')
  const bundledManifest = join(currentDirectory, 'references', 'SOURCE_MANIFEST.md')
  if (exists(bundledRoot) && exists(bundledManifest)) {
    return { methodologyRoot: bundledRoot, sourceManifestPath: bundledManifest, origin: 'bundled' }
  }

  const repositoryRoot = resolve(currentDirectory, '..', '..', '..', '..')
  return {
    methodologyRoot: join(repositoryRoot, 'knowledge', 'methodology'),
    sourceManifestPath: join(repositoryRoot, 'references', 'SOURCE_MANIFEST.md'),
    origin: 'repository',
  }
}

/**
 * Loads the file registry and syncs it into SQLite exactly once per launch.
 * Every failure degrades quietly: the workbench keeps working and the review
 * surface reports that methodology content is unavailable.
 */
export async function createMethodologyRuntime(
  input: Readonly<{
    database: WorkbenchDatabase
    paths: MethodologyPaths
    onError?: (message: string) => void
  }>,
): Promise<MethodologyRuntime> {
  try {
    const registry = loadMethodologyRegistry(
      input.paths.methodologyRoot,
      input.paths.sourceManifestPath,
    )
    const methodologyRepository = new SqliteMethodologyRepository(input.database.db)
    const reviewRepository = new SqliteMethodologyReviewRepository(input.database.db)
    await methodologyRepository.syncRegistry(registry)

    return {
      state: 'ready',
      service: new MethodologyReviewService(registry, methodologyRepository, reviewRepository),
      registry,
      repository: methodologyRepository,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    input.onError?.(`methodology runtime unavailable: ${detail}`)
    return { state: 'unavailable', detail }
  }
}
