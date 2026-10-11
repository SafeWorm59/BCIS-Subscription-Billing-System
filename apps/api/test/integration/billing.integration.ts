import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { createBillingRepository } from '../../src/billing/repository.js'
import { createBillingServices } from '../../src/billing/service.js'
import { getBcisTestDatabaseUrl } from '../../src/db/test-database.js'
import * as schema from '../../src/db/schema.js'

const pool = new Pool({ connectionString: getBcisTestDatabaseUrl() })
const services = createBillingServices(
  createBillingRepository(drizzle(pool, { schema }))
)

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

describe('billing PostgreSQL integration', () => {
  it('snapshots trusted plan prices and safely rejects concurrent duplicate invoices', async () => {
    const suffix = randomUUID()
    const [{ rows: subscribers }, { rows: plans }] = await Promise.all([
      pool.query<{ id: string }>(
        `insert into subscribers (name, address_line_1, city, province)
         values ($1, '1 Billing Test Road', 'Malaybalay', 'Bukidnon') returning id`,
        [`Billing ${suffix}`]
      ),
      pool.query<{ id: string }>(
        `insert into plans (name, price) values ($1, 100.00) returning id`,
        [`Billing Plan ${suffix}`]
      )
    ])
    const subscriberId = subscribers[0]?.id
    const planId = plans[0]?.id
    if (!subscriberId || !planId)
      throw new Error('Billing fixture insert failed')
    const { rows: accounts } = await pool.query<{ id: string }>(
      `insert into service_accounts (account_identifier, subscriber_id, plan_id)
       values ($1, $2, $3) returning id`,
      [`BILL-${suffix}`, subscriberId, planId]
    )
    const serviceAccountId = accounts[0]?.id
    if (!serviceAccountId)
      throw new Error('Service-account fixture insert failed')

    const summaryBefore = await services.summary({
      billingPeriodStart: '2099-01-01',
      billingPeriodEnd: '2099-01-31'
    })
    const input = {
      serviceAccountId,
      billingPeriodStart: '2099-01-01',
      issueDate: '2099-01-01',
      dueDate: '2099-01-25'
    }
    const results = await Promise.allSettled([
      services.generate(input),
      services.generate(input)
    ])
    const generated = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(generated).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const created = (
      generated[0] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof services.generate>>
      >
    ).value
    expect(created.total).toBe('100.00')
    expect(created.status).toBe('unpaid')

    await pool.query('update plans set price = 150.00 where id = $1', [planId])
    await pool.query(
      'insert into payments (invoice_id, amount, received_at) values ($1, 25.00, $2)',
      [created.id, new Date('2099-01-10T12:00:00.000Z')]
    )

    const detail = await services.get(created.id)
    expect(detail).toMatchObject({
      total: '100.00',
      amountPaid: '25.00',
      balance: '75.00',
      status: 'partially_paid',
      lineItems: [{ unitPrice: '100.00', lineTotal: '100.00' }]
    })
    const filtered = await services.list({
      page: 1,
      limit: 10,
      q: suffix,
      status: 'partially_paid',
      billingPeriodStart: '2099-01-01',
      billingPeriodEnd: '2099-01-31'
    })
    expect(filtered).toMatchObject({ total: 1, items: [{ id: created.id }] })

    const summaryAfter = await services.summary({
      billingPeriodStart: '2099-01-01',
      billingPeriodEnd: '2099-01-31'
    })
    expect(
      Number(summaryAfter.totalBilled) - Number(summaryBefore.totalBilled)
    ).toBe(100)
    expect(
      Number(summaryAfter.totalCollected) - Number(summaryBefore.totalCollected)
    ).toBe(25)
    expect(
      Number(summaryAfter.totalOutstanding) -
        Number(summaryBefore.totalOutstanding)
    ).toBe(75)
  })
})
