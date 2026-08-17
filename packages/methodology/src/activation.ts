import type { MethodologyPack, MethodologyPackStatus } from './contracts'
import { computePackContentHash } from './hash'
import { assertPackReviewCoverage, type PackReviewSignOff } from './review'

export const methodologyActivationRefusalCodes = [
  'file_not_in_review',
  'content_hash_mismatch',
  'not_persisted',
  'persisted_not_in_review',
  'no_sign_off',
  'sign_off_outdated',
  'sign_off_not_approved',
  'sign_off_incomplete',
] as const

export type MethodologyActivationRefusalCode = (typeof methodologyActivationRefusalCodes)[number]

export type MethodologyActivationPlan =
  | Readonly<{
      ok: true
      packKey: string
      packVersion: string
      contentHash: string
      from: MethodologyPackStatus
      to: MethodologyPackStatus
      signOffId: string
      signedAt: string
    }>
  | Readonly<{ ok: false; code: MethodologyActivationRefusalCode; message: string }>

function refuse(
  code: MethodologyActivationRefusalCode,
  message: string,
): MethodologyActivationPlan {
  return Object.freeze({ ok: false as const, code, message })
}

/**
 * The activation gate. `review -> active` is allowed only when the file pack, the
 * persisted projection, and the consultant sign-off all describe the same content
 * and the transition advances exactly one lifecycle state.
 */
export function planMethodologyPackActivation(
  input: Readonly<{
    pack: MethodologyPack
    persistedStatus: MethodologyPackStatus | null
    signOff: PackReviewSignOff | null
  }>,
): MethodologyActivationPlan {
  const { pack, persistedStatus, signOff } = input
  const packRef = `${pack.key}@${pack.version}`

  if (computePackContentHash(pack) !== pack.canonicalContentHash.value) {
    return refuse(
      'content_hash_mismatch',
      `${packRef} content changed after its canonical content hash was written; regenerate the pack before activating.`,
    )
  }
  if (pack.status !== 'review') {
    return refuse(
      'file_not_in_review',
      `${packRef} is "${pack.status}" in knowledge/methodology; only a reviewed pack can be activated.`,
    )
  }
  if (persistedStatus === null) {
    return refuse(
      'not_persisted',
      `${packRef} is not in the local workbench database yet; open the desktop app once so the pack is loaded.`,
    )
  }
  if (persistedStatus !== 'review') {
    return refuse(
      'persisted_not_in_review',
      `${packRef} is already "${persistedStatus}" in the local workbench database; activation would not be a single lifecycle step.`,
    )
  }
  if (!signOff) {
    return refuse(
      'no_sign_off',
      `${packRef} has no review sign-off; complete the in-app review before activating.`,
    )
  }
  if (signOff.contentHash !== pack.canonicalContentHash.value) {
    return refuse(
      'sign_off_outdated',
      `${packRef} changed after it was reviewed; the previous sign-off no longer applies and the pack must be reviewed again.`,
    )
  }
  if (signOff.decision !== 'approved') {
    return refuse(
      'sign_off_not_approved',
      `${packRef} was reviewed with decision "${signOff.decision}"; it was not approved for use.`,
    )
  }
  try {
    assertPackReviewCoverage(pack, signOff)
  } catch (error) {
    return refuse(
      'sign_off_incomplete',
      `${packRef} sign-off does not cover the pack: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return Object.freeze({
    ok: true as const,
    packKey: pack.key,
    packVersion: pack.version,
    contentHash: pack.canonicalContentHash.value,
    from: 'review' as const,
    to: 'active' as const,
    signOffId: signOff.id,
    signedAt: signOff.signedAt,
  })
}

function reviewStatusLine(): RegExp {
  return /^([ \t]*)"status": "review"(,?)[ \t]*$/gm
}

/**
 * Rewrites only the lifecycle status line of a `pack.json` document. Every other
 * byte is preserved, so the canonical content hash (which excludes `status`)
 * stays valid and the file keeps its existing formatting.
 */
export function activatePackFileText(text: string): string {
  const matches = text.match(reviewStatusLine())
  if (!matches || matches.length !== 1) {
    throw new Error(
      `Expected exactly one reviewed status line in pack.json, found ${matches?.length ?? 0}`,
    )
  }
  return text.replace(reviewStatusLine(), '$1"status": "active"$2')
}
