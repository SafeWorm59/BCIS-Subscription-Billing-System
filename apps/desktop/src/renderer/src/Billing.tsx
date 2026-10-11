import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, LoaderCircle, Plus, Search } from 'lucide-react'
import {
  invoiceStatuses,
  type Invoice,
  type InvoiceListItem,
  type InvoiceListQuery,
  type InvoiceStatus,
  type PermissionKey,
  type ServiceAccount
} from '@bcis/shared'
import { calendarMonthRange, formatPhpMoney } from './lib/business-format'

const pageSize = 10
const pendingPaymentsStorageKey = 'bcis.pending-payment-attempts.v1'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PendingPaymentAttempt {
  invoiceId: string
  amount: string
  id: string
}

function readPendingPaymentAttempts(): Map<string, PendingPaymentAttempt> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(pendingPaymentsStorageKey) ?? '[]'
    )
    if (!Array.isArray(parsed)) return new Map()
    const attempts = parsed.filter(
      (item): item is PendingPaymentAttempt =>
        item !== null &&
        typeof item === 'object' &&
        'invoiceId' in item &&
        typeof item.invoiceId === 'string' &&
        uuidPattern.test(item.invoiceId) &&
        'id' in item &&
        typeof item.id === 'string' &&
        uuidPattern.test(item.id) &&
        'amount' in item &&
        typeof item.amount === 'string' &&
        /^(0|[1-9]\d{0,9})\.\d{2}$/.test(item.amount)
    )
    return new Map(attempts.map((attempt) => [`${attempt.invoiceId}:${attempt.amount}`, attempt]))
  } catch {
    return new Map()
  }
}

