import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOntologyBundle } from './loader'

describe('Ontology v1', () => {
  it('loads a version-consistent, referentially valid bundle', () => {
    const bundle = loadOntologyBundle(resolve('knowledge/ontology/core-v1'))

    expect(bundle.manifest.status).toBe('active')
    expect(bundle.concepts.concepts).toHaveLength(17)
    expect(bundle.relations.relations.length).toBeGreaterThan(10)
    expect(
      bundle.mappings.boundaries.every((boundary) => boundary.status === 'pending-review'),
    ).toBe(true)
  })
})
