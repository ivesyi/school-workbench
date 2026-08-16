import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/schema.ts', './src/methodology-schema.ts'],
  out: './drizzle',
})
