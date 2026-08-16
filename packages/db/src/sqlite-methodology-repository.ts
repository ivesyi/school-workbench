import {
  counterIndicatorsSchema,
  criterionGuardrailEnvelopeSchema,
  deepFreeze,
  inferenceGuardrailSchema,
  persistenceEvidenceGuidanceSchema,
  projectMethodologyPack,
  sourceLocatorSchema,
  type CanonicalDimensionKey,
  type MethodologyPackProjection,
  type MethodologyRepository,
  type MethodologyRegistry,
  type MethodologyPackStatus,
} from '@school-workbench/methodology'
import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { behaviorAnchors, methodologyCriteria, methodologyPacks } from './methodology-schema'

const statuses: MethodologyPackStatus[] = ['draft', 'review', 'active', 'retired']
const sourceTypes: MethodologyPackProjection['sourceType'][] = ['book', 'framework', 'standard']
const dimensionKeys: CanonicalDimensionKey[] = [
  'leadership',
  'key_tasks',
  'structure',
  'culture',
  'capability',
]

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function assertStatus(value: string): MethodologyPackStatus {
  if (!statuses.includes(value as MethodologyPackStatus)) {
    throw new Error(`Unsupported methodology pack status: ${value}`)
  }
  return value as MethodologyPackStatus
}

function assertSourceType(value: string): MethodologyPackProjection['sourceType'] {
  if (!sourceTypes.includes(value as MethodologyPackProjection['sourceType'])) {
    throw new Error(`Unsupported methodology source type: ${value}`)
  }
  return value as MethodologyPackProjection['sourceType']
}

function assertDimension(value: string | null): CanonicalDimensionKey | null {
  if (value === null) return null
  if (!dimensionKeys.includes(value as CanonicalDimensionKey)) {
    throw new Error(`Unsupported methodology dimension: ${value}`)
  }
  return value as CanonicalDimensionKey
}

