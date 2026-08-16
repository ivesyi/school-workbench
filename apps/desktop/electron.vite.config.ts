import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

export default defineConfig({
  main: {
    plugins: [copyMigrations()],
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
