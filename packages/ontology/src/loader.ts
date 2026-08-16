import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  conceptsFileSchema,
  constraintsFileSchema,
  manifestSchema,
  mappingsFileSchema,
  relationsFileSchema,
  type OntologyConceptsFile,
  type OntologyConstraintsFile,
  type OntologyManifest,
  type OntologyMappingsFile,
  type OntologyRelationsFile,
} from './schemas'

export type OntologyBundle = {
  manifest: OntologyManifest
  concepts: OntologyConceptsFile
  relations: OntologyRelationsFile
  constraints: OntologyConstraintsFile
  mappings: OntologyMappingsFile
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8')) as unknown
}

function assertUnique(ids: string[], kind: string): void {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate ${kind} IDs: ${[...new Set(duplicates)].join(', ')}`)
  }
}

export function loadOntologyBundle(directory: string): OntologyBundle {
  const manifest = manifestSchema.parse(readYaml(join(directory, 'manifest.yaml')))
  const concepts = conceptsFileSchema.parse(readYaml(join(directory, manifest.files.concepts)))
  const relations = relationsFileSchema.parse(readYaml(join(directory, manifest.files.relations)))
  const constraints = constraintsFileSchema.parse(
    readYaml(join(directory, manifest.files.constraints)),
  )
  const mappings = mappingsFileSchema.parse(readYaml(join(directory, manifest.files.mappings)))

  const versions = [concepts.version, relations.version, constraints.version, mappings.version]
  if (versions.some((version) => version !== manifest.version)) {
    throw new Error('Ontology files must use the manifest version')
  }

  assertUnique(
    concepts.concepts.map((concept) => concept.id),
    'concept',
  )
  assertUnique(
    relations.relations.map((relation) => relation.id),
    'relation',
  )
  assertUnique(
    constraints.constraints.map((constraint) => constraint.id),
    'constraint',
  )

  const conceptIds = new Set(concepts.concepts.map((concept) => concept.id))
  for (const relation of relations.relations) {
    if (!conceptIds.has(relation.from) || !conceptIds.has(relation.to)) {
      throw new Error(`Relation ${relation.id} references an unknown concept`)
    }
  }

  const mappingTargetIds = [
    ...mappings.mappings.flatMap((mapping) => mapping.entries.flatMap((entry) => entry.targetIds)),
    ...mappings.boundaries.flatMap((boundary) => boundary.allowedTargetIds),
  ]
  const unknownTarget = mappingTargetIds.find((id) => !conceptIds.has(id))
  if (unknownTarget) {
    throw new Error(`Framework mapping references unknown concept ${unknownTarget}`)
  }

  return { manifest, concepts, relations, constraints, mappings }
}
