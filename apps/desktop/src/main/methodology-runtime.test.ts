import { openWorkbenchDatabase, type WorkbenchDatabase } from '@school-workbench/db'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMethodologyRuntime, resolveMethodologyPaths } from './methodology-runtime'

const migrationsFolder = resolve('packages/db/drizzle')
const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

describe('methodology runtime paths', () => {
  it('prefers the copy next to the main bundle and falls back to the repository checkout', () => {
    const bundleDirectory = '/app/out/main'

    expect(resolveMethodologyPaths(bundleDirectory, {}, () => true)).toEqual({
      methodologyRoot: join(bundleDirectory, 'knowledge', 'methodology'),
      sourceManifestPath: join(bundleDirectory, 'references', 'SOURCE_MANIFEST.md'),
      origin: 'bundled',
    })
    expect(resolveMethodologyPaths('/repo/apps/desktop/out/main', {}, () => false)).toEqual({
      methodologyRoot: '/repo/knowledge/methodology',
      sourceManifestPath: '/repo/references/SOURCE_MANIFEST.md',
      origin: 'repository',
    })
  })

  it('honours explicit overrides so a launch can be pointed at other content', () => {
    expect(
      resolveMethodologyPaths(
        '/app/out/main',
        { SWB_METHODOLOGY_ROOT: '/tmp/packs', SWB_SOURCE_MANIFEST: '/tmp/manifest.md' },
        () => true,
      ),
    ).toEqual({
      methodologyRoot: '/tmp/packs',
      sourceManifestPath: '/tmp/manifest.md',
      origin: 'environment',
    })
  })
})

describe('methodology runtime bootstrap', () => {
  let database: WorkbenchDatabase

  beforeEach(() => {
    database = openWorkbenchDatabase(':memory:', migrationsFolder)
  })

  afterEach(() => database.close())

  it('loads the registry once and projects it into the local database', async () => {
    const runtime = await createMethodologyRuntime({
      database,
      paths: { methodologyRoot, sourceManifestPath, origin: 'repository' },
    })
    if (runtime.state !== 'ready') throw new Error('expected a ready methodology runtime')

    const packs = database.client
      .prepare('SELECT key, status FROM methodology_packs ORDER BY key')
      .all() as Array<{ key: string; status: string }>
    expect(packs).toEqual([
      { key: 'data-wise', status: 'review' },
      { key: 'schooling-by-design', status: 'review' },
    ])

    const view = await runtime.service.getWorkbench()
    expect(view.state).toBe('ready')
  })

  it('degrades quietly when the methodology content cannot be read', async () => {
    const errors: string[] = []
    const runtime = await createMethodologyRuntime({
      database,
      paths: {
        methodologyRoot: resolve('knowledge/does-not-exist'),
        sourceManifestPath,
        origin: 'repository',
      },
      onError: (message) => errors.push(message),
    })

    expect(runtime.state).toBe('unavailable')
    expect(errors).toHaveLength(1)
    expect(
      database.client.prepare('SELECT count(*) AS count FROM methodology_packs').get(),
    ).toEqual({ count: 0 })
  })

  it('degrades quietly when the source manifest cannot be verified', async () => {
    const runtime = await createMethodologyRuntime({
      database,
      paths: {
        methodologyRoot,
        sourceManifestPath: resolve('references/MISSING_MANIFEST.md'),
        origin: 'repository',
      },
    })

    expect(runtime.state).toBe('unavailable')
    expect(runtime.state === 'unavailable' && runtime.detail.length > 0).toBe(true)
  })
})
