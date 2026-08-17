import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activatePackFileText, planMethodologyPackActivation } from './activation'
import { methodologyPackSchema, type MethodologyPack } from './contracts'
import { computeCanonicalContentHash } from './hash'
import { loadMethodologyRegistry } from './loader'
import { derivePackReviewDecision, packReviewSignOffSchema, type PackReviewSignOff } from './review'

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const sbdPackPath = resolve('knowledge/methodology/schooling-by-design-v1/pack.json')

function sbdPack(): MethodologyPack {
  const registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  const pack = registry.getPack('schooling-by-design', '1')
  if (!pack) throw new Error('missing SBD pack')
  return pack
}

function packWith(overrides: Record<string, unknown>, rehash = false): MethodologyPack {
  const raw = { ...(JSON.parse(readFileSync(sbdPackPath, 'utf8')) as Record<string, unknown>) }
  Object.assign(raw, overrides)
  if (rehash) {
    delete raw.canonicalContentHash
    raw.canonicalContentHash = { algorithm: 'sha256', value: computeCanonicalContentHash(raw) }
  }
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

function approvedSignOff(pack: MethodologyPack, contentHash?: string): PackReviewSignOff {
  const verdicts = pack.criteria.map((criterion) => ({
    criterionStableKey: criterion.id,
    verdict: 'usable' as const,
    note: null,
  }))
  return packReviewSignOffSchema.parse({
    id: 'sign-off-1',
    packKey: pack.key,
    packVersion: pack.version,
    contentHash: contentHash ?? pack.canonicalContentHash.value,
    decision: derivePackReviewDecision(verdicts),
    note: null,
    signedAt: '2026-08-17T00:00:00.000Z',
    verdicts,
  }) as PackReviewSignOff
}

describe('methodology pack activation gate', () => {
  it('allows exactly one lifecycle step when file, database and sign-off agree', () => {
    const pack = sbdPack()
    const plan = planMethodologyPackActivation({
      pack,
      persistedStatus: 'review',
      signOff: approvedSignOff(pack),
    })

    expect(plan).toEqual({
      ok: true,
      packKey: 'schooling-by-design',
      packVersion: '1',
      contentHash: pack.canonicalContentHash.value,
      from: 'review',
      to: 'active',
      signOffId: 'sign-off-1',
      signedAt: '2026-08-17T00:00:00.000Z',
    })
  })

  it('refuses when no consultant sign-off exists', () => {
    const pack = sbdPack()
    const plan = planMethodologyPackActivation({
      pack,
      persistedStatus: 'review',
      signOff: null,
    })

    expect(plan.ok).toBe(false)
    expect(plan.ok === false && plan.code).toBe('no_sign_off')
  })

  it('refuses when the reviewed content no longer matches the pack', () => {
    const pack = sbdPack()
    const plan = planMethodologyPackActivation({
      pack,
      persistedStatus: 'review',
      signOff: approvedSignOff(pack, 'a'.repeat(64)),
    })

    expect(plan.ok === false && plan.code).toBe('sign_off_outdated')
  })

  it('refuses when the review asked for revisions or did not cover every criterion', () => {
    const pack = sbdPack()
    const partial = approvedSignOff(pack)
    const changesRequested = packReviewSignOffSchema.parse({
      ...partial,
      decision: 'changes_requested',
    }) as PackReviewSignOff
    const incomplete = packReviewSignOffSchema.parse({
      ...partial,
      verdicts: partial.verdicts.slice(1),
    }) as PackReviewSignOff

    expect(
      planMethodologyPackActivation({ pack, persistedStatus: 'review', signOff: changesRequested }),
    ).toMatchObject({ ok: false, code: 'sign_off_not_approved' })
    expect(
      planMethodologyPackActivation({ pack, persistedStatus: 'review', signOff: incomplete }),
    ).toMatchObject({ ok: false, code: 'sign_off_incomplete' })
  })

  it('refuses rollback, skipped states and retired revival', () => {
    const draft = packWith({ status: 'draft' })
    const active = packWith({ status: 'active' })
    const retired = packWith({ status: 'retired' })

    expect(
      planMethodologyPackActivation({
        pack: draft,
        persistedStatus: 'draft',
        signOff: approvedSignOff(draft),
      }),
    ).toMatchObject({ ok: false, code: 'file_not_in_review' })
    expect(
      planMethodologyPackActivation({
        pack: active,
        persistedStatus: 'active',
        signOff: approvedSignOff(active),
      }),
    ).toMatchObject({ ok: false, code: 'file_not_in_review' })
    expect(
      planMethodologyPackActivation({
        pack: retired,
        persistedStatus: 'retired',
        signOff: approvedSignOff(retired),
      }),
    ).toMatchObject({ ok: false, code: 'file_not_in_review' })
    expect(
      planMethodologyPackActivation({
        pack: sbdPack(),
        persistedStatus: 'active',
        signOff: approvedSignOff(sbdPack()),
      }),
    ).toMatchObject({ ok: false, code: 'persisted_not_in_review' })
    expect(
      planMethodologyPackActivation({
        pack: sbdPack(),
        persistedStatus: null,
        signOff: approvedSignOff(sbdPack()),
      }),
    ).toMatchObject({ ok: false, code: 'not_persisted' })
  })

  it('refuses when the declared canonical content hash no longer describes the content', () => {
    const tampered = packWith({ title: 'tampered title' })

    expect(
      planMethodologyPackActivation({
        pack: tampered,
        persistedStatus: 'review',
        signOff: approvedSignOff(tampered),
      }),
    ).toMatchObject({ ok: false, code: 'content_hash_mismatch' })
  })

  it('rewrites only the status line so the canonical content hash stays valid', () => {
    const original = readFileSync(sbdPackPath, 'utf8')
    const activated = activatePackFileText(original)

    expect(activated).not.toBe(original)
    expect(activated.replace('"status": "active"', '"status": "review"')).toBe(original)

    const parsed = JSON.parse(activated) as Record<string, unknown>
    const hash = parsed.canonicalContentHash
    expect(parsed.status).toBe('active')
    expect(hash).toEqual({ algorithm: 'sha256', value: computeCanonicalContentHash(parsed) })
    expect(() => activatePackFileText(activated)).toThrow(/exactly one reviewed status line/)
  })
})
