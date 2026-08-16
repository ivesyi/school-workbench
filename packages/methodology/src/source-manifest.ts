import { readFileSync } from 'node:fs'

export type SourceFingerprintManifest = ReadonlyMap<string, string>

const sourceRowPattern = /^\|\s*`([^`]+)`\s*\|\s*`([a-f0-9]{64})`\s*\|/i

export function loadSourceFingerprintManifest(path: string): SourceFingerprintManifest {
  const content = readFileSync(path, 'utf8')
  const entries = new Map<string, string>()

  for (const line of content.split(/\r?\n/)) {
    const match = sourceRowPattern.exec(line)
    if (!match) continue
    const sourceRef = match[1]
    const fingerprint = match[2]?.toLowerCase()
    if (!sourceRef || !fingerprint) continue
    if (entries.has(sourceRef)) throw new Error(`Duplicate source manifest entry: ${sourceRef}`)
    entries.set(sourceRef, fingerprint)
  }

  if (entries.size === 0) throw new Error('Source manifest contains no SHA-256 entries')
  return entries
}
