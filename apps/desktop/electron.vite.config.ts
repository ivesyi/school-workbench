import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const internalPackages = [
  '@school-workbench/application',
  '@school-workbench/db',
  '@school-workbench/domain',
  '@school-workbench/methodology',
  '@school-workbench/shared',
]

function copyMigrations(): Plugin {
  return {
    name: 'copy-drizzle-migrations',
    closeBundle() {
      const source = resolve(currentDirectory, '../../packages/db/drizzle')
      const destination = resolve(currentDirectory, 'out/main/drizzle')
      rmSync(destination, { recursive: true, force: true })
      mkdirSync(destination, { recursive: true })
      cpSync(source, destination, { recursive: true })
    },
  }
}

/**
 * Copies only the runtime methodology inputs next to the main bundle: each
 * `pack.json` and the source fingerprint manifest. Raw reference sources such as
 * the consultant-local PDFs must never reach build output.
 */
function copyMethodologyKnowledge(): Plugin {
  return {
    name: 'copy-methodology-knowledge',
    closeBundle() {
      const repositoryRoot = resolve(currentDirectory, '../..')
      const source = resolve(repositoryRoot, 'knowledge/methodology')
      const destination = resolve(currentDirectory, 'out/main/knowledge/methodology')
      rmSync(destination, { recursive: true, force: true })
      mkdirSync(destination, { recursive: true })
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const packFile = join(source, entry.name, 'pack.json')
        if (!existsSync(packFile)) continue
        mkdirSync(join(destination, entry.name), { recursive: true })
        cpSync(packFile, join(destination, entry.name, 'pack.json'))
      }

      const manifestDestination = resolve(currentDirectory, 'out/main/references')
      rmSync(manifestDestination, { recursive: true, force: true })
      mkdirSync(manifestDestination, { recursive: true })
      cpSync(
        resolve(repositoryRoot, 'references/SOURCE_MANIFEST.md'),
        join(manifestDestination, 'SOURCE_MANIFEST.md'),
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [copyMigrations(), copyMethodologyKnowledge()],
    build: {
      externalizeDeps: {
        exclude: internalPackages,
      },
      rollupOptions: {
        external: ['better-sqlite3'],
      },
    },
    resolve: {
      alias: Object.fromEntries(internalPackages.map((packageName) => [packageName, packageName])),
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
