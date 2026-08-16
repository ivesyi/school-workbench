import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { methodologyPackSchema, type MethodologyPack } from './contracts'
import { deepFreeze } from './immutable'
import { MethodologyRegistry } from './registry'
import { loadSourceFingerprintManifest, type SourceFingerprintManifest } from './source-manifest'
import { validateMethodologyPackHash, validateMethodologyPackStructure } from './validation'

export function validateMethodologyPack(
  pack: MethodologyPack,
  sourceManifest: SourceFingerprintManifest,
): void {
  validateMethodologyPackStructure(pack)
  validateMethodologyPackHash(pack)

  const manifestFingerprint = sourceManifest.get(pack.sourceRef)
  if (!manifestFingerprint) throw new Error(`Source manifest has no entry for ${pack.sourceRef}`)
  if (manifestFingerprint !== pack.sourceFingerprint.value) {
    throw new Error(`Source fingerprint mismatch for ${pack.sourceRef}`)
  }
}

export function parseMethodologyPack(
  content: string,
  sourceManifest: SourceFingerprintManifest,
): MethodologyPack {
  const parsed = methodologyPackSchema.parse(JSON.parse(content) as unknown)
  const frozen = deepFreeze(parsed)
  validateMethodologyPack(frozen, sourceManifest)
  return frozen
}

export function loadMethodologyRegistry(
  methodologyRoot: string,
  sourceManifestPath: string,
): MethodologyRegistry {
  const sourceManifest = loadSourceFingerprintManifest(sourceManifestPath)
  const packs = readdirSync(methodologyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(methodologyRoot, entry.name, 'pack.json'))
    .filter((path) => existsSync(path))
    .map((path) => parseMethodologyPack(readFileSync(path, 'utf8'), sourceManifest))

  if (packs.length === 0) throw new Error('No methodology pack.json files found')
  return new MethodologyRegistry(packs)
}
