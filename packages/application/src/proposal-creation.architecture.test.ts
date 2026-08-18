import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One way in, checked mechanically.
 *
 * A DiagnosisProposal is the workbench's formal claim about a school, and the
 * only thing allowed to make one is `GroundedDiagnosisService`, behind the
 * strict assessment contract. That is easy to state and easy to erode: a
 * convenience method on a repository, a second IPC channel, a "temporary"
 * deterministic engine. These checks read the source and fail when a second
 * route appears.
 */

const repositoryRoot = resolve('.')

const PRODUCTION_ROOTS = [
  'packages/application/src',
  'packages/assessment/src',
  'packages/db/src',
  'packages/domain/src',
  'packages/methodology/src',
  'packages/ontology/src',
  'packages/shared/src',
  'packages/workbench-read-plane/src',
  'packages/workbench-mcp/src',
  'packages/agent-host/src',
  'packages/experience/src',
  'apps/desktop/src',
]

/** Files that exist only to set up tests. Never shipped, never imported by code. */
const TEST_ONLY_FILES = [
  'packages/db/src/test-support.ts',
  'packages/assessment/src/test-support.ts',
]

function walk(directory: string): string[] {
  const absolute = join(repositoryRoot, directory)
  let entries: string[]
  try {
    entries = readdirSync(absolute)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const path = join(absolute, entry)
    if (statSync(path).isDirectory()) return walk(relative(repositoryRoot, path))
    return /\.tsx?$/.test(entry) ? [relative(repositoryRoot, path).split(sep).join('/')] : []
  })
}

const allSources = PRODUCTION_ROOTS.flatMap(walk)
const isTestFile = (path: string): boolean =>
  /\.test\.tsx?$/.test(path) || TEST_ONLY_FILES.includes(path)
const productionSources = allSources.filter((path) => !isTestFile(path))
const read = (path: string): string => readFileSync(join(repositoryRoot, path), 'utf8')

function productionFilesContaining(pattern: RegExp): string[] {
  return productionSources.filter((path) => pattern.test(read(path)))
}

describe('creating a judgement', () => {
  it('scans a source tree that actually exists', () => {
    // A silent zero-file scan would make every check below pass vacuously.
    expect(productionSources.length).toBeGreaterThan(60)
    expect(productionSources).toContain('packages/application/src/grounded-diagnosis-service.ts')
  })

  it('has no deterministic engine or unvalidated chain left anywhere in the product', () => {
    for (const symbol of [
      'BaselineAssessmentEngine',
      'createProposalChain',
      'saveProposalChain',
      'ProposalChain',
      'AssessmentDraft',
    ]) {
      expect(productionFilesContaining(new RegExp(`\\b${symbol}\\b`)), symbol).toEqual([])
    }
  })

  it('builds a proposal in exactly one place', () => {
    expect(productionFilesContaining(/createGroundedDiagnosisProposal/)).toEqual([
      'packages/application/src/grounded-diagnosis-service.ts',
      'packages/domain/src/grounded-diagnosis.ts',
    ])
  })

  it('writes a proposal row in exactly one place', () => {
    expect(
      productionFilesContaining(/insert\(diagnosisProposals\)|INSERT INTO diagnosis_proposals/),
    ).toEqual(['packages/db/src/sqlite-grounded-diagnosis-repository.ts'])
  })

  it('reaches that place only through the assessment contract', () => {
    const service = read('packages/application/src/grounded-diagnosis-service.ts')
    // The validator runs first and a refusal throws, so nothing downstream can
    // be reached with an unvalidated candidate.
    expect(service).toMatch(/validateAssessmentCandidate\(/)
    expect(service).toMatch(/if \(!validation\.ok\) throw new GroundedDiagnosisProtocolError/)
    const validated = service.indexOf('validateAssessmentCandidate(')
    expect(validated).toBeLessThan(service.indexOf('createGroundedDiagnosisProposal('))
    expect(validated).toBeLessThan(service.indexOf('this.repository.saveGroundedProposal('))
  })

  it('offers the renderer no channel that creates one', () => {
    const channels = read('packages/shared/src/judgments.ts')
    expect(channels).toMatch(/judgmentIpcChannels = \{\s*review:/)
    expect(channels).not.toMatch(/submitSituation/)

    for (const path of [
      'apps/desktop/src/preload/index.ts',
      'apps/desktop/src/main/judgment-ipc.ts',
      'packages/shared/src/api.ts',
    ]) {
      expect(read(path), path).not.toMatch(/submitSituation/)
    }
  })

  it('keeps test fixtures out of the product', () => {
    for (const fixture of TEST_ONLY_FILES) {
      const moduleName = fixture.replace(/^.*\/src\//, '').replace(/\.ts$/, '')
      const importers = productionFilesContaining(new RegExp(`from '[^']*${moduleName}'`))
      expect(importers, fixture).toEqual([])
    }
  })

  it('never lets an abstention reach the review surface', () => {
    // The view type only admits `proposed`, so an abstention cannot be rendered
    // as something with an "认同" button even by accident.
    expect(read('packages/shared/src/judgments.ts')).toMatch(/status: z\.literal\('proposed'\)/)
    expect(read('packages/application/src/judgment-service.ts')).toMatch(
      /if \(proposal\.status !== 'proposed' \|\| !proposal\.provisionalJudgment\) return null/,
    )
  })
})
