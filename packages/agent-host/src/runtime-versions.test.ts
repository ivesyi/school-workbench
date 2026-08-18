import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  parseReportedVersion,
  pinnedBuiltinHarnessVersion,
  verifiedRuntimeVersions,
  versionStanding,
} from './runtime-versions'

describe('the versions this product has been verified against', () => {
  it('records the ACP bridge version the application actually pins', () => {
    // Decision L8 pins the bridge exactly, so a range that disagreed with the
    // manifest would be describing something nobody runs.
    const manifest: unknown = JSON.parse(readFileSync(resolve('apps/desktop/package.json'), 'utf8'))
    const pinned = (manifest as { dependencies?: Record<string, string> }).dependencies?.[
      '@agentclientprotocol/codex-acp'
    ]
    expect(pinned).toBe(verifiedRuntimeVersions.codex_acp.verifiedFrom)
    expect(pinned).toBe(verifiedRuntimeVersions.codex_acp.verifiedUntil)
  })

  it('records the harness version both manifests actually pin, exactly', () => {
    // The whole argument for a controlled harness is that the version cannot
    // move on its own. Two manifests pin it — the package that imports it and
    // the app that ships it — and a constant that disagreed with either would
    // put a version nobody runs into the database and onto the settings page.
    for (const manifestPath of ['packages/agent-host/package.json', 'apps/desktop/package.json']) {
      const manifest: unknown = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
      const dependencies =
        (manifest as { dependencies?: Record<string, string> }).dependencies ?? {}
      for (const name of ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']) {
        // Exact, not a range: `^` or `~` here would mean the lockfile decides
        // which harness a build runs, which is the failure this replaces.
        expect(dependencies[name], `${manifestPath} → ${name}`).toBe(pinnedBuiltinHarnessVersion)
      }
    }
  })

  it('keeps the pinned harness out of the verified ranges until somebody verifies it', () => {
    // The two entries in that table describe artefacts outside this repository
    // and grow only after a real end-to-end run. The pinned harness has had no
    // such run, so it must not have acquired a range that implies otherwise.
    expect(Object.keys(verifiedRuntimeVersions)).toEqual(['codex_acp', 'codex_cli'])
  })

  it('reads as a range, oldest first', () => {
    for (const range of Object.values(verifiedRuntimeVersions)) {
      expect(compareVersions(range.verifiedFrom, range.verifiedUntil)).toBeLessThanOrEqual(0)
    }
  })
})

describe('comparing versions', () => {
  it('orders by number, not by string', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    // A missing part is a zero, not a mismatch.
    expect(compareVersions('1.4', '1.4.0')).toBe(0)
  })

  it('says it does not know rather than guessing', () => {
    expect(compareVersions('nightly', '1.4.0')).toBeNull()
    expect(compareVersions('1.4.0', '')).toBeNull()
  })

  it('ignores whatever follows the numbers instead of failing on it', () => {
    expect(compareVersions('1.4.0-rc.1', '1.4.0')).toBe(0)
  })
})

describe('reading a version out of what a tool printed', () => {
  it('handles the shape Codex actually prints', () => {
    expect(parseReportedVersion('codex-cli 0.147.0\n')).toBe('0.147.0')
  })

  it('handles a leading v and a build suffix', () => {
    expect(parseReportedVersion('v1.4.0')).toBe('1.4.0')
    expect(parseReportedVersion('codex-cli 0.148.0-alpha.2')).toBe('0.148.0-alpha.2')
  })

  it('returns nothing rather than a guess', () => {
    expect(parseReportedVersion('command not found')).toBeNull()
    expect(parseReportedVersion('')).toBeNull()
  })
})

describe('where an installed version stands', () => {
  it('recognises a version inside the verified range', () => {
    expect(versionStanding('codex_acp', '1.4.0')).toBe('verified')
    expect(versionStanding('codex_cli', '0.147.0')).toBe('verified')
  })

  it('marks anything outside it unverified, in both directions', () => {
    expect(versionStanding('codex_acp', '1.5.0')).toBe('unverified')
    expect(versionStanding('codex_acp', '1.3.0')).toBe('unverified')
    expect(versionStanding('codex_cli', '0.150.0')).toBe('unverified')
  })

  it('says unknown when there is nothing to compare', () => {
    expect(versionStanding('codex_cli', null)).toBe('unknown')
    expect(versionStanding('codex_cli', 'nightly')).toBe('unknown')
  })
})
