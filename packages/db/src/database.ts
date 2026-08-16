import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export type WorkbenchDatabase = {
  client: Database.Database
  db: BetterSQLite3Database
  close(): void
}

export function openWorkbenchDatabase(
  filePath: string,
  migrationsFolder: string,
): WorkbenchDatabase {
  const client = new Database(filePath)
  client.pragma('foreign_keys = ON')
  client.pragma('journal_mode = WAL')
  client.pragma('busy_timeout = 5000')

  const db = drizzle(client)
  migrate(db, { migrationsFolder })

  return {
    client,
    db,
    close: () => client.close(),
  }
}
