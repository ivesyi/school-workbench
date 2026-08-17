import { resolve } from 'node:path'
import {
  computePackContentHash,
  loadMethodologyRegistry,
  MethodologyRegistry,
  type MethodologyPack,
  type MethodologyPackStatus,
} from '@school-workbench/methodology'

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')

function repositoryPacks(): readonly MethodologyPack[] {
  return loadMethodologyRegistry(methodologyRoot, sourceManifestPath).listPacks()
}

function withStatus(pack: MethodologyPack, status: MethodologyPackStatus): MethodologyPack {
  return { ...pack, status }
}

function activePacks(): readonly MethodologyPack[] {
  return repositoryPacks().map((pack) => withStatus(pack, 'active'))
}

function secondActiveSbdVersion(pack: MethodologyPack): MethodologyPack {
  const draft: MethodologyPack = {
    ...pack,
    id: 'schooling-by-design-v2-synthetic-test',
    version: '2',
    status: 'active',
    canonicalContentHash: { algorithm: 'sha256', value: '0'.repeat(64) },
  }
  return {
    ...draft,
    canonicalContentHash: {
      algorithm: 'sha256',
      value: computePackContentHash(draft),
    },
  }
}

export function registryForProfile(profile: string): MethodologyRegistry {
  if (profile === 'review') {
    // The shipped packs are ready for use, so this profile states the withdrawn
    // status explicitly instead of inheriting it from the repository fixture.
    return new MethodologyRegistry(
      repositoryPacks().map((pack) =>
        withStatus(pack, pack.key === 'schooling-by-design' ? 'review' : 'active'),
      ),
    )
  }

  if (profile === 'retired') {
    return new MethodologyRegistry(
      repositoryPacks().map((pack) =>
        withStatus(pack, pack.key === 'schooling-by-design' ? 'retired' : 'active'),
      ),
    )
  }

  if (profile === 'two_active_versions') {
    const packs = activePacks()
    const sbd = packs.find((pack) => pack.key === 'schooling-by-design')
    if (!sbd) throw new Error('Schooling by Design fixture is missing')
    return new MethodologyRegistry([...packs, secondActiveSbdVersion(sbd)])
  }

  if (profile === 'active') {
    return new MethodologyRegistry(activePacks())
  }

  throw new Error(`Unknown assessment test registry profile: ${profile}`)
}
