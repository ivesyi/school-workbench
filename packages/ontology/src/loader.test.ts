import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOntologyBundle } from './loader'

describe('Ontology v1 draft', () => {
  it('loads a version-consistent, referentially valid bundle', () => {
    const bundle = loadOntologyBundle(resolve('knowledge/ontology/core-v1'))

    expect(bundle.manifest.status).toBe('draft')
    expect(bundle.concepts.concepts).toHaveLength(22)
    expect(new Set(bundle.concepts.concepts.map((concept) => concept.layer))).toEqual(
      new Set(['ontic', 'normative', 'epistemic', 'methodology']),
    )
    expect(bundle.relations.relations.length).toBeGreaterThan(20)
    expect(
      bundle.mappings.boundaries.every((boundary) => boundary.status === 'pending-review'),
    ).toBe(true)
  })
})
