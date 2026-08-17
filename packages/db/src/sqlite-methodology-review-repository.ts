import {
  deepFreeze,
  packReviewSignOffSchema,
  type MethodologyReviewRepository,
  type PackReviewSignOff,
} from '@school-workbench/methodology'
import { and, desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  methodologyPackCriterionVerdicts,
  methodologyPackSignOffs,
} from './methodology-review-schema'

export class SqliteMethodologyReviewRepository implements MethodologyReviewRepository {
  constructor(
    private readonly database: BetterSQLite3Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordSignOff(signOff: PackReviewSignOff): Promise<void> {
    const parsed = packReviewSignOffSchema.parse(signOff)
    const existing = this.database
      .select({ id: methodologyPackSignOffs.id })
      .from(methodologyPackSignOffs)
      .where(eq(methodologyPackSignOffs.id, parsed.id))
      .get()
    if (existing) throw new Error(`Methodology review sign-off ${parsed.id} already exists`)

    this.database.transaction((tx) => {
      tx.insert(methodologyPackSignOffs)
        .values({
          id: parsed.id,
          packKey: parsed.packKey,
          packVersion: parsed.packVersion,
          contentHash: parsed.contentHash,
          decision: parsed.decision,
          note: parsed.note,
          signedAt: parsed.signedAt,
          createdAt: this.now().toISOString(),
        })
        .run()

      parsed.verdicts.forEach((verdict, index) => {
        tx.insert(methodologyPackCriterionVerdicts)
          .values({
            id: `${parsed.id}::${index + 1}`,
            signOffId: parsed.id,
            criterionStableKey: verdict.criterionStableKey,
            verdict: verdict.verdict,
            note: verdict.note,
            sequence: index + 1,
          })
          .run()
      })
    })
  }

  /**
   * Returns the most recent sign-off for the pack version, whatever content it
   * was made against. Callers compare `contentHash` themselves so a stale review
   * is visible rather than silently reused.
   */
  async getLatestSignOff(packKey: string, packVersion: string): Promise<PackReviewSignOff | null> {
    const row = this.database
      .select()
      .from(methodologyPackSignOffs)
      .where(
        and(
          eq(methodologyPackSignOffs.packKey, packKey),
          eq(methodologyPackSignOffs.packVersion, packVersion),
        ),
      )
      .orderBy(desc(methodologyPackSignOffs.signedAt), desc(methodologyPackSignOffs.id))
      .limit(1)
      .get()
    if (!row) return null

    const verdictRows = this.database
      .select()
      .from(methodologyPackCriterionVerdicts)
      .where(eq(methodologyPackCriterionVerdicts.signOffId, row.id))
      .orderBy(methodologyPackCriterionVerdicts.sequence)
      .all()

    return deepFreeze(
      packReviewSignOffSchema.parse({
        id: row.id,
        packKey: row.packKey,
        packVersion: row.packVersion,
        contentHash: row.contentHash,
        decision: row.decision,
        note: row.note,
        signedAt: row.signedAt,
        verdicts: verdictRows.map((verdict) => ({
          criterionStableKey: verdict.criterionStableKey,
          verdict: verdict.verdict,
          note: verdict.note,
        })),
      }),
    ) as PackReviewSignOff
  }
}
