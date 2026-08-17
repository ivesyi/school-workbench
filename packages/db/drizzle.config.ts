import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: [
    './src/schema.ts',
    './src/agent-runtime-schema.ts',
    './src/methodology-schema.ts',
    './src/methodology-review-schema.ts',
    './src/diagnosis-schema.ts',
  ],
  out: './drizzle',
})
