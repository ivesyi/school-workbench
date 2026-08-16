import { z } from 'zod'

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
const conceptIdSchema = z.string().regex(/^swb:/)

export const manifestSchema = z.object({
  id: z.string().min(1),
  version: versionSchema,
  status: z.enum(['draft', 'active', 'retired']),
  title: z.string().min(1),
  namespace: z.string().min(1),
  releasedAt: z.string().date(),
  governance: z.object({
    activeVersionsImmutable: z.boolean(),
    breakingChangesRequireMajorVersion: z.boolean(),
    compatibleAdditionsRequireMinorVersion: z.boolean(),
    humanApprovalRequiredForMappings: z.boolean(),
  }),
  files: z.object({
    concepts: z.string().min(1),
    relations: z.string().min(1),
    constraints: z.string().min(1),
    mappings: z.string().min(1),
  }),
})

export const conceptsFileSchema = z.object({
  version: versionSchema,
  concepts: z.array(
    z.object({
      id: conceptIdSchema,
      label: z.string().min(1),
      kind: z.enum(['entity', 'classification', 'record', 'rule']),
      layer: z.enum(['ontic', 'normative', 'epistemic', 'methodology']),
      definition: z.string().min(1),
    }),
  ),
})

export const relationsFileSchema = z.object({
  version: versionSchema,
  relations: z.array(
    z.object({
      id: conceptIdSchema,
      label: z.string().min(1),
      from: conceptIdSchema,
      to: conceptIdSchema,
      cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
    }),
  ),
})

export const constraintsFileSchema = z.object({
  version: versionSchema,
  constraints: z.array(
    z.object({
      id: z.string().startsWith('swb.constraint.'),
      severity: z.enum(['error', 'warning']),
      appliesTo: z.string().min(1),
      rule: z.string().min(1),
    }),
  ),
})

const mappingEntrySchema = z.object({
  sourceId: z.string().min(1),
  targetIds: z.array(conceptIdSchema).min(1),
})

export const mappingsFileSchema = z.object({
  version: versionSchema,
  mappings: z.array(
    z.object({
      sourcePack: z.string().min(1),
      sourceVersion: z.string().min(1),
      status: z.enum(['approved', 'pending-review']),
      entries: z.array(mappingEntrySchema),
    }),
  ),
  boundaries: z.array(
    z.object({
      sourcePack: z.string().min(1),
      status: z.literal('pending-review'),
      allowedTargetIds: z.array(conceptIdSchema).min(1),
      prohibition: z.string().min(1),
    }),
  ),
})

export type OntologyManifest = z.infer<typeof manifestSchema>
export type OntologyConceptsFile = z.infer<typeof conceptsFileSchema>
export type OntologyRelationsFile = z.infer<typeof relationsFileSchema>
export type OntologyConstraintsFile = z.infer<typeof constraintsFileSchema>
export type OntologyMappingsFile = z.infer<typeof mappingsFileSchema>