function sameProjection(
  left: MethodologyPackProjection,
  right: MethodologyPackProjection,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class SqliteMethodologyRepository implements MethodologyRepository {
  constructor(
    private readonly database: BetterSQLite3Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async syncRegistry(registry: MethodologyRegistry): Promise<void> {
    for (const pack of registry.listPacks()) this.syncPack(projectMethodologyPack(pack))
  }

  async listPacks(): Promise<readonly MethodologyPackProjection[]> {
    const rows = this.database
      .select()
      .from(methodologyPacks)
      .orderBy(methodologyPacks.key, methodologyPacks.version)
      .all()
    return deepFreeze(rows.map((row) => this.loadProjection(row.id)))
  }

  async getPack(key: string, version: string): Promise<MethodologyPackProjection | null> {
    const row = this.database
      .select({ id: methodologyPacks.id })
      .from(methodologyPacks)
      .where(and(eq(methodologyPacks.key, key), eq(methodologyPacks.version, version)))
      .get()
    return row ? this.loadProjection(row.id) : null
  }

  async getCriterion(
    stableId: string,
    selector?: Readonly<{ packKey?: string; version?: string }>,
  ): Promise<MethodologyPackProjection['criteria'][number] | null> {
    const matches = (await this.listPacks())
      .filter((pack) => !selector?.packKey || pack.key === selector.packKey)
      .filter((pack) => !selector?.version || pack.version === selector.version)
      .flatMap((pack) => pack.criteria.filter((criterion) => criterion.stableKey === stableId))
    if (matches.length > 1) {
      throw new Error(
        `Criterion ${stableId} exists in multiple persisted versions; select a version`,
      )
    }
    return matches[0] ?? null
  }

  async findCriteria(
    filter: Readonly<{
      constructId?: string
      dimensionKey?: CanonicalDimensionKey
      practiceType?: string
      packKey?: string
      version?: string
    }> = {},
  ): Promise<readonly MethodologyPackProjection['criteria'][number][]> {
    const matches = (await this.listPacks())
      .filter((pack) => !filter.packKey || pack.key === filter.packKey)
      .filter((pack) => !filter.version || pack.version === filter.version)
      .flatMap((pack) => pack.criteria)
      .filter((criterion) => !filter.constructId || criterion.constructKey === filter.constructId)
      .filter((criterion) => !filter.dimensionKey || criterion.dimensionKey === filter.dimensionKey)
      .filter((criterion) => !filter.practiceType || criterion.practiceType === filter.practiceType)
    return deepFreeze(matches)
  }

  private syncPack(projection: MethodologyPackProjection): void {
    const existing = this.database
      .select()
      .from(methodologyPacks)
      .where(
        and(
          eq(methodologyPacks.key, projection.key),
          eq(methodologyPacks.version, projection.version),
        ),
      )
      .get()
    if (existing) {
      if (existing.contentHash !== projection.contentHash) {
        throw new Error(
          `Methodology ${projection.key}@${projection.version} already exists with different content`,
        )
      }
      const persisted = this.loadProjection(existing.id)
      if (!sameProjection(persisted, projection)) {
        throw new Error(
          `Methodology ${projection.key}@${projection.version} persisted content does not match registry`,
        )
      }
      return
    }

    this.database.transaction((tx) => {
      tx.insert(methodologyPacks)
        .values({
          id: projection.id,
          key: projection.key,
          version: projection.version,
          title: projection.title,
          sourceType: projection.sourceType,
          sourceRef: projection.sourceRef,
          sourceFingerprint: projection.sourceFingerprint,
          contentHash: projection.contentHash,
          status: projection.status,
          createdAt: this.now().toISOString(),
        })
        .run()

      const rowIdByStableKey = new Map(
        projection.criteria.map((criterion) => [criterion.stableKey, criterion.id]),
      )
      const remaining = [...projection.criteria]
      const inserted = new Set<string>()
      while (remaining.length > 0) {
        const before = remaining.length
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const criterion = remaining[index]
          if (!criterion) continue
          if (criterion.parentStableKey && !inserted.has(criterion.parentStableKey)) continue
          const parentId = criterion.parentStableKey
            ? rowIdByStableKey.get(criterion.parentStableKey)
            : null
          if (criterion.parentStableKey && !parentId) {
            throw new Error(`Criterion ${criterion.stableKey} parent is outside its pack`)
          }
          tx.insert(methodologyCriteria)
            .values({
              id: criterion.id,
              packId: projection.id,
              stableKey: criterion.stableKey,
              parentId,
              constructKey: criterion.constructKey,
              dimensionKey: criterion.dimensionKey,
              practiceType: criterion.practiceType,
              title: criterion.title,
              description: criterion.description,
              evidenceGuidanceJson: JSON.stringify(criterion.evidenceGuidance),
              counterIndicatorsJson: JSON.stringify(criterion.counterIndicators),
              guardrailsJson: JSON.stringify({
                applicability: criterion.applicability,
                inferenceGuardrails: criterion.guardrails,
              }),
              sourceLocatorJson: JSON.stringify(criterion.sourceLocator),
              sequence: criterion.sequence,
            })
            .run()
          inserted.add(criterion.stableKey)
          remaining.splice(index, 1)
        }
        if (remaining.length === before)
          throw new Error('Criterion parent graph cannot be persisted')
      }

      for (const anchor of projection.behaviorAnchors) {
        const criterionId = rowIdByStableKey.get(anchor.criterionStableKey)
        if (!criterionId) throw new Error(`Behavior anchor ${anchor.stableKey} is outside its pack`)
        tx.insert(behaviorAnchors)
          .values({
            id: anchor.id,
            criterionId,
            levelKey: anchor.levelKey,
            label: anchor.label,
            description: anchor.description,
            sourceLocatorJson: JSON.stringify(anchor.sourceLocator),
            sequence: anchor.sequence,
          })
          .run()
      }
    })
  }

  private loadProjection(packId: string): MethodologyPackProjection {
    const pack = this.database
      .select()
      .from(methodologyPacks)
      .where(eq(methodologyPacks.id, packId))
      .get()
    if (!pack) throw new Error(`Methodology pack ${packId} not found`)

    const criterionRows = this.database
      .select()
      .from(methodologyCriteria)
      .where(eq(methodologyCriteria.packId, packId))
      .orderBy(methodologyCriteria.sequence)
      .all()
    const stableKeyByRowId = new Map(criterionRows.map((row) => [row.id, row.stableKey]))
    const criteria = criterionRows.map((row) => {
      const guardrailEnvelope = criterionGuardrailEnvelopeSchema.parse(
        parseJson(row.guardrailsJson),
      )
      return {
        id: row.id,
        stableKey: row.stableKey,
        parentStableKey: row.parentId
          ? (() => {
              const parentStableKey = stableKeyByRowId.get(row.parentId)
              if (!parentStableKey) {
                throw new Error(`Criterion ${row.stableKey} parent is outside its pack`)
              }
              return parentStableKey
            })()
          : null,
        constructKey: row.constructKey,
        dimensionKey: assertDimension(row.dimensionKey),
        practiceType: row.practiceType,
        title: row.title,
        description: row.description,
        applicability: guardrailEnvelope.applicability,
        evidenceGuidance: persistenceEvidenceGuidanceSchema.parse(
          parseJson(row.evidenceGuidanceJson),
        ),
        counterIndicators: counterIndicatorsSchema.parse(parseJson(row.counterIndicatorsJson)),
        guardrails: guardrailEnvelope.inferenceGuardrails.map((guardrail) =>
          inferenceGuardrailSchema.parse(guardrail),
        ),
        sourceLocator: sourceLocatorSchema.parse(parseJson(row.sourceLocatorJson)),
        sequence: row.sequence,
      }
    })

    const anchorRows = this.database
      .select({
        id: behaviorAnchors.id,
        criterionId: behaviorAnchors.criterionId,
        levelKey: behaviorAnchors.levelKey,
        label: behaviorAnchors.label,
        description: behaviorAnchors.description,
        sourceLocatorJson: behaviorAnchors.sourceLocatorJson,
        sequence: behaviorAnchors.sequence,
      })
      .from(behaviorAnchors)
      .innerJoin(methodologyCriteria, eq(behaviorAnchors.criterionId, methodologyCriteria.id))
      .where(eq(methodologyCriteria.packId, packId))
      .orderBy(behaviorAnchors.sequence)
      .all()

    const behaviorAnchorValues = anchorRows.map((row) => {
      const criterionStableKey = stableKeyByRowId.get(row.criterionId)
      if (!criterionStableKey) {
        throw new Error(`Behavior anchor ${row.id} has invalid criterion scope`)
      }
      return {
        id: row.id,
        stableKey: row.id.slice(`${pack.id}::`.length),
        criterionStableKey,
        levelKey: row.levelKey,
        label: row.label,
        description: row.description,
        sourceLocator: sourceLocatorSchema.parse(parseJson(row.sourceLocatorJson)),
        sequence: row.sequence,
      }
    })

    return deepFreeze({
      id: pack.id,
      key: pack.key,
      version: pack.version,
      title: pack.title,
      status: assertStatus(pack.status),
      sourceType: assertSourceType(pack.sourceType),
      sourceRef: pack.sourceRef,
      sourceFingerprint: pack.sourceFingerprint,
      contentHash: pack.contentHash,
      criteria,
      behaviorAnchors: behaviorAnchorValues,
    })
  }
}
