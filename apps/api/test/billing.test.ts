import Fastify from 'fastify'
import { drizzle } from 'drizzle-orm/node-postgres'
import {
  billingSummarySchema,
  invoiceListResponseSchema,
  invoiceSchema
} from '@bcis/shared'
import { describe, expect, it, vi } from 'vitest'
import type {
  AuthenticatedPrincipal,
  AuthService
} from '../src/auth/service.js'
import { BusinessError } from '../src/business/errors.js'
import { createBillingRepository } from '../src/billing/repository.js'
import { registerBillingRoutes } from '../src/billing/routes.js'
import type { BillingServices } from '../src/billing/service.js'
import { deriveInvoiceStatus } from '../src/billing/repository.js'
import * as schema from '../src/db/schema.js'

const authCookie = `bcis_session=${'a'.repeat(43)}`
const invoice = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  invoiceNumber: 'INV-202610-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  serviceAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  accountIdentifier: 'ACCT-100',
  subscriberId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  subscriberName: 'Sample Subscriber',
  planId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  planName: 'Fiber 100',
  billingPeriodStart: '2026-10-01',
  billingPeriodEnd: '2026-10-31',
  issueDate: '2026-10-01',
  dueDate: '2026-10-20',
  subtotal: '1250.50',
  total: '1250.50',
  amountPaid: '0.00',
  balance: '1250.50',
  status: 'unpaid' as const,
  lineItems: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      description: 'Monthly service plan: Fiber 100',
      quantity: 1,
      unitPrice: '1250.50',
      lineTotal: '1250.50'
    }
  ],
  createdAt: '2026-10-01T00:00:00.000Z'
}
const invoiceListItem = Object.fromEntries(
  Object.entries(invoice).filter(([key]) => key !== 'lineItems')
) as Omit<typeof invoice, 'lineItems'>
const paymentId = '99999999-9999-4999-8999-999999999999'

