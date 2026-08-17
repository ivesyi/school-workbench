import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MethodologyPack } from './contracts'
import { computeCanonicalContentHash } from './hash'
import { loadMethodologyRegistry } from './loader'
import { methodologyPackSchema } from './contracts'
import {
  assertPackReviewCoverage,
  derivePackReviewDecision,
  packReviewApproves,
  packReviewIsOutdated,
  packReviewSignOffSchema,
  packReviewWithholdsUse,
  resolvePackRuntimeStatus,
  type PackReviewCriterionVerdict,
  type PackReviewSignOff,
} from './review'

const methodologyRoot = resolve('knowledge/methodology')
const sourceManifestPath = resolve('references/SOURCE_MANIFEST.md')
const sbdPackPath = resolve('knowledge/methodology/schooling-by-design-v1/pack.json')

function sbdPack(): MethodologyPack {
  const registry = loadMethodologyRegistry(methodologyRoot, sourceManifestPath)
  const pack = registry.getPack('schooling-by-design', '1')
  if (!pack) throw new Error('missing SBD pack')
  return pack
}

function retitledPack(title: string): MethodologyPack {
  const raw = JSON.parse(readFileSync(sbdPackPath, 'utf8')) as Record<string, unknown>
  raw.title = title
  delete raw.canonicalContentHash
  raw.canonicalContentHash = { algorithm: 'sha256', value: computeCanonicalContentHash(raw) }
  return methodologyPackSchema.parse(raw) as MethodologyPack
}

function verdictsFor(
  pack: MethodologyPack,
  verdict: PackReviewCriterionVerdict['verdict'] = 'usable',
): PackReviewCriterionVerdict[] {
  return pack.criteria.map((criterion) => ({
    criterionStableKey: criterion.id,
    verdict,
    note: null,
  }))
}

function signOffFor(
  pack: MethodologyPack,
  overrides: Partial<PackReviewSignOff> = {},
): PackReviewSignOff {
  const verdicts = overrides.verdicts ?? verdictsFor(pack)
  return packReviewSignOffSchema.parse({
    id: 'sign-off-1',
    packKey: pack.key,
    packVersion: pack.version,
    contentHash: pack.canonicalContentHash.value,
    decision: derivePackReviewDecision(verdicts),
    note: null,
    signedAt: '2026-08-17T00:00:00.000Z',
    verdicts,
    ...overrides,
  }) as PackReviewSignOff
}

describe('methodology pack review sign-off', () => {
  it('derives the decision from criterion verdicts instead of trusting the caller', () => {
    const pack = sbdPack()

    expect(derivePackReviewDecision(verdictsFor(pack))).toBe('approved')
    expect(
      derivePackReviewDecision([
        ...verdictsFor(pack).slice(1),
        {
          criterionStableKey: 'SBD.C1.RESULT_CLARITY',
          verdict: 'needs_revision',
          note: '描述与标题相同',
        },
      ]),
    ).toBe('changes_requested')
    expect(() => derivePackReviewDecision([])).toThrow(/requires criterion verdicts/)
  })

  it('requires the sign-off to cover every criterion of the exact pack version', () => {
    const pack = sbdPack()

    expect(() => assertPackReviewCoverage(pack, signOffFor(pack))).not.toThrow()
    expect(() =>
      assertPackReviewCoverage(pack, signOffFor(pack, { verdicts: verdictsFor(pack).slice(1) })),
    ).toThrow(/Criterion verdict is missing/)
    expect(() =>
      assertPackReviewCoverage(pack, {
        ...signOffFor(pack),
        verdicts: [
          ...verdictsFor(pack),
          { criterionStableKey: 'DW.C1.LEARNING_PROBLEM_QUALITY', verdict: 'usable', note: null },
        ],
      }),
    ).toThrow(/Unknown criterion verdict/)
    expect(() =>
      assertPackReviewCoverage(pack, {
        ...signOffFor(pack),
        verdicts: [...verdictsFor(pack), ...verdictsFor(pack).slice(0, 1)],
      }),
    ).toThrow(/Duplicate criterion verdict/)
    expect(() => assertPackReviewCoverage(pack, { ...signOffFor(pack), packVersion: '9' })).toThrow(
      /Sign-off targets schooling-by-design@9/,
    )
  })

  it('invalidates a sign-off as soon as the reviewed content drifts', () => {
    const reviewed = sbdPack()
    const signOff = signOffFor(reviewed)
    const drifted = retitledPack('Schooling by Design Methodology Pack v1 (retranslated)')

    expect(drifted.canonicalContentHash.value).not.toBe(reviewed.canonicalContentHash.value)
    expect(packReviewApproves(reviewed, signOff)).toBe(true)
    expect(packReviewApproves(drifted, signOff)).toBe(false)
    expect(packReviewIsOutdated(drifted, signOff)).toBe(true)
    expect(packReviewIsOutdated(reviewed, signOff)).toBe(false)
    expect(packReviewIsOutdated(reviewed, null)).toBe(false)
  })

  it('never treats a changes-requested review as approval', () => {
    const pack = sbdPack()
    const signOff = signOffFor(pack, { verdicts: verdictsFor(pack, 'needs_revision') })

    expect(signOff.decision).toBe('changes_requested')
    expect(packReviewApproves(pack, signOff)).toBe(false)
    expect(packReviewApproves(pack, null)).toBe(false)
  })
})

describe('methodology pack runtime status resolution', () => {
  it('keeps shipped content in use with no consultant action at all', () => {
    const pack = sbdPack()

    expect(packReviewWithholdsUse(null)).toBe(false)
    expect(resolvePackRuntimeStatus('active', null)).toBe('active')
    expect(resolvePackRuntimeStatus('active', signOffFor(pack))).toBe('active')
  })

  it('withholds the pack as soon as one criterion needs revision', () => {
    const pack = sbdPack()
    const vetoed = signOffFor(pack, { verdicts: verdictsFor(pack, 'needs_revision') })
    const partial = signOffFor(pack, {
      verdicts: [
        { criterionStableKey: 'SBD.C1.RESULT_CLARITY', verdict: 'needs_revision', note: null },
        ...verdictsFor(pack).slice(1),
      ],
    })

    expect(packReviewWithholdsUse(vetoed)).toBe(true)
    expect(partial.decision).toBe('changes_requested')
    expect(resolvePackRuntimeStatus('active', vetoed)).toBe('review')
    expect(resolvePackRuntimeStatus('active', partial)).toBe('review')
  })

  it('carries a veto across content drift but never a stale approval back into use', () => {
    const reviewed = sbdPack()
    const drifted = retitledPack('Schooling by Design Methodology Pack v1 (retranslated)')
    const vetoed = signOffFor(reviewed, { verdicts: verdictsFor(reviewed, 'needs_revision') })
    const approved = signOffFor(reviewed)

    expect(packReviewIsOutdated(drifted, vetoed)).toBe(true)
    // D5: a refusal survives the edit; an approval simply stops being an approval.
    expect(resolvePackRuntimeStatus(drifted.status, vetoed)).toBe('review')
    expect(resolvePackRuntimeStatus(drifted.status, approved)).toBe('active')
  })

  it('never lifts a draft or retired pack into use', () => {
    const pack = sbdPack()

    expect(resolvePackRuntimeStatus('draft', signOffFor(pack))).toBe('draft')
    expect(resolvePackRuntimeStatus('retired', signOffFor(pack))).toBe('retired')
    expect(resolvePackRuntimeStatus('review', signOffFor(pack))).toBe('review')
  })
})
