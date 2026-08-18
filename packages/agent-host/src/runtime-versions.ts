/**
 * Which versions of the two external pieces this product has actually been
 * verified against.
 *
 * This is **not** a gate, and SPEC 62 is the reason it cannot become one: the
 * compatibility verdict is derived from what a runtime answers during the ACP
 * handshake and the workbench contract test, never from a version string. So
 * nothing in this module may be read by `runtime-compatibility.ts`, by
 * `AgentHost`, or by anything that decides whether a run may proceed. It exists
 * for exactly one purpose: telling a person what is installed and whether
 * anybody has checked this product against it.
 *
 * An unverified version is therefore reported and then ignored. A newer Codex
 * that works fine keeps working; a newer Codex that breaks something shows up
 * as a failed run with a plain explanation, the same as it would today.
 *
 * ## Verifying a new version
 *
 * The range is only allowed to grow after a real end-to-end run on the new
 * version — the manual Codex acceptance described in
 * `docs/development/AI_RUNTIME_LOOP_LEDGER.md`. Then, and only then, widen
 * `verifiedUntil` here and record the run in the ledger. Nothing here may be
 * edited to make a warning go away.
 */

export type VerifiedVersionRange = Readonly<{
  /** Oldest version a real end-to-end run has been carried out on. */
  verifiedFrom: string
  /** Newest such version. */
  verifiedUntil: string
}>

export const verifiedRuntimeVersions = Object.freeze({
  /**
   * The ACP bridge. Pinned exactly in `apps/desktop/package.json` (decision L8)
   * and verified end to end in the ledger's M1/M2/M3 Codex acceptance runs.
   */
  codex_acp: Object.freeze({ verifiedFrom: '1.4.0', verifiedUntil: '1.4.0' }),
  /**
   * The consultant's own Codex command-line tool. Not pinned by this repository
   * — it is whatever the consultant installed — so the range starts at the
   * version measured on the machine the acceptance runs were carried out on.
   */
  codex_cli: Object.freeze({ verifiedFrom: '0.147.0', verifiedUntil: '0.147.0' }),
} as const satisfies Readonly<Record<string, VerifiedVersionRange>>)

export type VerifiedRuntimeKey = keyof typeof verifiedRuntimeVersions

/**
 * The version of the controlled harness the built-in assistant runs on.
 *
 * Deliberately *not* a member of `verifiedRuntimeVersions`, and the difference
 * is the whole point of the distinction that table draws. Those two entries are
 * ranges because the artefacts they describe are outside this repository: the
 * consultant installs Codex and it moves on its own, so "which versions has
 * anybody checked" is a real, open question with a range for an answer.
 *
 * This one is a single value because the library is pinned in this
 * repository's lockfile. There is no range to keep: whatever this string says
 * is exactly what runs, until somebody here edits the pin and the acceptance
 * run below is repeated.
 *
 * **It is not verified yet.** No end-to-end run against a real model has been
 * carried out on it — the model connection had not been configured when the
 * harness landed — so the settings page reports it as unverified and says so.
 * Widening that claim requires the same acceptance run §14.3 of the ledger
 * demands of every other runtime: configure a model connection, drive one real
 * analysis from the workbench through to a judgement in Human Review, then
 * record the run in the ledger. Editing this file is not how that happens.
 */
export const pinnedBuiltinHarnessVersion = '0.84.2'

/** Where a reported version sits against the verified range. */
export type VersionStanding = 'verified' | 'unverified' | 'unknown'

const NUMERIC_PREFIX = /^\d+(?:\.\d+)*/u

/**
 * Compares two dotted numeric versions.
 *
 * Only the leading numeric part is compared; anything after it (`-rc.1`,
 * `+build`, a trailing word) is ignored rather than guessed at. Returns null
 * when either side has no numeric part at all, so a caller says "unknown"
 * instead of inventing an ordering.
 */
export function compareVersions(left: string, right: string): number | null {
  const leftMatch = NUMERIC_PREFIX.exec(left.trim())
  const rightMatch = NUMERIC_PREFIX.exec(right.trim())
  if (!leftMatch || !rightMatch) return null

  const leftParts = leftMatch[0].split('.').map(Number)
  const rightParts = rightMatch[0].split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0
    const b = rightParts[index] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * Pulls a version out of whatever a command-line tool printed.
 *
 * `codex --version` answers `codex-cli 0.147.0`; other builds prepend a `v` or
 * add a build suffix. Returns null rather than a guess when nothing in the
 * output looks like a version.
 */
export function parseReportedVersion(output: string): string | null {
  // Not anchored on a word boundary: `v1.4.0` has none between the `v` and the
  // `1`, and matching from the `4` would report a version nobody has.
  const match = /(?<![\d.])\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?/u.exec(output)
  return match ? match[0] : null
}

/**
 * Where an installed version stands. Display only.
 *
 * `unknown` is a real answer and not a failure: a version that could not be
 * read changes nothing about whether the assistant works.
 */
export function versionStanding(key: VerifiedRuntimeKey, version: string | null): VersionStanding {
  if (!version) return 'unknown'
  const range = verifiedRuntimeVersions[key]
  const fromComparison = compareVersions(version, range.verifiedFrom)
  const untilComparison = compareVersions(version, range.verifiedUntil)
  if (fromComparison === null || untilComparison === null) return 'unknown'
  return fromComparison >= 0 && untilComparison <= 0 ? 'verified' : 'unverified'
}
