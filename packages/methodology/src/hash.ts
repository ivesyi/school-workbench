import { createHash } from 'node:crypto'
import type { MethodologyPack } from './contracts'

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
      .join(',')}}`
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined)
    throw new Error('Unsupported value in canonical methodology content')
  return serialized
}

export function computeCanonicalContentHash(
  pack: Omit<MethodologyPack, 'canonicalContentHash'> | Record<string, unknown>,
): string {
  return createHash('sha256').update(canonicalStringify(pack)).digest('hex')
}

export function computePackContentHash(pack: MethodologyPack): string {
  const { canonicalContentHash: _canonicalContentHash, ...content } = pack
  return computeCanonicalContentHash(content)
}
