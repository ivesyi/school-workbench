import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function findPdfFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  const results: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry)
    if (statSync(path).isDirectory()) results.push(...findPdfFiles(path))
    else if (entry.toLowerCase().endsWith('.pdf')) results.push(path)
  }
  return results
}

function trackedReferencePdfFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'references'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.toLowerCase().endsWith('.pdf'))
}

describe('methodology source packaging boundary', () => {
  it('allows ignored consultant-local PDFs while keeping runtime and build outputs clean', () => {
    expect(trackedReferencePdfFiles()).toEqual([])
    expect(findPdfFiles(resolve('knowledge/methodology'))).toEqual([])

    const desktopOutput = resolve('apps/desktop/out')
    if (existsSync(desktopOutput)) expect(findPdfFiles(desktopOutput)).toEqual([])
  })
})