function canonicalPaymentAmount(value: string): string {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error('Enter a valid payment amount.')
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`
}

function monthRange(month: string): { billingPeriodStart: string; billingPeriodEnd: string } {
  const { start, end } = calendarMonthRange(month)
  return {
    billingPeriodStart: start,
    billingPeriodEnd: end
  }
}

const money = formatPhpMoney

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed. Please try again.'
}

function StatusBadge({ status }: { status: InvoiceStatus }): React.JSX.Element {
  const color =
    status === 'paid'
      ? 'bg-emerald-50 text-emerald-800'
      : status === 'overdue'
        ? 'bg-red-50 text-red-800'
        : status === 'partially_paid'
          ? 'bg-amber-50 text-amber-800'
          : 'bg-blue-50 text-blue-800'
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${color}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export default function Billing({
  mode = 'billing',
  permissions = []
}: {
  mode?: 'billing' | 'collections'
  permissions?: PermissionKey[]
}): React.JSX.Element {
  const canManageInvoices = permissions.includes('invoices.manage')
  const canGenerateInvoices = canManageInvoices && permissions.includes('service_accounts.read')
  const today = new Date().toISOString().slice(0, 10)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(mode === 'collections' ? 'outstanding' : '')
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof window.api.getBillingSummary>
  > | null>(null)
  const [invoices, setInvoices] = useState<{ items: InvoiceListItem[]; total: number } | null>(null)
  const [accounts, setAccounts] = useState<ServiceAccount[]>([])
  const [detail, setDetail] = useState<Invoice | null>(null)
  const detailRequestId = useRef(0)
  const paymentAttempts = useRef<Map<string, PendingPaymentAttempt> | null>(null)
  if (paymentAttempts.current === null) {
    paymentAttempts.current = readPendingPaymentAttempts()
  }
  const [payments, setPayments] = useState<
    Awaited<ReturnType<typeof window.api.listInvoicePayments>>
  >([])
  const [paymentAmount, setPaymentAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [serviceAccountId, setServiceAccountId] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [issueDate, setIssueDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const range = useMemo(() => monthRange(month), [month])
  const collectionStatus =
    status === 'unpaid' ||
    status === 'overdue' ||
    status === 'partially_paid' ||
    status === 'outstanding'

  function persistPaymentAttempts(): void {
    window.localStorage.setItem(
      pendingPaymentsStorageKey,
      JSON.stringify([...paymentAttempts.current!.values()])
    )
  }

  function findPendingPayment(invoiceId: string): PendingPaymentAttempt | undefined {
    return [...paymentAttempts.current!.values()]
      .reverse()
      .find((attempt) => attempt.invoiceId === invoiceId)
  }

  useEffect(() => {
    let active = true
    if (!canGenerateInvoices) {
      return () => {
        active = false
      }
    }
    window.api
      .listServiceAccounts({
        page: 1,
        limit: 100,
        status: 'active',
        q: accountSearch.trim() || undefined
      })
      .then((result) => {
        if (active) setAccounts(result.items)
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setOptionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountSearch, canGenerateInvoices])

  useEffect(() => {
    let active = true
    Promise.all([
      window.api.getBillingSummary(range),
      window.api.listInvoices({
        page,
        limit: pageSize,
        q: search.trim() || undefined,
        status: (status || undefined) as InvoiceListQuery['status'],
        ...(collectionStatus ? {} : range)
      })
    ])
      .then(([nextSummary, nextInvoices]) => {
        if (active) {
          setSummary(nextSummary)
          setInvoices(nextInvoices)
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [collectionStatus, page, range, search, status])

  async function openInvoice(id: string): Promise<void> {
    const requestId = ++detailRequestId.current
    setError(null)
    setLoading(true)
    try {
      const [nextInvoice, nextPayments] = await Promise.all([
        window.api.getInvoice(id),
        window.api.listInvoicePayments(id)
      ])
      if (requestId === detailRequestId.current) {
        setDetail(nextInvoice)
        setPayments(nextPayments)
        const pending = findPendingPayment(id)
        setPaymentAmount(pending?.amount ?? nextInvoice.balance)
      }
    } catch (loadError: unknown) {
      if (requestId === detailRequestId.current) setError(errorMessage(loadError))
    } finally {
      if (requestId === detailRequestId.current) setLoading(false)
    }
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!detail) return
    const requestId = detailRequestId.current
    const invoiceId = detail.id
    if (
      window.localStorage.getItem('bcis.confirm-payments.v1') === 'true' &&
      !window.confirm(`Record a payment of ${money(paymentAmount)} for ${detail.invoiceNumber}?`)
    )
      return
    let amount: string
    let attempt: PendingPaymentAttempt
    try {
      amount = canonicalPaymentAmount(paymentAmount)
      const key = `${invoiceId}:${amount}`
      attempt = paymentAttempts.current!.get(key) ?? {
        invoiceId,
        amount,
        id: crypto.randomUUID()
      }
      paymentAttempts.current!.set(key, attempt)
      persistPaymentAttempts()
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await window.api.recordInvoicePayment(invoiceId, { id: attempt.id, amount })
      const [nextInvoice, nextPayments] = await Promise.all([
        window.api.getInvoice(invoiceId),
        window.api.listInvoicePayments(invoiceId)
      ])
      if (requestId === detailRequestId.current) {
        setDetail(nextInvoice)
        setPayments(nextPayments)
        setPaymentAmount(nextInvoice.balance)
        setSuccess('Payment recorded.')
      }
      paymentAttempts.current!.delete(`${invoiceId}:${amount}`)
      persistPaymentAttempts()
      await refresh()
    } catch (saveError: unknown) {
      if (requestId === detailRequestId.current) setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const [nextSummary, nextInvoices] = await Promise.all([
        window.api.getBillingSummary(range),
        window.api.listInvoices({
          page,
          limit: pageSize,
          q: search.trim() || undefined,
          status: (status || undefined) as InvoiceListQuery['status'],
          ...(collectionStatus ? {} : range)
        })
      ])
      setSummary(nextSummary)
      setInvoices(nextInvoices)
    } finally {
      setLoading(false)
    }
  }

  async function generate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const invoice = await window.api.generateInvoice({
        serviceAccountId,
        billingPeriodStart: range.billingPeriodStart,
        issueDate,
        dueDate
      })
      const requestId = ++detailRequestId.current
      setDetail(invoice)
      setPayments([])
      setPaymentAmount(findPendingPayment(invoice.id)?.amount ?? invoice.balance)
      setSuccess(`Invoice ${invoice.invoiceNumber} generated.`)
      void window.api
        .listInvoicePayments(invoice.id)
        .then((nextPayments) => {
          if (requestId === detailRequestId.current) setPayments(nextPayments)
        })
        .catch((loadError: unknown) => {
          if (requestId === detailRequestId.current) setError(errorMessage(loadError))
        })
      await refresh()
    } catch (saveError: unknown) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (detail) {
    return (
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
              Billing
            </p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Invoice details</h1>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium"
            onClick={() => {
              detailRequestId.current += 1
              setDetail(null)
              setPayments([])
              setPaymentAmount('')
            }}
            type="button"
          >
            <ArrowLeft className="size-4" />
            Back to invoices
          </button>
        </div>
        {success && (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            role="status"
          >
            {success}
          </p>
        )}
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="rounded-xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div>
              <p className="text-sm text-muted-foreground">Invoice number</p>
              <h2 className="mt-1 font-mono text-lg font-semibold">{detail.invoiceNumber}</h2>
            </div>
            <StatusBadge status={detail.status} />
          </div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Subscriber', detail.subscriberName],
              ['Service account', detail.accountIdentifier],
              ['Plan', detail.planName],
              ['Billing period', `${detail.billingPeriodStart} to ${detail.billingPeriodEnd}`],
              ['Issue date', detail.issueDate],
              ['Due date', detail.dueDate],
              ['Total', money(detail.total)],
              ['Amount paid', money(detail.amountPaid)],
              ['Remaining balance', money(detail.balance)]
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-7 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Invoice items</h3>
            <div className="mt-3 divide-y divide-border">
              {detail.lineItems.map((item) => (
                <div className="flex flex-wrap justify-between gap-3 py-3 text-sm" key={item.id}>
                  <span>
                    {item.description} × {item.quantity}
                  </span>
                  <span>{money(item.lineTotal)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-10 border-t border-border pt-4 text-sm font-semibold">
              <span>Total</span>
              <span>{money(detail.total)}</span>
            </div>
          </div>
          <div className="mt-7 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Payment history</h3>
            {payments.length ? (
              <div className="mt-3 divide-y divide-border">
                {payments.map((payment) => (
                  <div className="flex justify-between gap-3 py-3 text-sm" key={payment.id}>
                    <time dateTime={payment.receivedAt}>
                      {new Date(payment.receivedAt).toLocaleString()}
                    </time>
                    <span className="font-medium">{money(payment.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No payments recorded.</p>
            )}
            {canManageInvoices && detail.balance !== '0.00' && (
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={(event) => void recordPayment(event)}
              >
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Payment amount
                  <input
                    aria-label="Payment amount"
                    className="block h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                    min="0.01"
                    max={detail.balance}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={paymentAmount}
                  />
                </label>
                <button
                  className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? 'Recording…' : 'Record payment'}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Billing</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">
            {mode === 'collections' ? 'Collections' : 'Billing and invoices'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'collections'
              ? 'Review all open invoice balances and follow up on overdue accounts.'
              : 'Review balances and create monthly service invoices.'}
          </p>
        </div>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Billing month
          <input
            aria-label="Billing month"
            className="block h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
            onChange={(event) => {
              setError(null)
              setLoading(true)
              setPage(1)
              setMonth(event.target.value)
            }}
            type="month"
            value={month}
          />
        </label>
      </div>
      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          role="status"
        >
          {success}
        </p>
      )}

      {loading && !summary ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 inline size-4 animate-spin" />
          Loading billing summary…
        </div>
      ) : (
        summary && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Amount billed', money(summary.totalBilled)],
              ['Payments collected', money(summary.totalCollected)],
              ['Outstanding', money(summary.totalOutstanding)],
              ['Unpaid invoices', String(summary.unpaidInvoiceCount)],
              ['Overdue invoices', String(summary.overdueInvoiceCount)]
            ].map(([label, value]) => (
              <article
                className="rounded-xl border border-border bg-card p-5 shadow-card"
                key={label}
              >
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
              </article>
            ))}
          </div>
        )
      )}

      <div
        className={`grid items-start gap-6 ${mode === 'collections' || !canManageInvoices ? '' : 'xl:grid-cols-[minmax(0,1fr)_360px]'}`}
      >
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="font-semibold">
                  {mode === 'collections' ? 'Outstanding invoices' : 'Invoices and collections'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {collectionStatus
                    ? 'Outstanding invoices across all billing months'
                    : 'Search invoices and review balances for the selected month'}
                </p>
              </div>
              <select
                aria-label="Filter invoices by status"
                className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
                onChange={(event) => {
                  setError(null)
                  setLoading(true)
                  setPage(1)
                  setStatus(event.target.value)
                }}
                value={status}
              >
                <option value="">All statuses</option>
                <option value="outstanding">All outstanding</option>
                {invoiceStatuses.map((value) => (
                  <option key={value} value={value}>
                    {value.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <label className="relative block border-b border-border p-4">
              <Search className="absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search invoices"
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm"
                onChange={(event) => {
                  setError(null)
                  setLoading(true)
                  setPage(1)
                  setSearch(event.target.value)
                }}
                placeholder="Search invoice or subscriber"
                value={search}
              />
            </label>
            {loading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 inline size-4 animate-spin" />
                Loading invoices…
              </div>
            ) : invoices?.items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Subscriber</th>
                      <th className="px-5 py-3">Due date</th>
                      <th className="px-5 py-3">Balance</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoices.items.map((invoice) => (
                      <tr className="hover:bg-muted/30" key={invoice.id}>
                        <td className="px-5 py-4">
                          <button
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                            onClick={() => void openInvoice(invoice.id)}
                            type="button"
                          >
                            {invoice.invoiceNumber}
                          </button>
                        </td>
                        <td className="px-5 py-4">{invoice.subscriberName}</td>
                        <td className="px-5 py-4">{invoice.dueDate}</td>
                        <td className="px-5 py-4">{money(invoice.balance)}</td>
                        <td className="px-5 py-4">
                          <StatusBadge status={invoice.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No invoices found for this month.
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{invoices?.total ?? 0} total</span>
              <div className="flex items-center gap-3">
                <span>
                  Page {page}
                  {invoices ? ` of ${Math.max(1, Math.ceil(invoices.total / pageSize))}` : ''}
                </span>
                <button
                  className="rounded p-1 disabled:opacity-40"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    setPage((value) => value - 1)
                  }}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="rounded p-1 disabled:opacity-40"
                  disabled={!invoices || page * pageSize >= invoices.total || loading}
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    setPage((value) => value + 1)
                  }}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {mode === 'billing' && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-card">
              <h2 className="font-semibold">Recent invoices</h2>
              {summary?.recentInvoices.length ? (
                <div className="mt-3 divide-y divide-border">
                  {summary.recentInvoices.map((invoice) => (
                    <button
                      className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left text-sm hover:text-primary"
                      key={invoice.id}
                      onClick={() => void openInvoice(invoice.id)}
                      type="button"
                    >
                      <span>
                        <span className="font-mono text-xs font-semibold">
                          {invoice.invoiceNumber}
                        </span>
                        <span className="ml-3 text-muted-foreground">{invoice.subscriberName}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span>{money(invoice.total)}</span>
                        <StatusBadge status={invoice.status} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No invoices have been generated yet.
                </p>
              )}
            </div>
          )}
        </div>

        {mode === 'billing' && canGenerateInvoices && (
          <form
            className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
            onSubmit={(event) => void generate(event)}
          >
            <div>
              <h2 className="font-semibold">Generate invoice</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The invoice price is read from the selected service account’s plan and saved as a
                snapshot.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Find service account
              <input
                aria-label="Find service account"
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
                onChange={(event) => {
                  setError(null)
                  setOptionsLoading(true)
                  setAccountSearch(event.target.value)
                }}
                placeholder="Account identifier"
                value={accountSearch}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Active service account
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
                onChange={(event) => setServiceAccountId(event.target.value)}
                required
                value={serviceAccountId}
              >
                <option value="">
                  {optionsLoading ? 'Loading accounts…' : 'Select an account'}
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountIdentifier}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Billing period
              <input
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
                onChange={(event) => {
                  setError(null)
                  setLoading(true)
                  setPage(1)
                  setMonth(event.target.value)
                }}
                required
                type="month"
                value={month}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Issue date
              <input
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
                onChange={(event) => setIssueDate(event.target.value)}
                required
                type="date"
                value={issueDate}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Due date
              <input
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
                onChange={(event) => setDueDate(event.target.value)}
                required
                type="date"
                value={dueDate}
              />
            </label>
            <button
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={saving || optionsLoading || !accounts.length || !dueDate}
              type="submit"
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {saving ? 'Generating…' : 'Generate invoice'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
