import { SchoolService } from '@school-workbench/application'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkbenchDatabase } from './database'
import { SqliteSchoolRepository } from './sqlite-school-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SqliteSchoolRepository', () => {
  it('persists a school after the database connection is reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'school-workbench-db-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'workbench.sqlite')
    const migrationsFolder = resolve('packages/db/drizzle')

    const firstDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const firstService = new SchoolService(new SqliteSchoolRepository(firstDatabase.db))
    const created = await firstService.create({ name: '南山实验学校' })
    firstDatabase.close()

    const secondDatabase = openWorkbenchDatabase(databasePath, migrationsFolder)
    const secondService = new SchoolService(new SqliteSchoolRepository(secondDatabase.db))
    await expect(secondService.list()).resolves.toEqual([created])
    secondDatabase.close()
  })
})
