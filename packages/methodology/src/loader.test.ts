import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeCanonicalContentHash } from './hash'
import { loadMethodologyRegistry, parseMethodologyPack } from './loader'

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const sbdPackPath = resolve('knowledge/methodology/schooling-by-design-v1/pack.json')

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneSbd(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(sbdPackPath, 'utf8')) as unknown
  if (!isRecord(parsed)) throw new Error('fixture must be an object')
  return parsed
}

function rehash(pack: Record<string, unknown>): string {
  const content = { ...pack }
  delete content.canonicalContentHash
  const value = computeCanonicalContentHash(content)
  pack.canonicalContentHash = { algorithm: 'sha256', value }
  return JSON.stringify(pack)
}

function sourceManifestFor(pack: Record<string, unknown>): ReadonlyMap<string, string> {
  const sourceRef = pack.sourceRef
  const fingerprint = pack.sourceFingerprint
  if (
    typeof sourceRef !== 'string' ||
    !isRecord(fingerprint) ||
    typeof fingerprint.value !== 'string'
  ) {
    throw new Error('fixture source metadata is invalid')
  }
  return new Map([[sourceRef, fingerprint.value]])
}

describe('methodology pack loader and registry', () => {
  it('loads the two shipped baselines, ready for use, with complete traceability', () => {
    const registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
    const packs = registry.listPacks()

    expect(packs).toHaveLength(2)
    expect(packs.flatMap((pack) => pack.constructs)).toHaveLength(15)
    expect(packs.flatMap((pack) => pack.criteria)).toHaveLength(10)
    expect(
      Object.fromEntries(
        packs.flatMap((pack) =>
          pack.criteria.map((criterion) => [criterion.id, criterion.dimensionKey]),
        ),
      ),
    ).toEqual({
      'SBD.C1.RESULT_CLARITY': 'leadership',
      'SBD.C2.EVIDENCE_BEFORE_ACTION': 'key_tasks',
      'SBD.C3.GAP_GROUNDED': 'capability',
      'SBD.C4.SYSTEM_ALIGNMENT': 'structure',
      'SBD.C5.FEEDBACK_ADJUSTMENT': 'culture',
      'DW.C1.LEARNING_PROBLEM_QUALITY': 'key_tasks',
      'DW.C2.PRACTICE_VISIBILITY': 'structure',
      'DW.C3.PROBLEM_OF_PRACTICE_QUALITY': 'culture',
      'DW.C4.INFERENCE_DISCIPLINE': 'capability',
      'DW.C5.ACTION_IMPACT_COHERENCE': 'leadership',
    })
    expect(packs.every((pack) => pack.status === 'active')).toBe(true)
    expect(
      packs.every(
        (pack) =>
          pack.sourceFingerprint.value.length === 64 &&
          pack.canonicalContentHash.value.length === 64,
      ),
    ).toBe(true)
    expect(
      packs
        .flatMap((pack) => pack.criteria)
        .every((criterion) => criterion.sourceLocator.label.length > 0),
    ).toBe(true)
    expect(packs.flatMap((pack) => pack.behaviorAnchors)).toEqual([])
  })

  it('keeps canonical content hash stable when only lifecycle status changes', () => {
    const shipped = cloneSbd()
    const contentHash = computeCanonicalContentHash(shipped)
    const withdrawn: Record<string, unknown> = { ...shipped, status: 'review' }

    expect(computeCanonicalContentHash(withdrawn)).toBe(contentHash)
    withdrawn.canonicalContentHash = { algorithm: 'sha256', value: contentHash }
    expect(parseMethodologyPack(JSON.stringify(withdrawn), sourceManifestFor(shipped)).status).toBe(
      'review',
    )
  })

  it('queries by pack, stable criterion, construct, dimension and practice type without exposing mutable values', () => {
    const registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
    const sbd = registry.getPack('schooling-by-design', '1')
    const criterion = registry.getCriterion('SBD.C4.SYSTEM_ALIGNMENT')

    expect(sbd?.id).toBe('schooling-by-design-v1')
    expect(criterion?.criterion.constructId).toBe('SBD.ALIGNED_ACTION')
    expect(registry.findCriteria({ constructId: 'DW.PRACTICE_EVIDENCE' })).toHaveLength(1)
    expect(registry.findCriteria({ practiceType: 'school_design' })).toHaveLength(5)
    expect(registry.findCriteria({ practiceType: 'adult_practice' })).toHaveLength(5)
    expect(registry.findCriteria({ dimensionKey: 'leadership' })).toHaveLength(2)
    expect(Object.isFrozen(sbd)).toBe(true)
    expect(Object.isFrozen(sbd?.criteria)).toBe(true)

    const mutableView = sbd as unknown as { title: string }
    expect(() => {
      mutableView.title = 'tampered'
    }).toThrow(TypeError)
    expect(registry.getPack('schooling-by-design', '1')?.title).toBe(
      'Schooling by Design Methodology Pack v1',
    )
  })

  it('fails closed on unsupported schema versions, unknown fields, illegal dimensions and missing locators', () => {
    const base = cloneSbd()
    const manifest = sourceManifestFor(base)

    const unsupported = { ...base, schemaVersion: 2 }
    expect(() => parseMethodologyPack(JSON.stringify(unsupported), manifest)).toThrow()

    const unknown = { ...base, unexpected: true }
    expect(() => parseMethodologyPack(JSON.stringify(unknown), manifest)).toThrow()

    const illegalDimension = cloneSbd()
    const criteria = illegalDimension.criteria
    if (!Array.isArray(criteria) || !isRecord(criteria[0]))
      throw new Error('fixture criteria missing')
    criteria[0].dimensionKey = 'mystery'
    expect(() => parseMethodologyPack(JSON.stringify(illegalDimension), manifest)).toThrow()

    const missingLocator = cloneSbd()
    const missingLocatorCriteria = missingLocator.criteria
    if (!Array.isArray(missingLocatorCriteria) || !isRecord(missingLocatorCriteria[0])) {
      throw new Error('fixture criteria missing')
    }
    delete missingLocatorCriteria[0].sourceLocator
    expect(() => parseMethodologyPack(JSON.stringify(missingLocator), manifest)).toThrow()
  })

  it('fails closed on duplicate stable ids, dangling construct/parent and hash/fingerprint mismatch', () => {
    const duplicate = cloneSbd()
    const duplicateCriteria = duplicate.criteria
    if (
      !Array.isArray(duplicateCriteria) ||
      !isRecord(duplicateCriteria[0]) ||
      !isRecord(duplicateCriteria[1])
    ) {
      throw new Error('fixture criteria missing')
    }
    duplicateCriteria[1].id = duplicateCriteria[0].id
    expect(() => parseMethodologyPack(rehash(duplicate), sourceManifestFor(duplicate))).toThrow(
      /Duplicate criterion stable id/,
    )

    const danglingConstruct = cloneSbd()
    const danglingCriteria = danglingConstruct.criteria
    if (!Array.isArray(danglingCriteria) || !isRecord(danglingCriteria[0])) {
      throw new Error('fixture criteria missing')
    }
    danglingCriteria[0].constructId = 'SBD.MISSING'
    expect(() =>
      parseMethodologyPack(rehash(danglingConstruct), sourceManifestFor(danglingConstruct)),
    ).toThrow(/unknown construct/)

    const danglingParent = cloneSbd()
    const parentCriteria = danglingParent.criteria
    if (!Array.isArray(parentCriteria) || !isRecord(parentCriteria[1])) {
      throw new Error('fixture criteria missing')
    }
    parentCriteria[1].parentId = 'SBD.C0.MISSING'
    expect(() =>
      parseMethodologyPack(rehash(danglingParent), sourceManifestFor(danglingParent)),
    ).toThrow(/unknown parent/)

    const badHash = cloneSbd()
    badHash.canonicalContentHash = { algorithm: 'sha256', value: '0'.repeat(64) }
    expect(() => parseMethodologyPack(JSON.stringify(badHash), sourceManifestFor(badHash))).toThrow(
      /Canonical content hash mismatch/,
    )

    const badFingerprint = cloneSbd()
    const fingerprint = badFingerprint.sourceFingerprint
    if (!isRecord(fingerprint)) throw new Error('fixture fingerprint missing')
    fingerprint.value = '0'.repeat(64)
    expect(() =>
      parseMethodologyPack(rehash(badFingerprint), sourceManifestFor(cloneSbd())),
    ).toThrow(/Source fingerprint mismatch/)
  })
})
