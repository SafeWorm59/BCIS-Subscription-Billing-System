import { useEffect, useMemo, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import type { BillingSummary, InvoiceListItem } from '@bcis/shared'
import { calendarMonthRange, formatPhpMoney } from './lib/business-format'
import { csvField } from './lib/csv'

const pageSize = 25

function monthRange(month: string): { billingPeriodStart: string; billingPeriodEnd: string } {
  const { start, end } = calendarMonthRange(month)
  return { billingPeriodStart: start, billingPeriodEnd: end }
}

const money = formatPhpMoney

export default function Reports(): React.JSX.Element {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const range = useMemo(() => monthRange(month), [month])

  useEffect(() => {
    let active = true
    Promise.all([
      window.api.getBillingSummary(range),
      window.api.listInvoices({ page, limit: pageSize, ...range })
    ])
      .then(([nextSummary, nextInvoices]) => {
        if (active) {
          setSummary(nextSummary)
          setInvoices(nextInvoices.items)
          setTotal(nextInvoices.total)
        }
      })
      .catch((requestError: unknown) => {
        if (active)
          setError(
            requestError instanceof Error ? requestError.message : 'Could not load report data.'
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, range])

  async function exportCsv(): Promise<void> {
    setExporting(true)
    setError(null)
    try {
      const rows: InvoiceListItem[] = []
      let exportPage = 1
      let exportTotal = 0
      do {
        const result = await window.api.listInvoices({ page: exportPage, limit: 100, ...range })
        rows.push(...result.items)
        exportTotal = result.total
        exportPage += 1
      } while (rows.length < exportTotal)
      const columns: Array<keyof InvoiceListItem> = [
        'invoiceNumber',
        'accountIdentifier',
        'subscriberName',
        'billingPeriodStart',
        'billingPeriodEnd',
        'issueDate',
        'dueDate',
        'subtotal',
        'total',
        'amountPaid',
        'balance',
        'status'
      ]
      const content = [
        columns.join(','),
        ...rows.map((row) => columns.map((column) => csvField(String(row[column]))).join(','))
      ].join('\r\n')
      const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bcis-billing-report-${month}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Could not export report.')
    } finally {
      setExporting(false)
    }
  }

  const metrics = summary
    ? [
        ['Billed', money(summary.totalBilled)],
        ['Payments received', money(summary.totalCollected)],
        ['Outstanding', money(summary.totalOutstanding)],
        ['Open invoices', String(summary.unpaidInvoiceCount)],
        ['Overdue invoices', String(summary.overdueInvoiceCount)]
      ]
    : []

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Billing analytics
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Reports</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Invoice totals are grouped by billing month; payments received are grouped by receipt
            date.
          </p>
        </div>
        <button
          className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium disabled:opacity-50"
          disabled={exporting || loading}
          onClick={() => void exportCsv()}
          type="button"
        >
          <Download className="size-4" />
          {exporting ? 'Preparing CSV…' : 'Export invoice CSV'}
        </button>
      </div>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">
        Billing month
        <input
          aria-label="Report month"
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
      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 inline size-4 animate-spin" />
          Loading report…
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {metrics.map(([label, value]) => (
              <article
                className="rounded-xl border border-border bg-card p-5 shadow-card"
                key={label}
              >
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-3 text-2xl font-semibold">{value}</p>
              </article>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Invoice</th>
                    <th className="px-5 py-3">Subscriber</th>
                    <th className="px-5 py-3">Billed</th>
                    <th className="px-5 py-3">Collected</th>
                    <th className="px-5 py-3">Balance</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-5 py-4 font-mono text-xs">{invoice.invoiceNumber}</td>
                      <td className="px-5 py-4">{invoice.subscriberName}</td>
                      <td className="px-5 py-4">{money(invoice.total)}</td>
                      <td className="px-5 py-4">{money(invoice.amountPaid)}</td>
                      <td className="px-5 py-4">{money(invoice.balance)}</td>
                      <td className="px-5 py-4 capitalize">{invoice.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!invoices.length && (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  No invoices for this billing month.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{total} invoices</span>
              <div className="flex items-center gap-3">
                <span>
                  Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
                </span>
                <button
                  disabled={page <= 1}
                  onClick={() => {
                    setLoading(true)
                    setPage((value) => value - 1)
                  }}
                  type="button"
                >
                  Previous
                </button>
                <button
                  disabled={page * pageSize >= total}
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
        </>
      )}
    </section>
  )
}
