import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import type { Invoice, Payment, PaymentListItem } from '@bcis/shared'
import { calendarMonthRange, formatPhpMoney } from './lib/business-format'

const pageSize = 25

function monthDates(month: string): { receivedAtStart: string; receivedAtEnd: string } {
  const { start, end } = calendarMonthRange(month)
  return { receivedAtStart: start, receivedAtEnd: end }
}

const money = formatPhpMoney

export default function Payments(): React.JSX.Element {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<{ items: PaymentListItem[]; total: number } | null>(null)
  const [detail, setDetail] = useState<{ invoice: Invoice; payments: Payment[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailRequestId = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      detailRequestId.current += 1
    },
    []
  )

  useEffect(() => {
    let active = true
    window.api
      .listPayments({ page, limit: pageSize, q: query.trim() || undefined, ...monthDates(month) })
      .then((response) => {
        if (active) setResult(response)
      })
      .catch((requestError: unknown) => {
        if (active)
          setError(
            requestError instanceof Error ? requestError.message : 'Could not load payments.'
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [month, page, query])

  async function openInvoice(id: string): Promise<void> {
    const requestId = ++detailRequestId.current
    setError(null)
    setDetailLoading(true)
    setDetail(null)
    try {
      const [invoice, payments] = await Promise.all([
        window.api.getInvoice(id),
        window.api.listInvoicePayments(id)
      ])
      if (requestId === detailRequestId.current) setDetail({ invoice, payments })
    } catch (requestError: unknown) {
      if (requestId === detailRequestId.current)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Could not load invoice payment history.'
        )
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false)
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Billing</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Payments</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Recorded transactions and their invoice history.
        </p>
      </div>
      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Payment month
          <input
            aria-label="Payment month"
            className="block h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
            onChange={(event) => {
              setLoading(true)
              setError(null)
              setPage(1)
              setMonth(event.target.value)
            }}
            type="month"
            value={month}
          />
        </label>
        <label className="relative min-w-[240px] flex-1 self-end">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search payments"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm"
            onChange={(event) => {
              setPage(1)
              setQuery(event.target.value)
            }}
            placeholder="Invoice, subscriber, or account"
            value={query}
          />
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 inline size-4 animate-spin" />
            Loading payments…
          </div>
        ) : result?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Received</th>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Subscriber</th>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-5 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-5 py-4">{new Date(payment.receivedAt).toLocaleString()}</td>
                    <td className="px-5 py-4">
                      <button
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        onClick={() => void openInvoice(payment.invoiceId)}
                        type="button"
                      >
                        {payment.invoiceNumber}
                      </button>
                    </td>
                    <td className="px-5 py-4">{payment.subscriberName}</td>
                    <td className="px-5 py-4">{payment.accountIdentifier}</td>
                    <td className="px-5 py-4 font-medium">{money(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No payments found for this month.
          </p>
        )}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>{result?.total ?? 0} payments</span>
          <div className="flex items-center gap-3">
            <span>
              Page {page} of {Math.max(1, Math.ceil((result?.total ?? 0) / pageSize))}
            </span>
            <button
              className="disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true)
                setPage((value) => value - 1)
              }}
              type="button"
            >
              Previous
            </button>
            <button
              className="disabled:opacity-40"
              disabled={!result || page * pageSize >= result.total || loading}
              onClick={() => {
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
      {detailLoading && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-5">
          <p className="rounded-lg bg-card p-5 text-sm">
            <LoaderCircle className="mr-2 inline size-4 animate-spin" />
            Loading invoice history…
          </p>
        </div>
      )}
      {detail && (
        <div
          aria-label="Invoice payment history"
          aria-modal="true"
          className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-5"
          role="dialog"
        >
          <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{detail.invoice.invoiceNumber}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.invoice.subscriberName} · balance {money(detail.invoice.balance)}
                </p>
              </div>
              <button
                className="rounded border border-border px-3 py-1 text-sm"
                onClick={() => {
                  detailRequestId.current += 1
                  setDetail(null)
                }}
                type="button"
              >
                Close
              </button>
            </div>
            <h3 className="mt-6 text-sm font-semibold">Payment history</h3>
            {detail.payments.length ? (
              <ul className="mt-2 divide-y divide-border">
                {detail.payments.map((entry) => (
                  <li className="flex justify-between py-3 text-sm" key={entry.id}>
                    <span>{new Date(entry.receivedAt).toLocaleString()}</span>
                    <span>{money(entry.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No payments recorded.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
