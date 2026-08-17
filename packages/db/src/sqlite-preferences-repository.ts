import type { WorkbenchDatabase } from './database'

/**
 * Reads and writes one consultant preference at a time.
 *
 * It stores strings and nothing else: what a given key is allowed to hold is
 * decided by the shared contract that both the settings UI and the main process
 * parse against, so the store never has to know about assistants.
 */
export class SqlitePreferencesRepository {
  constructor(
    private readonly database: WorkbenchDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async get(key: string): Promise<string | null> {
    const row = this.database.client
      .prepare('SELECT value FROM app_preferences WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.database.client
      .prepare(
        `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, this.now())
  }
}
