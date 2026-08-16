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

describe('methodology source packaging boundary', () => {
  it('keeps original PDFs out of the repository runtime inputs', () => {
    expect(findPdfFiles(resolve('references'))).toEqual([])
    expect(findPdfFiles(resolve('knowledge/methodology'))).toEqual([])
  })
})
