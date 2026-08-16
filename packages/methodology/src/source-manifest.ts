import { readFileSync } from 'node:fs'

export type SourceFingerprintManifest = ReadonlyMap<string, string>

const sourceRowPattern = /^\|\s*`([^`]+)`\s*\|\s*(?:[^|]*\|\s*)?`([a-f0-9]{64})`\s*\|/i

function normalizeSourceRef(path: string): string {
  return path.startsWith('references/') ? path : `references/${path}`
}

export function loadSourceFingerprintManifest(path: string): SourceFingerprintManifest {
  const content = readFileSync(path, 'utf8')
  const entries = new Map<string, string>()

  for (const line of content.split(/\r?\n/)) {
    const match = sourceRowPattern.exec(line)
    if (!match) continue
    const manifestPath = match[1]
    const fingerprint = match[2]?.toLowerCase()
    if (!manifestPath || !fingerprint) continue
    const sourceRef = normalizeSourceRef(manifestPath)
    if (entries.has(sourceRef)) throw new Error(`Duplicate source manifest entry: ${sourceRef}`)
    entries.set(sourceRef, fingerprint)
  }

  if (entries.size === 0) throw new Error('Source manifest contains no SHA-256 entries')
  return entries
}
