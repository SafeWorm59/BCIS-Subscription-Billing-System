import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type {
  BillingSummary,
  BillingSummaryQuery,
  Invoice,
  InvoiceGenerate,
  InvoiceListItem,
  InvoiceListQuery,
  Payment,
  PaymentCreate,
  PaymentListItem,
  PaymentListQuery
} from '@bcis/shared'
import * as schema from '../db/schema.js'
import {
  invoiceItems,
  invoices,
  payments,
  plans,
  serviceAccounts,
  subscribers
} from '../db/schema.js'
import { BusinessError, translateDatabaseError } from '../business/errors.js'

type Database = NodePgDatabase<typeof schema>

export interface BillingRepository {
  generate(input: InvoiceGenerate): Promise<Invoice>
  list(
    query: InvoiceListQuery
  ): Promise<{ items: InvoiceListItem[]; total: number }>
  get(id: string): Promise<Invoice | null>
  summary(query: BillingSummaryQuery): Promise<BillingSummary>
  listPayments(invoiceId: string): Promise<Payment[]>
  listPaymentsPage(
    query: PaymentListQuery
  ): Promise<{ items: PaymentListItem[]; total: number }>
  recordPayment(invoiceId: string, input: PaymentCreate): Promise<Payment>
}

function periodEnd(start: string): string {
  const [year, month] = start.split('-').map(Number)
  const day = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return `${start.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

function moneyCents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
}

function centsMoney(value: bigint): string {
  const absolute = value < 0n ? -value : value
  const formatted = `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
  return value < 0n ? `-${formatted}` : formatted
}

export function deriveInvoiceStatus(
  total: string,
  amountPaid: string,
  dueDate: string,
  today = new Date().toISOString().slice(0, 10)
): Invoice['status'] {
  const paid = moneyCents(amountPaid)
  const amount = moneyCents(total)
  if (paid >= amount) return 'paid'
  if (dueDate < today) return 'overdue'
  if (paid > 0n) return 'partially_paid'
  return 'unpaid'
}

function invoiceListItem(
  row: typeof invoices.$inferSelect,
  amountPaid: string
): InvoiceListItem {
  const total = row.total
  const paid = moneyCents(amountPaid)
  const balance = moneyCents(total) - paid
  return {
    ...row,
    amountPaid,
    balance: centsMoney(balance > 0n ? balance : 0n),
    status: deriveInvoiceStatus(total, amountPaid, row.dueDate),
    createdAt: row.createdAt.toISOString()
  }
}

function invoiceLineItem(row: typeof invoiceItems.$inferSelect) {
  return {
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal
  }
}

function databaseError(error: unknown): never {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'invoices_service_account_period_unique'
  ) {
    throw new BusinessError(
      'An invoice already exists for this service account and billing period',
      409
    )
  }
  const translated = translateDatabaseError(error)
  if (translated) throw translated
  throw error
}

