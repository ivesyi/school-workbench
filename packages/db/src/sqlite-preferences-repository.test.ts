import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase, type WorkbenchDatabase } from './database'
import { SqlitePreferencesRepository } from './sqlite-preferences-repository'

const migrationsFolder = resolve('packages/db/drizzle')

let database: WorkbenchDatabase

beforeEach(() => {
  database = openWorkbenchDatabase(':memory:', migrationsFolder)
})

afterEach(() => database.close())

describe('consultant preferences', () => {
  it('starts empty so an unset preference is distinguishable from a chosen one', async () => {
    const repository = new SqlitePreferencesRepository(database)
    expect(await repository.get('default_assistant')).toBeNull()
  })

  it('keeps the latest answer for a key', async () => {
    const repository = new SqlitePreferencesRepository(database, () => '2026-08-18T00:00:00.000Z')

    await repository.set('default_assistant', 'codex')
    expect(await repository.get('default_assistant')).toBe('codex')

    await repository.set('default_assistant', 'none')
    expect(await repository.get('default_assistant')).toBe('none')

    const rows = database.client.prepare('SELECT count(*) AS count FROM app_preferences').get() as {
      count: number
    }
    expect(rows.count).toBe(1)
  })

  it('survives a restart', async () => {
    // The point of the table: a choice made once is not asked about again.
    const directory = mkdtempSync(join(tmpdir(), 'workbench-preferences-'))
    const file = join(directory, 'workbench.sqlite')
    try {
      const first = openWorkbenchDatabase(file, migrationsFolder)
      try {
        await new SqlitePreferencesRepository(first).set('default_assistant', 'codex')
      } finally {
        first.close()
      }

      const second = openWorkbenchDatabase(file, migrationsFolder)
      try {
        expect(await new SqlitePreferencesRepository(second).get('default_assistant')).toBe('codex')
      } finally {
        second.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('is added by a forward-only migration that seeds nothing', () => {
    const file = readdirSync(migrationsFolder).find((name) => /^0010_.*\.sql$/u.test(name))
    expect(file).toBeDefined()
    const sql = readFileSync(resolve(migrationsFolder, file ?? ''), 'utf8')
    expect(sql).toContain('CREATE TABLE `app_preferences`')
    expect(sql).not.toMatch(/\bINSERT\b/iu)
    expect(sql).not.toMatch(/\bDROP\b/iu)
  })
})
