import {
  activatePackFileText,
  loadMethodologyRegistry,
  loadSourceFingerprintManifest,
  parseMethodologyPack,
  planMethodologyPackActivation,
  type MethodologyActivationPlan,
  type MethodologyPack,
} from '@school-workbench/methodology'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openWorkbenchDatabase } from './database'
import { SqliteMethodologyRepository } from './sqlite-methodology-repository'
import { SqliteMethodologyReviewRepository } from './sqlite-methodology-review-repository'

export type ActivateMethodologyPackRequest = Readonly<{
  packKey: string
  packVersion: string
  methodologyRoot: string
  sourceManifestPath: string
  databasePath: string
  migrationsFolder: string
  apply: boolean
}>

export type ActivateMethodologyPackResult = Readonly<{
  plan: MethodologyActivationPlan
  applied: boolean
  packFilePath: string | null
}>

function packFilePathFor(methodologyRoot: string, pack: MethodologyPack): string {
  const candidates = readdirSync(methodologyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(methodologyRoot, entry.name, 'pack.json'))
    .filter((path) => existsSync(path))
    .filter((path) => {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { key?: string; version?: string }
      return parsed.key === pack.key && parsed.version === pack.version
    })
  const [only] = candidates
  if (!only || candidates.length !== 1) {
    throw new Error(
      `Expected exactly one pack.json for ${pack.key}@${pack.version}, found ${candidates.length}`,
    )
  }
  return only
}

/**
 * Repository-side activation. It never decides anything on its own: the file
 * pack, the persisted projection and the recorded consultant sign-off must all
 * agree before the reviewed status line is rewritten.
 */
export async function activateMethodologyPack(
  request: ActivateMethodologyPackRequest,
): Promise<ActivateMethodologyPackResult> {
  const registry = loadMethodologyRegistry(request.methodologyRoot, request.sourceManifestPath)
  const pack = registry.getPack(request.packKey, request.packVersion)
  if (!pack) {
    throw new Error(
      `No methodology pack ${request.packKey}@${request.packVersion} under ${request.methodologyRoot}`,
    )
  }

  const database = openWorkbenchDatabase(request.databasePath, request.migrationsFolder)
  try {
    const methodologyRepository = new SqliteMethodologyRepository(database.db)
    const reviewRepository = new SqliteMethodologyReviewRepository(database.db)
    const persisted = await methodologyRepository.getPack(pack.key, pack.version)
    const signOff = await reviewRepository.getLatestSignOff(pack.key, pack.version)
    const plan = planMethodologyPackActivation({
      pack,
      persistedStatus: persisted?.status ?? null,
      signOff,
    })

    if (!plan.ok) return Object.freeze({ plan, applied: false, packFilePath: null })

    const packFilePath = packFilePathFor(request.methodologyRoot, pack)
    if (!request.apply) return Object.freeze({ plan, applied: false, packFilePath })

    const original = readFileSync(packFilePath, 'utf8')
    const activated = activatePackFileText(original)
    // Re-validate the rewritten document before it reaches the working tree.
    const reparsed = parseMethodologyPack(
      activated,
      loadSourceFingerprintManifest(request.sourceManifestPath),
    )
    if (reparsed.status !== 'active') throw new Error('Rewritten pack.json is not active')
    if (reparsed.canonicalContentHash.value !== pack.canonicalContentHash.value) {
      throw new Error('Rewriting pack.json changed its canonical content hash')
    }
    writeFileSync(packFilePath, activated, 'utf8')

    return Object.freeze({ plan, applied: true, packFilePath })
  } finally {
    database.close()
  }
}