function paymentDatabase(
  options: {
    invoiceId?: string
    existing?: typeof schema.payments.$inferSelect | null
    aggregateAmount?: string
    concurrentPayment?: typeof schema.payments.$inferSelect | null
  } = {}
) {
  let storedPayment = options.existing ?? null
  let paymentReads = 0
  const inserted: Array<{ id: string; invoiceId: string; amount: string }> = []
  const conflictTargets: unknown[] = []
  const invoiceRow = { id: options.invoiceId ?? invoice.id, total: '1000.00' }

  const transaction = {
    select(selection?: unknown) {
      let table: unknown
      const query = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === 'then') {
              return (
                resolve: (value: unknown) => unknown,
                reject: (error: unknown) => unknown
              ) => {
                let result: unknown
                if (table === schema.invoices) result = [invoiceRow]
                else if (selection)
                  result = [{ amountPaid: options.aggregateAmount ?? '0.00' }]
                else {
                  paymentReads += 1
                  result = storedPayment ? [storedPayment] : []
                }
                return Promise.resolve(result).then(resolve, reject)
              }
            }
            if (property === 'from')
              return (nextTable: unknown) => {
                table = nextTable
                return query
              }
            return () => query
          }
        }
      )
      return query
    },
    insert() {
      return {
        values(values: { id: string; invoiceId: string; amount: string }) {
          return {
            onConflictDoNothing: ({ target }: { target: unknown }) => {
              conflictTargets.push(target)
              return {
                returning: async () => {
                  if (options.concurrentPayment) {
                    storedPayment = options.concurrentPayment
                    return []
                  }
                  inserted.push(values)
                  const row = {
                    ...values,
                    receivedAt: new Date('2026-10-11T00:00:00.000Z')
                  }
                  storedPayment = row as typeof schema.payments.$inferSelect
                  return [row]
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    database: {
      transaction: (action: (tx: typeof transaction) => unknown) =>
        action(transaction)
    } as never,
    inserted,
    conflictTargets,
    get paymentReads() {
      return paymentReads
    }
  }
}

function paymentRow(
  id: string,
  invoiceId: string,
  amount: string
): typeof schema.payments.$inferSelect {
  return {
    id,
    invoiceId,
    amount,
    receivedAt: new Date('2026-10-11T00:00:00.000Z')
  }
}

function createAuthService(
  permissions: AuthenticatedPrincipal['permissions'] | null
): AuthService {
  return {
    initialize: async () => {},
    login: async () => null,
    getSession: async () =>
      permissions
        ? {
            user: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              loginIdentifier: 'billing@example.test',
              status: 'active',
              roles: ['Administrator'],
              permissions: ['invoices.read', 'invoices.manage']
            },
            permissions
          }
        : null,
    revokeSession: async () => {}
  }
}

function createServices(
  overrides: Partial<BillingServices> = {}
): BillingServices {
  return {
    generate: vi.fn(async () => invoice),
    list: vi.fn(async () => ({ items: [invoiceListItem], total: 1 })),
    get: vi.fn(async () => invoice),
    summary: vi.fn(async () => ({
      billingPeriodStart: '2026-10-01',
      billingPeriodEnd: '2026-10-31',
      totalBilled: '1250.50',
      totalCollected: '250.00',
      totalOutstanding: '1000.50',
      unpaidInvoiceCount: 1,
      overdueInvoiceCount: 0,
      recentInvoices: [invoiceListItem]
    })),
    listPayments: vi.fn(async () => []),
    listPaymentsPage: vi.fn(async () => ({ items: [], total: 0 })),
    recordPayment: vi.fn(async (invoiceId, input) => ({
      id: input.id,
      invoiceId,
      amount: input.amount,
      receivedAt: '2026-10-11T00:00:00.000Z'
    })),
    ...overrides
  }
}

async function createApp(
  services: BillingServices,
  permissions: AuthenticatedPrincipal['permissions'] | null
) {
  const app = Fastify({ logger: false })
  app.decorateRequest('auth', null)
  await registerBillingRoutes(app, {
    services,
    authService: createAuthService(permissions)
  })
  await app.ready()
  return app
}

describe('billing API', () => {
  it('returns a generated invoice with response-schema-compatible line items', async () => {
    const source = {
      account: {
        id: invoice.serviceAccountId,
        status: 'active',
        accountIdentifier: invoice.accountIdentifier
      },
      subscriber: {
        id: invoice.subscriberId,
        name: invoice.subscriberName
      },
      plan: {
        id: invoice.planId,
        name: invoice.planName,
        price: invoice.total
      }
    }
    const invoiceRow = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      serviceAccountId: invoice.serviceAccountId,
      accountIdentifier: invoice.accountIdentifier,
      subscriberId: invoice.subscriberId,
      subscriberName: invoice.subscriberName,
      planId: invoice.planId,
      planName: invoice.planName,
      billingPeriodStart: invoice.billingPeriodStart,
      billingPeriodEnd: invoice.billingPeriodEnd,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotal: invoice.total,
      total: invoice.total,
      createdAt: new Date(invoice.createdAt)
    }
    const lineRow = {
      id: invoice.lineItems[0]!.id,
      invoiceId: invoice.id,
      description: invoice.lineItems[0]!.description,
      quantity: invoice.lineItems[0]!.quantity,
      unitPrice: invoice.lineItems[0]!.unitPrice,
      lineTotal: invoice.lineItems[0]!.lineTotal
    }
    let insertTable: unknown
    const transaction = {
      select: () => {
        const query = {
          from: () => query,
          innerJoin: () => query,
          where: () => query,
          limit: async () => [source]
        }
        return query
      },
      insert: (table: unknown) => {
        insertTable = table
        return {
          values: () => ({
            returning: async () =>
              insertTable === schema.invoices ? [invoiceRow] : [lineRow]
          })
        }
      }
    }
    const database = {
      transaction: async (action: (tx: typeof transaction) => unknown) =>
        action(transaction)
    } as never

    const repository = createBillingRepository(database)
    const generated = await repository.generate({
      serviceAccountId: invoice.serviceAccountId,
      billingPeriodStart: invoice.billingPeriodStart,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate
    })

    expect(() => invoiceSchema.parse(generated)).not.toThrow()
    expect(generated.lineItems[0]).not.toHaveProperty('invoiceId')

    const detailDatabase = {
      select: () => {
        let table: unknown
        const query = new Proxy(
          {},
          {
            get(_target, property) {
              if (property === 'then') {
                return (
                  resolve: (value: unknown) => unknown,
                  reject: (error: unknown) => unknown
                ) => {
                  const result =
                    table === schema.invoices
                      ? [invoiceRow]
                      : table === schema.payments
                        ? [{ amountPaid: '0.00' }]
                        : [lineRow]
                  return Promise.resolve(result).then(resolve, reject)
                }
              }
              if (property === 'from')
                return (nextTable: unknown) => {
                  table = nextTable
                  return query
                }
              return () => query
            }
          }
        )
        return query
      }
    } as never
    const detail = await createBillingRepository(detailDatabase).get(invoice.id)
    expect(() => invoiceSchema.parse(detail)).not.toThrow()
  })

  it('returns schema-compatible invoice list and summary items', async () => {
    const listRow = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      serviceAccountId: invoice.serviceAccountId,
      accountIdentifier: invoice.accountIdentifier,
      subscriberId: invoice.subscriberId,
      subscriberName: invoice.subscriberName,
      planId: invoice.planId,
      planName: invoice.planName,
      billingPeriodStart: invoice.billingPeriodStart,
      billingPeriodEnd: invoice.billingPeriodEnd,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotal: invoice.total,
      total: invoice.total,
      createdAt: new Date(invoice.createdAt),
      amountPaid: '250.00'
    }
    const filteredInvoices = { queryName: 'filtered_invoices' }
    const periodInvoices = { queryName: 'period_invoices' }
    const database = {
      select: (selection?: unknown) => {
        let source: unknown
        const query = new Proxy(
          {},
          {
            get(_target, property) {
              if (property === 'then') {
                return (
                  resolve: (value: unknown) => unknown,
                  reject: (error: unknown) => unknown
                ) => {
                  const result =
                    source === filteredInvoices
                      ? selection
                        ? [{ total: 1 }]
                        : [listRow]
                      : source === periodInvoices
                        ? []
                        : source === schema.payments
                          ? [{ totalCollected: '250.00' }]
                          : []
                  return Promise.resolve(result).then(resolve, reject)
                }
              }
              if (property === 'from')
                return (nextSource: unknown) => {
                  source = nextSource
                  return query
                }
              if (property === 'as')
                return (queryName: string) =>
                  queryName === 'filtered_invoices'
                    ? filteredInvoices
                    : periodInvoices
              return () => query
            }
          }
        )
        return query
      }
    } as never
    const repository = createBillingRepository(database)

    const list = await repository.list({ page: 1, limit: 10 })
    expect(() =>
      invoiceListResponseSchema.parse({
        ...list,
        page: 1,
        limit: 10
      })
    ).not.toThrow()
    expect(list.items[0]).not.toHaveProperty('invoiceId')

    const summary = await repository.summary({
      billingPeriodStart: '2026-10-01',
      billingPeriodEnd: '2026-10-31'
    })
    expect(() => billingSummarySchema.parse(summary)).not.toThrow()
    expect(summary.recentInvoices[0]).not.toHaveProperty('invoiceId')
  })

  it('returns an existing payment for the same id, invoice, and amount', async () => {
    const fake = paymentDatabase({
      existing: paymentRow(paymentId, invoice.id, '250.00')
    })
    const repository = createBillingRepository(fake.database)
    await expect(
      repository.recordPayment(invoice.id, { id: paymentId, amount: '250.00' })
    ).resolves.toMatchObject({
      id: paymentId,
      invoiceId: invoice.id,
      amount: '250.00'
    })
    expect(fake.inserted).toHaveLength(0)
  })

  it.each([
    ['amount', invoice.id, '251.00'],
    ['invoice', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '250.00']
  ])(
    'rejects reusing a payment ID with a different %s',
    async (_kind, targetInvoice, amount) => {
      const fake = paymentDatabase({
        invoiceId: targetInvoice,
        existing: paymentRow(paymentId, invoice.id, '250.00')
      })
      const repository = createBillingRepository(fake.database)
      await expect(
        repository.recordPayment(targetInvoice, { id: paymentId, amount })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(fake.inserted).toHaveLength(0)
    }
  )

  it('inserts a separate payment for a new ID while preserving the balance check', async () => {
    const fake = paymentDatabase({ aggregateAmount: '250.00' })
    const repository = createBillingRepository(fake.database)
    await expect(
      repository.recordPayment(invoice.id, {
        id: '88888888-8888-4888-8888-888888888888',
        amount: '250.00'
      })
    ).resolves.toMatchObject({ invoiceId: invoice.id, amount: '250.00' })
    expect(fake.inserted).toEqual([
      {
        id: '88888888-8888-4888-8888-888888888888',
        invoiceId: invoice.id,
        amount: '250.00'
      }
    ])
    expect(fake.conflictTargets).toHaveLength(1)

    const overpayment = paymentDatabase({ aggregateAmount: '990.00' })
    await expect(
      createBillingRepository(overpayment.database).recordPayment(invoice.id, {
        id: '77777777-7777-4777-8777-777777777777',
        amount: '20.00'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(overpayment.inserted).toHaveLength(0)
  })

  it('resolves a concurrent insert conflict only when the committed payment matches', async () => {
    const matching = paymentRow(paymentId, invoice.id, '250.00')
    const fake = paymentDatabase({ concurrentPayment: matching })
    await expect(
      createBillingRepository(fake.database).recordPayment(invoice.id, {
        id: paymentId,
        amount: '250.00'
      })
    ).resolves.toMatchObject({ id: paymentId, amount: '250.00' })
    expect(fake.inserted).toHaveLength(0)
    expect(fake.paymentReads).toBe(2)

    const mismatched = paymentDatabase({
      concurrentPayment: paymentRow(
        paymentId,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '250.00'
      )
    })
    await expect(
      createBillingRepository(mismatched.database).recordPayment(invoice.id, {
        id: paymentId,
        amount: '250.00'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('builds invoice list and summary subqueries with named payment aggregates', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    const repository = createBillingRepository(
      drizzle(client as never, { schema })
    )
    const period = {
      billingPeriodStart: '2026-10-01',
      billingPeriodEnd: '2026-10-31'
    }

    await expect(
      repository.list({ page: 1, limit: 10, ...period })
    ).resolves.toMatchObject({
      items: [],
      total: 0
    })
    await expect(repository.summary(period)).resolves.toMatchObject({
      ...period,
      totalBilled: '0.00',
      totalCollected: '0.00',
      totalOutstanding: '0.00',
      unpaidInvoiceCount: 0,
      overdueInvoiceCount: 0
    })
  })

  it('builds the payment feed with invoice search and inclusive date bounds', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    const repository = createBillingRepository(
      drizzle(client as never, { schema })
    )
    await expect(
      repository.listPaymentsPage({
        page: 2,
        limit: 25,
        q: 'Jamie',
        receivedAtStart: '2026-10-01',
        receivedAtEnd: '2026-10-31'
      })
    ).resolves.toEqual({ items: [], total: 0 })
    expect(client.query).toHaveBeenCalledTimes(2)
    const sqlText = client.query.mock.calls
      .map(([statement]) =>
        typeof statement === 'string' ? statement : statement.text
      )
      .join('\n')
    expect(sqlText).toContain('inner join "invoices"')
    expect(sqlText).toContain('"received_at" >=')
    expect(sqlText).toContain('"received_at" <')
    expect(sqlText).toContain('"subscriber_name_snapshot" ilike')
  })

  it('generates a price-snapshotted invoice with no payment assumed', async () => {
    const services = createServices()
    const app = await createApp(services, ['invoices.manage'])
    const response = await app.inject({
      method: 'POST',
      url: '/invoices/generate',
      headers: { cookie: authCookie },
      payload: {
        serviceAccountId: invoice.serviceAccountId,
        billingPeriodStart: '2026-10-01',
        issueDate: '2026-10-01',
        dueDate: '2026-10-20'
      }
    })

    expect(response.statusCode).toBe(201)
    expect(services.generate).toHaveBeenCalledWith({
      serviceAccountId: invoice.serviceAccountId,
      billingPeriodStart: '2026-10-01',
      issueDate: '2026-10-01',
      dueDate: '2026-10-20'
    })
    expect(response.json()).toMatchObject({
      total: '1250.50',
      amountPaid: '0.00',
      balance: '1250.50',
      status: 'unpaid',
      lineItems: [{ unitPrice: '1250.50', lineTotal: '1250.50' }]
    })
    await app.close()
  })

  it('validates billing dates and reports missing or duplicate service-account invoices', async () => {
    const invalidApp = await createApp(createServices(), ['invoices.manage'])
    const invalid = await invalidApp.inject({
      method: 'POST',
      url: '/invoices/generate',
      headers: { cookie: authCookie },
      payload: {
        serviceAccountId: invoice.serviceAccountId,
        billingPeriodStart: '2026-10-02',
        issueDate: '2026-10-01',
        dueDate: '2026-09-30'
      }
    })
    expect(invalid.statusCode).toBe(400)
    await invalidApp.close()

    const missingApp = await createApp(
      createServices({
        generate: async () => {
          throw new BusinessError('Service account not found', 404)
        }
      }),
      ['invoices.manage']
    )
    const basePayload = {
      serviceAccountId: invoice.serviceAccountId,
      billingPeriodStart: '2026-10-01',
      issueDate: '2026-10-01',
      dueDate: '2026-10-20'
    }
    const missing = await missingApp.inject({
      method: 'POST',
      url: '/invoices/generate',
      headers: { cookie: authCookie },
      payload: basePayload
    })
    expect(missing.statusCode).toBe(404)
    await missingApp.close()

    const duplicateApp = await createApp(
      createServices({
        generate: async () => {
          throw new BusinessError(
            'An invoice already exists for this service account and billing period',
            409
          )
        }
      }),
      ['invoices.manage']
    )
    const duplicate = await duplicateApp.inject({
      method: 'POST',
      url: '/invoices/generate',
      headers: { cookie: authCookie },
      payload: basePayload
    })
    expect(duplicate.statusCode).toBe(409)
    await duplicateApp.close()
  })

  it('requires invoice permissions and validates list/detail/summary requests', async () => {
    const anonymousApp = await createApp(createServices(), null)
    expect((await anonymousApp.inject({ url: '/invoices' })).statusCode).toBe(
      401
    )
    await anonymousApp.close()

    const readApp = await createApp(createServices(), ['invoices.read'])
    const headers = { cookie: authCookie }
    const [list, detail, summary, badSummary] = await Promise.all([
      readApp.inject({
        url: '/invoices?page=1&limit=10&status=unpaid&billingPeriodStart=2026-10-01&billingPeriodEnd=2026-10-31&q=Sample',
        headers
      }),
      readApp.inject({ url: `/invoices/${invoice.id}`, headers }),
      readApp.inject({
        url: '/billing/summary?billingPeriodStart=2026-10-01&billingPeriodEnd=2026-10-31',
        headers
      }),
      readApp.inject({
        url: '/billing/summary?billingPeriodStart=2026-10-02&billingPeriodEnd=2026-10-31',
        headers
      })
    ])
    expect(list.statusCode).toBe(200)
    expect(detail.statusCode).toBe(200)
    expect(summary.json()).toMatchObject({
      totalBilled: '1250.50',
      totalCollected: '250.00',
      totalOutstanding: '1000.50'
    })
    expect(badSummary.statusCode).toBe(400)
    await readApp.close()
  })

  it('accepts the all-period outstanding filter without weakening invoice response validation', async () => {
    const services = createServices()
    const app = await createApp(services, ['invoices.read'])
    const response = await app.inject({
      url: '/invoices?page=1&limit=10&status=outstanding',
      headers: { cookie: authCookie }
    })
    expect(response.statusCode).toBe(200)
    expect(services.list).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      status: 'outstanding'
    })
    await app.close()
  })

  it('lists payment history for readers and records only valid payments for managers', async () => {
    const services = createServices()
    const reader = await createApp(services, ['invoices.read'])
    const denied = await reader.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { cookie: authCookie },
      payload: { id: paymentId, amount: '250.00' }
    })
    expect(denied.statusCode).toBe(403)
    const history = await reader.inject({
      url: `/invoices/${invoice.id}/payments`,
      headers: { cookie: authCookie }
    })
    expect(history.statusCode).toBe(200)
    await reader.close()

    const manager = await createApp(services, ['invoices.manage'])
    const invalid = await manager.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { cookie: authCookie },
      payload: { id: paymentId, amount: '0.00' }
    })
    expect(invalid.statusCode).toBe(400)
    const recorded = await manager.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/payments`,
      headers: { cookie: authCookie },
      payload: { id: paymentId, amount: '250.00' }
    })
    expect(recorded.statusCode).toBe(201)
    expect(services.recordPayment).toHaveBeenCalledWith(invoice.id, {
      id: paymentId,
      amount: '250.00'
    })
    await manager.close()
  })

  it('lists paginated payments with validated date filters for invoice readers', async () => {
    const services = createServices()
    const reader = await createApp(services, ['invoices.read'])
    const response = await reader.inject({
      url: '/payments?page=2&limit=10&q=Sample&receivedAtStart=2026-10-01&receivedAtEnd=2026-10-31',
      headers: { cookie: authCookie }
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ items: [], page: 2, limit: 10, total: 0 })
    expect(services.listPaymentsPage).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      q: 'Sample',
      receivedAtStart: '2026-10-01',
      receivedAtEnd: '2026-10-31'
    })

    const invalidRange = await reader.inject({
      url: '/payments?receivedAtStart=2026-11-01&receivedAtEnd=2026-10-01',
      headers: { cookie: authCookie }
    })
    expect(invalidRange.statusCode).toBe(400)
    await reader.close()

    const anonymous = await createApp(services, null)
    expect((await anonymous.inject({ url: '/payments' })).statusCode).toBe(401)
    await anonymous.close()
  })

  it('rejects invoice generation without the manage permission', async () => {
    const app = await createApp(createServices(), ['invoices.read'])
    const response = await app.inject({
      method: 'POST',
      url: '/invoices/generate',
      headers: { cookie: authCookie },
      payload: {
        serviceAccountId: invoice.serviceAccountId,
        billingPeriodStart: '2026-10-01',
        issueDate: '2026-10-01',
        dueDate: '2026-10-20'
      }
    })
    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('derives paid, partial, unpaid, and overdue statuses from amount and due date', () => {
    expect(
      deriveInvoiceStatus('100.00', '100.00', '2026-10-01', '2026-10-10')
    ).toBe('paid')
    expect(
      deriveInvoiceStatus('100.00', '25.00', '2026-10-20', '2026-10-10')
    ).toBe('partially_paid')
    expect(
      deriveInvoiceStatus('100.00', '0.00', '2026-10-20', '2026-10-10')
    ).toBe('unpaid')
    expect(
      deriveInvoiceStatus('100.00', '25.00', '2026-10-01', '2026-10-10')
    ).toBe('overdue')
    expect(
      deriveInvoiceStatus('100.00', '100.00', '2026-10-01', '2026-10-10')
    ).not.toBe('overdue')
  })
})
