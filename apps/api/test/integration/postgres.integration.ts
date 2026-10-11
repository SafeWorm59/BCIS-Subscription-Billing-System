import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  createDatabaseLoginRateLimitStore,
  createLoginRateLimiter
} from '../../src/auth/rate-limit.js'
import { getBcisTestDatabaseUrl } from '../../src/db/test-database.js'
import * as schema from '../../src/db/schema.js'

const databaseUrl = getBcisTestDatabaseUrl()
const expectedTables = [
  'login_rate_limit_buckets',
  'invoices',
  'invoice_items',
  'payments',
  'permissions',
  'plans',
  'role_permissions',
  'roles',
  'service_accounts',
  'sessions',
  'subscribers',
  'user_roles',
  'users'
]

const pool = new Pool({ connectionString: databaseUrl })

beforeAll(async () => {
  const { rows } = await pool.query<{
    current_database: string
    current_user: string
  }>('select current_database(), current_user')

  expect(rows[0]).toEqual({
    current_database: 'bcis_subscription_billing_test',
    current_user: 'bcis_subscription_billing_test'
  })
})

afterAll(async () => {
  await pool.end()
})

describe('isolated PostgreSQL integration', () => {
  it('has the authentication and rate-limit tables from the migrations', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])`,
      [expectedTables]
    )

    expect(rows.map(({ table_name }) => table_name).sort()).toEqual(
      [...expectedTables].sort()
    )
  })

  it('has the business keys, decimal price column, and history-preserving foreign keys', async () => {
    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])`,
      [
        [
          'service_accounts_identifier_unique',
          'service_accounts_subscriber_id_idx',
          'service_accounts_plan_id_idx'
        ]
      ]
    )
    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual(
      [
        'service_accounts_identifier_unique',
        'service_accounts_subscriber_id_idx',
        'service_accounts_plan_id_idx'
      ].sort()
    )

    const { rows: priceColumns } = await pool.query<{
      data_type: string
      numeric_precision: number
      numeric_scale: number
    }>(
      `select data_type, numeric_precision, numeric_scale
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'plans'
         and column_name = 'price'`
    )
    expect(priceColumns).toEqual([
      { data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 }
    ])

    const { rows: foreignKeys } = await pool.query<{
      constraint_name: string
      delete_action: string
    }>(
      `select constraint_row.conname as constraint_name,
              constraint_row.confdeltype as delete_action
       from pg_constraint as constraint_row
       join pg_class as table_row on table_row.oid = constraint_row.conrelid
       where table_row.relname = 'service_accounts'
         and constraint_row.contype = 'f'
       order by constraint_row.conname`
    )
    expect(foreignKeys).toHaveLength(2)
    expect(
      foreignKeys.every(({ delete_action }) => delete_action === 'r')
    ).toBe(true)
  })

  it('persists login rate-limit increments in PostgreSQL', async () => {
    const limiter = createLoginRateLimiter(
      createDatabaseLoginRateLimitStore(drizzle(pool, { schema })),
      { maxAttempts: 2, windowMs: 60_000 }
    )
    const identifier = `integration-${randomUUID()}@example.test`

    expect(await limiter.check('127.0.0.1', identifier)).toBeNull()
    expect(await limiter.check('127.0.0.1', identifier)).toBeNull()
    expect(await limiter.check('127.0.0.1', identifier)).toBeGreaterThan(0)
  })

  it('enforces unique service-account identifiers and existing parent records', async () => {
    const suffix = randomUUID()
    const { rows: subscribersCreated } = await pool.query<{ id: string }>(
      `insert into subscribers (name, address_line_1, city, province)
       values ($1, '1 Integration Street', 'Malaybalay', 'Bukidnon')
       returning id`,
      [`Integration ${suffix}`]
    )
    const { rows: plansCreated } = await pool.query<{ id: string }>(
      `insert into plans (name, price)
       values ($1, 10.00)
       returning id`,
      [`Integration ${suffix}`]
    )
    const subscriberId = subscribersCreated[0]?.id
    const planId = plansCreated[0]?.id
    if (!subscriberId || !planId) {
      throw new Error('Integration fixture insert returned no id')
    }

    await pool.query(
      `insert into service_accounts
         (account_identifier, subscriber_id, plan_id)
       values ($1, $2, $3)`,
      [`INTEGRATION-${suffix}`, subscriberId, planId]
    )

    await expect(
      pool.query(
        `insert into service_accounts
           (account_identifier, subscriber_id, plan_id)
         values ($1, $2, $3)`,
        [`INTEGRATION-${suffix}`, subscriberId, planId]
      )
    ).rejects.toMatchObject({ code: '23505' })

    await expect(
      pool.query(
        `insert into service_accounts
             (account_identifier, subscriber_id, plan_id)
           values ($1, $2, $3)`,
        [`MISSING-${suffix}`, randomUUID(), planId]
      )
    ).rejects.toMatchObject({ code: '23503' })
  })
})
