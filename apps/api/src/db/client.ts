import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../config/env.js'
import * as schema from './schema.js'

const pool = new Pool({ connectionString: env.DATABASE_URL })

export const database = drizzle(pool, { schema })

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('select 1')
}

export async function closeDatabaseConnection(): Promise<void> {
  await pool.end()
}
