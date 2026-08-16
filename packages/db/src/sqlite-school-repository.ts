import type { School, SchoolRepository } from '@school-workbench/domain'
import { asc, eq, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { schools, type SchoolRow } from './schema'

function toDomain(row: SchoolRow): School {
  return {
    id: row.id,
    name: row.name,
    currentStageId: row.currentStageId,
    baselineSnapshotId: row.baselineSnapshotId,
    currentSnapshotId: row.currentSnapshotId,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  }
}

export class SqliteSchoolRepository implements SchoolRepository {
  constructor(private readonly database: BetterSQLite3Database) {}

  async save(school: School): Promise<void> {
    this.database.insert(schools).values(school).run()
  }

  async findById(id: string): Promise<School | null> {
    const row = this.database.select().from(schools).where(eq(schools.id, id)).get()
    return row ? toDomain(row) : null
  }

  async listActive(): Promise<School[]> {
    const rows = this.database
      .select()
      .from(schools)
      .where(isNull(schools.archivedAt))
      .orderBy(asc(schools.createdAt))
      .all()
    return rows.map(toDomain)
  }
}
