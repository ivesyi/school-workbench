import { z } from 'zod'
import type { DeepReadonly, MethodologyPack } from './contracts'
import { computePackContentHash } from './hash'

export const packReviewVerdictValues = ['usable', 'needs_revision'] as const
export const packReviewDecisionValues = ['approved', 'changes_requested'] as const

export type PackReviewVerdict = (typeof packReviewVerdictValues)[number]
export type PackReviewDecision = (typeof packReviewDecisionValues)[number]

const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const packReviewCriterionVerdictSchema = z
  .object({
    criterionStableKey: z.string().trim().min(1),
    verdict: z.enum(packReviewVerdictValues),
    note: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict()

export const packReviewSignOffSchema = z
  .object({
    id: z.string().trim().min(1),
    packKey: z.string().trim().min(1),
    packVersion: z.string().trim().min(1),
    contentHash: contentHashSchema,
    decision: z.enum(packReviewDecisionValues),
    note: z.string().trim().min(1).max(4000).nullable(),
    signedAt: z.string().datetime(),
    verdicts: z.array(packReviewCriterionVerdictSchema).min(1),
  })
  .strict()

export type PackReviewCriterionVerdict = DeepReadonly<
  z.infer<typeof packReviewCriterionVerdictSchema>
>
export type PackReviewSignOff = DeepReadonly<z.infer<typeof packReviewSignOffSchema>>

/**
 * The decision is always derived from the per-criterion verdicts. No caller may
 * declare a pack approved while any criterion is still marked as needing revision.
 */
export function derivePackReviewDecision(
  verdicts: readonly PackReviewCriterionVerdict[],
): PackReviewDecision {
  if (verdicts.length === 0) throw new Error('A pack review sign-off requires criterion verdicts')
  return verdicts.every((item) => item.verdict === 'usable') ? 'approved' : 'changes_requested'
}

/**
 * A sign-off is bound to exact content. Any drift in the canonical content hash,
 * criterion set, or pack identity invalidates it instead of silently carrying over.
 */
export function assertPackReviewCoverage(
  pack: MethodologyPack,
  signOff: Readonly<{
    packKey: string
    packVersion: string
    contentHash: string
    verdicts: readonly PackReviewCriterionVerdict[]
  }>,
): void {
  if (signOff.packKey !== pack.key || signOff.packVersion !== pack.version) {
    throw new Error(
      `Sign-off targets ${signOff.packKey}@${signOff.packVersion}, not ${pack.key}@${pack.version}`,
    )
  }
  if (signOff.contentHash !== pack.canonicalContentHash.value) {
    throw new Error(`Sign-off content no longer matches ${pack.key}@${pack.version}`)
  }

  const reviewed = signOff.verdicts.map((item) => item.criterionStableKey)
  const duplicates = reviewed.filter((key, index) => reviewed.indexOf(key) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate criterion verdict: ${[...new Set(duplicates)].join(', ')}`)
  }

  const criterionIds = pack.criteria.map((criterion) => criterion.id)
  const unknown = reviewed.filter((key) => !criterionIds.includes(key))
  if (unknown.length > 0) throw new Error(`Unknown criterion verdict: ${unknown.join(', ')}`)

  const missing = criterionIds.filter((id) => !reviewed.includes(id))
  if (missing.length > 0) throw new Error(`Criterion verdict is missing: ${missing.join(', ')}`)
}

/**
 * True only when this exact pack content carries an approved, complete sign-off.
 */
export function packReviewApproves(
  pack: MethodologyPack,
  signOff: PackReviewSignOff | null,
): boolean {
  if (!signOff) return false
  if (signOff.decision !== 'approved') return false
  if (computePackContentHash(pack) !== pack.canonicalContentHash.value) return false
  try {
    assertPackReviewCoverage(pack, signOff)
    return true
  } catch {
    return false
  }
}

/**
 * True when a sign-off exists for this pack version but was made against content
 * that has since changed. The stale record must never be reused as an approval.
 */
export function packReviewIsOutdated(
  pack: MethodologyPack,
  signOff: PackReviewSignOff | null,
): boolean {
  if (!signOff) return false
  return signOff.contentHash !== pack.canonicalContentHash.value
}

export interface MethodologyReviewRepository {
  recordSignOff(signOff: PackReviewSignOff): Promise<void>
  getLatestSignOff(packKey: string, packVersion: string): Promise<PackReviewSignOff | null>
}
