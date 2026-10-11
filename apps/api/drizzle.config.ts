import { resolve } from 'node:path'
import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'

const isGenerating = process.argv.includes('generate')

if (!isGenerating) {
  dotenv.config({ path: resolve(process.cwd(), '.env') })
  dotenv.config({ path: resolve(process.cwd(), '../../.env') })
}

const databaseUrl = process.env.DATABASE_URL

if (!isGenerating && !databaseUrl) {
  throw new Error('DATABASE_URL is required for Drizzle database commands')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../database/migrations',
  ...(!isGenerating && databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : {})
})