export function createBillingRepository(database: Database): BillingRepository {
  return {
    async listPayments(invoiceId) {
      const rows = await database
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId))
        .orderBy(desc(payments.receivedAt), desc(payments.id))
      return rows.map((row) => ({
        ...row,
        receivedAt: row.receivedAt.toISOString()
      }))
    },

    async listPaymentsPage(query) {
      const filters: SQL[] = []
      if (query.q) {
        const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`
        filters.push(
          or(
            ilike(invoices.invoiceNumber, term),
            ilike(invoices.subscriberName, term),
            ilike(invoices.accountIdentifier, term)
          )!
        )
      }
      if (query.receivedAtStart) {
        filters.push(
          gte(
            payments.receivedAt,
            new Date(`${query.receivedAtStart}T00:00:00.000Z`)
          )
        )
      }
      if (query.receivedAtEnd) {
        const endExclusive = new Date(`${query.receivedAtEnd}T00:00:00.000Z`)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        filters.push(lt(payments.receivedAt, endExclusive))
      }
      const where = filters.length ? and(...filters) : undefined
      const [rows, [totalRow]] = await Promise.all([
        database
          .select({
            id: payments.id,
            invoiceId: payments.invoiceId,
            invoiceNumber: invoices.invoiceNumber,
            accountIdentifier: invoices.accountIdentifier,
            subscriberName: invoices.subscriberName,
            amount: payments.amount,
            receivedAt: payments.receivedAt
          })
          .from(payments)
          .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
          .where(where)
          .orderBy(desc(payments.receivedAt), desc(payments.id))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        database
          .select({ total: count() })
          .from(payments)
          .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
          .where(where)
      ])
      return {
        items: rows.map((row) => ({
          ...row,
          receivedAt: row.receivedAt.toISOString()
        })),
        total: totalRow?.total ?? 0
      }
    },

    async recordPayment(invoiceId, input) {
      return database.transaction(
        async (transaction) => {
          const [invoice] = await transaction
            .select()
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .for('update')
            .limit(1)
          if (!invoice) throw new BusinessError('Invoice not found', 404)

          const samePayment = (
            payment: typeof payments.$inferSelect
          ): boolean =>
            payment.invoiceId === invoiceId &&
            moneyCents(payment.amount) === moneyCents(input.amount)
          const [existing] = await transaction
            .select()
            .from(payments)
            .where(eq(payments.id, input.id))
            .limit(1)
          if (existing) {
            if (!samePayment(existing)) {
              throw new BusinessError(
                'Payment request ID is already in use',
                409
              )
            }
            return {
              ...existing,
              receivedAt: existing.receivedAt.toISOString()
            }
          }

          const [aggregate] = await transaction
            .select({
              amountPaid: sql<string>`COALESCE(SUM(${payments.amount}), 0)::numeric(12, 2)`
            })
            .from(payments)
            .where(eq(payments.invoiceId, invoiceId))
          const balance =
            moneyCents(invoice.total) -
            moneyCents(aggregate?.amountPaid ?? '0.00')
          if (balance <= 0n)
            throw new BusinessError('Invoice is already paid', 409)
          if (moneyCents(input.amount) > balance) {
            throw new BusinessError(
              'Payment exceeds the outstanding balance',
              409
            )
          }
          const [row] = await transaction
            .insert(payments)
            .values({ id: input.id, invoiceId, amount: input.amount })
            .onConflictDoNothing({ target: payments.id })
            .returning()
          if (!row) {
            // A concurrent request may have inserted this ID under another invoice lock.
            // The next statement gets a fresh READ COMMITTED snapshot of that committed row.
            const [concurrentPayment] = await transaction
              .select()
              .from(payments)
              .where(eq(payments.id, input.id))
              .limit(1)
            if (!concurrentPayment || !samePayment(concurrentPayment)) {
              throw new BusinessError(
                'Payment request ID is already in use',
                409
              )
            }
            return {
              ...concurrentPayment,
              receivedAt: concurrentPayment.receivedAt.toISOString()
            }
          }
          return { ...row, receivedAt: row.receivedAt.toISOString() }
        },
        { isolationLevel: 'read committed' }
      )
    },

    async generate(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [source] = await transaction
            .select({
              account: serviceAccounts,
              subscriber: subscribers,
              plan: plans
            })
            .from(serviceAccounts)
            .innerJoin(
              subscribers,
              eq(serviceAccounts.subscriberId, subscribers.id)
            )
            .innerJoin(plans, eq(serviceAccounts.planId, plans.id))
            .where(eq(serviceAccounts.id, input.serviceAccountId))
            .limit(1)

          if (!source) throw new BusinessError('Service account not found', 404)
          if (source.account.status !== 'active') {
            throw new BusinessError(
              'Only active service accounts can be invoiced',
              409
            )
          }
          if (moneyCents(source.plan.price) === 0n) {
            throw new BusinessError(
              'A zero-price plan cannot produce a payable invoice',
              409
            )
          }

          const id = randomUUID()
          const total = source.plan.price
          const end = periodEnd(input.billingPeriodStart)
          const invoiceNumber = `INV-${input.billingPeriodStart.slice(0, 7).replace('-', '')}-${id}`
          const [row] = await transaction
            .insert(invoices)
            .values({
              id,
              invoiceNumber,
              serviceAccountId: source.account.id,
              accountIdentifier: source.account.accountIdentifier,
              subscriberId: source.subscriber.id,
              subscriberName: source.subscriber.name,
              planId: source.plan.id,
              planName: source.plan.name,
              billingPeriodStart: input.billingPeriodStart,
              billingPeriodEnd: end,
              issueDate: input.issueDate,
              dueDate: input.dueDate,
              subtotal: total,
              total
            })
            .returning()
          if (!row) throw new Error('Invoice insert returned no row')

          const [line] = await transaction
            .insert(invoiceItems)
            .values({
              invoiceId: row.id,
              description: `Monthly service plan: ${source.plan.name}`,
              quantity: 1,
              unitPrice: total,
              lineTotal: total
            })
            .returning()
          if (!line) throw new Error('Invoice line insert returned no row')

          return {
            ...invoiceListItem(row, '0.00'),
            lineItems: [invoiceLineItem(line)]
          }
        })
      } catch (error) {
        return databaseError(error)
      }
    },

    async list(query) {
      const filters: SQL[] = []
      if (query.q) {
        const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`
        filters.push(
          or(
            ilike(invoices.invoiceNumber, term),
            ilike(invoices.subscriberName, term),
            ilike(invoices.accountIdentifier, term)
          )!
        )
      }
      if (query.billingPeriodStart) {
        filters.push(eq(invoices.billingPeriodStart, query.billingPeriodStart))
      }
      if (query.billingPeriodEnd) {
        filters.push(eq(invoices.billingPeriodEnd, query.billingPeriodEnd))
      }

      const where = filters.length ? and(...filters) : undefined
      const paidTotal =
        sql<string>`COALESCE(SUM(${payments.amount}), 0)::numeric(12, 2)`.as(
          'amountPaid'
        )
      const paidAmount = sql`COALESCE(SUM(${payments.amount}), 0)`
      const today = new Date().toISOString().slice(0, 10)
      let statusFilter: SQL = sql`true`
      if (query.status === 'paid') {
        statusFilter = sql`${paidAmount} >= ${invoices.total}`
      } else if (query.status === 'overdue') {
        statusFilter = sql`${paidAmount} < ${invoices.total} AND ${invoices.dueDate} < ${today}`
      } else if (query.status === 'partially_paid') {
        statusFilter = sql`${paidAmount} > 0 AND ${paidAmount} < ${invoices.total} AND ${invoices.dueDate} >= ${today}`
      } else if (query.status === 'unpaid') {
        statusFilter = sql`${paidAmount} = 0 AND ${invoices.dueDate} >= ${today}`
      } else if (query.status === 'outstanding') {
        statusFilter = sql`${paidAmount} < ${invoices.total}`
      }

      const invoiceQuery = database
        .select({
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          serviceAccountId: invoices.serviceAccountId,
          accountIdentifier: invoices.accountIdentifier,
          subscriberId: invoices.subscriberId,
          subscriberName: invoices.subscriberName,
          planId: invoices.planId,
          planName: invoices.planName,
          billingPeriodStart: invoices.billingPeriodStart,
          billingPeriodEnd: invoices.billingPeriodEnd,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          subtotal: invoices.subtotal,
          total: invoices.total,
          createdAt: invoices.createdAt,
          amountPaid: paidTotal
        })
        .from(invoices)
        .leftJoin(payments, eq(payments.invoiceId, invoices.id))
        .where(where)
        .groupBy(invoices.id)
        .having(statusFilter)
      const filteredInvoices = invoiceQuery.as('filtered_invoices')

      const [rows, countRows] = await Promise.all([
        database
          .select()
          .from(filteredInvoices)
          .orderBy(
            desc(filteredInvoices.createdAt),
            asc(filteredInvoices.invoiceNumber)
          )
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        database.select({ total: count() }).from(filteredInvoices)
      ])

      const items = rows.map((row) => ({
        id: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        serviceAccountId: row.serviceAccountId,
        accountIdentifier: row.accountIdentifier,
        subscriberId: row.subscriberId,
        subscriberName: row.subscriberName,
        planId: row.planId,
        planName: row.planName,
        billingPeriodStart: row.billingPeriodStart,
        billingPeriodEnd: row.billingPeriodEnd,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        subtotal: row.subtotal,
        total: row.total,
        amountPaid: row.amountPaid,
        balance: centsMoney(
          moneyCents(row.total) - moneyCents(row.amountPaid) > 0n
            ? moneyCents(row.total) - moneyCents(row.amountPaid)
            : 0n
        ),
        status: deriveInvoiceStatus(row.total, row.amountPaid, row.dueDate),
        createdAt: row.createdAt.toISOString()
      }))

      return { items, total: countRows[0]?.total ?? 0 }
    },

    async get(id) {
      const [row] = await database
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
      if (!row) return null
      const [paymentTotal] = await database
        .select({
          amountPaid: sql<string>`COALESCE(SUM(${payments.amount}), 0)::numeric(12, 2)`
        })
        .from(payments)
        .where(eq(payments.invoiceId, row.id))
      const lineItems = await database
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, row.id))
        .orderBy(asc(invoiceItems.id))
      return {
        ...invoiceListItem(row, paymentTotal?.amountPaid ?? '0.00'),
        lineItems: lineItems.map(invoiceLineItem)
      }
    },

    async summary(query) {
      const periodInvoices = database
        .select({
          id: invoices.id,
          total: invoices.total,
          dueDate: invoices.dueDate,
          amountPaid:
            sql<string>`COALESCE(SUM(${payments.amount}), 0)::numeric(12, 2)`.as(
              'amountPaid'
            )
        })
        .from(invoices)
        .leftJoin(payments, eq(payments.invoiceId, invoices.id))
        .where(
          and(
            gte(invoices.billingPeriodStart, query.billingPeriodStart),
            lte(invoices.billingPeriodStart, query.billingPeriodEnd)
          )
        )
        .groupBy(invoices.id)
        .as('period_invoices')

      const nextPeriodStart = new Date(
        `${query.billingPeriodEnd}T00:00:00.000Z`
      )
      nextPeriodStart.setUTCDate(nextPeriodStart.getUTCDate() + 1)
      const [periodRows, collectedRows] = await Promise.all([
        database.select().from(periodInvoices),
        database
          .select({
            totalCollected: sql<string>`COALESCE(SUM(${payments.amount}), 0)::numeric(12, 2)`
          })
          .from(payments)
          .where(
            and(
              gte(
                payments.receivedAt,
                new Date(`${query.billingPeriodStart}T00:00:00.000Z`)
              ),
              lt(payments.receivedAt, nextPeriodStart)
            )
          )
      ])
      let billedCents = 0n
      let outstandingCents = 0n
      let unpaidInvoiceCount = 0
      let overdueInvoiceCount = 0
      const today = new Date().toISOString().slice(0, 10)
      for (const invoice of periodRows) {
        const total = moneyCents(invoice.total)
        const paid = moneyCents(invoice.amountPaid)
        billedCents += total
        outstandingCents += total > paid ? total - paid : 0n
        if (paid < total) unpaidInvoiceCount += 1
        if (paid < total && invoice.dueDate < today) overdueInvoiceCount += 1
      }
      const recent = await this.list({ page: 1, limit: 5 })
      return {
        billingPeriodStart: query.billingPeriodStart,
        billingPeriodEnd: query.billingPeriodEnd,
        totalBilled: centsMoney(billedCents),
        totalCollected: collectedRows[0]?.totalCollected ?? '0.00',
        totalOutstanding: centsMoney(outstandingCents),
        unpaidInvoiceCount,
        overdueInvoiceCount,
        recentInvoices: recent.items
      }
    }
  }
}
