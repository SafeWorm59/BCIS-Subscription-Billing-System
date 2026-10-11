import { defineConfig } from 'drizzle-kit'
import { getBcisTestDatabaseUrl } from './src/db/test-database.js'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../database/migrations',
  dbCredentials: { url: getBcisTestDatabaseUrl() }
})
