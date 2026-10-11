// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary, Invoice, InvoiceListItem } from '@bcis/shared'
import Billing from '../src/renderer/src/Billing'

const invoice: Invoice = {
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
  status: 'unpaid',
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
const invoiceListItem: InvoiceListItem = Object.fromEntries(
  Object.entries(invoice).filter(([key]) => key !== 'lineItems')
) as InvoiceListItem
const generatedInvoice: Invoice = {
  ...invoice,
  id: '11111111-1111-4111-8111-111111111111',
  invoiceNumber: 'INV-202611-11111111-1111-4111-8111-111111111111',
  total: '900.00',
  amountPaid: '0.00',
  balance: '900.00',
  lineItems: [
    {
      ...invoice.lineItems[0]!,
      id: '22222222-2222-4222-8222-222222222222',
      unitPrice: '900.00',
      lineTotal: '900.00'
    }
  ]
}
const generatedInvoiceListItem = Object.fromEntries(
  Object.entries(generatedInvoice).filter(([key]) => key !== 'lineItems')
) as InvoiceListItem
const priorPayment = {
  id: '33333333-3333-4333-8333-333333333333',
  invoiceId: invoice.id,
  amount: '100.00',
  receivedAt: '2026-10-11T00:00:00.000Z'
}
const summary: BillingSummary = {
  billingPeriodStart: '2026-10-01',
  billingPeriodEnd: '2026-10-31',
  totalBilled: '1250.50',
  totalCollected: '250.00',
  totalOutstanding: '1000.50',
  unpaidInvoiceCount: 1,
  overdueInvoiceCount: 0,
  recentInvoices: [invoiceListItem]
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.api = {
    listServiceAccounts: vi.fn(async () => ({
      items: [
        {
          id: invoice.serviceAccountId,
          accountIdentifier: invoice.accountIdentifier,
          subscriberId: invoice.subscriberId,
          planId: invoice.planId,
          status: 'active',
          createdAt: invoice.createdAt,
          updatedAt: invoice.createdAt
        }
      ],
      page: 1,
      limit: 100,
      total: 1
    })),
    getBillingSummary: vi.fn(async () => summary),
    listInvoices: vi.fn(async () => ({ items: [invoiceListItem], page: 1, limit: 10, total: 1 })),
    getInvoice: vi.fn(async () => invoice),
    generateInvoice: vi.fn(async () => invoice),
    listInvoicePayments: vi.fn(async (id: string) => (id === invoice.id ? [priorPayment] : [])),
    recordInvoicePayment: vi.fn(async () => ({
      id: '99999999-9999-4999-8999-999999999999',
      invoiceId: invoice.id,
      amount: '250.00',
      receivedAt: '2026-10-11T00:00:00.000Z'
    }))
  } as unknown as typeof window.api
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('billing screen', () => {
  it('loads eligible service-account options as the account search changes', async () => {
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )

    const search = container.querySelector(
      'input[aria-label="Find service account"]'
    ) as HTMLInputElement
    await act(async () => changeInput(search, 'ACCT-100'))

    expect(window.api.listServiceAccounts).toHaveBeenLastCalledWith({
      page: 1,
      limit: 100,
      status: 'active',
      q: 'ACCT-100'
    })
    expect(container.querySelector('select[required]')?.textContent).toContain(
      invoice.accountIdentifier
    )
  })

  it('shows persisted summary figures and generates an invoice with selected account and dates', async () => {
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )
    expect(container.textContent).toContain('Payments collected')
    expect(container.textContent).toContain('Invoices and collections')
    expect(container.textContent).toContain(invoice.invoiceNumber)
    expect(window.api.getBillingSummary).toHaveBeenCalledWith({
      billingPeriodStart: `${new Date().toISOString().slice(0, 7)}-01`,
      billingPeriodEnd: expect.any(String)
    })

    const accountSelect = container.querySelector('select[required]') as HTMLSelectElement
    await act(async () => {
      accountSelect.value = invoice.serviceAccountId
      accountSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const dateInputs = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[]
    await act(async () => changeInput(dateInputs[1]!, '2026-10-20'))
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )

    expect(window.api.generateInvoice).toHaveBeenCalledWith({
      serviceAccountId: invoice.serviceAccountId,
      billingPeriodStart: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      issueDate: expect.any(String),
      dueDate: '2026-10-20'
    })
    expect(container.textContent).toContain(invoice.invoiceNumber)
    expect(container.textContent).toContain('Invoice details')
    expect(container.textContent).toContain('1,250.50')
  })

  it('opens payment history and records a payment from invoice details', async () => {
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )
    const invoiceButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )
    expect(invoiceButton).toBeTruthy()
    await act(async () => invoiceButton!.click())
    expect(container.textContent).toContain('Payment history')
    expect(container.textContent).toContain('Record payment')
    const amount = container.querySelector('input[aria-label="Payment amount"]') as HTMLInputElement
    await act(async () => changeInput(amount, '250.00'))
    const paymentForm = [...container.querySelectorAll('form')].find((form) =>
      form.textContent?.includes('Record payment')
    )!
    await act(async () =>
      paymentForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(window.api.recordInvoicePayment).toHaveBeenCalledWith(invoice.id, {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      amount: '250.00'
    })
    expect(container.textContent).toContain('Payment recorded.')
  })

  it('reuses the same persisted payment ID after an ambiguous request failure', async () => {
    const submittedIds: string[] = []
    let requestCount = 0
    window.api.recordInvoicePayment = vi.fn(async (invoiceId, input) => {
      submittedIds.push(input.id)
      requestCount += 1
      if (requestCount === 1) throw new Error('Network response was lost')
      return {
        id: input.id,
        invoiceId,
        amount: input.amount,
        receivedAt: '2026-10-11T00:00:00.000Z'
      }
    })
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )
    const invoiceButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )!
    await act(async () => invoiceButton.click())
    const form = [...container.querySelectorAll('form')].find((element) =>
      element.textContent?.includes('Record payment')
    )!
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(container.textContent).toContain('Network response was lost')
    expect(window.localStorage.getItem('bcis.pending-payment-attempts.v1')).toContain(
      submittedIds[0]
    )

    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )
    const reopenedInvoiceButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )!
    await act(async () => reopenedInvoiceButton.click())
    const reopenedForm = [...container.querySelectorAll('form')].find((element) =>
      element.textContent?.includes('Record payment')
    )!
    expect(
      (container.querySelector('input[aria-label="Payment amount"]') as HTMLInputElement).value
    ).toBe('1250.50')
    await act(async () =>
      reopenedForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(submittedIds).toHaveLength(2)
    expect(submittedIds[1]).toBe(submittedIds[0])
    expect(submittedIds[0]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(window.localStorage.getItem('bcis.pending-payment-attempts.v1')).toBe('[]')
  })

  it('replaces the prior invoice payment state when a new invoice is generated', async () => {
    window.api.generateInvoice = vi.fn(async () => generatedInvoice)
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )

    const priorInvoiceButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )!
    await act(async () => priorInvoiceButton.click())
    expect(container.textContent).toContain('100.00')

    const backButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Back to invoices')
    )!
    await act(async () => backButton.click())

    const accountSelect = container.querySelector('select[required]') as HTMLSelectElement
    await act(async () => {
      accountSelect.value = invoice.serviceAccountId
      accountSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const dateInputs = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[]
    await act(async () => changeInput(dateInputs[1]!, '2026-11-20'))
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )

    expect(window.api.generateInvoice).toHaveBeenCalledOnce()
    expect(window.api.listInvoicePayments).toHaveBeenLastCalledWith(generatedInvoice.id)
    expect(container.textContent).toContain(generatedInvoice.invoiceNumber)
    expect(container.textContent).not.toContain(priorPayment.amount)
    expect(
      (container.querySelector('input[aria-label="Payment amount"]') as HTMLInputElement).value
    ).toBe(generatedInvoice.balance)
  })

  it('ignores payment history returned late for a previously selected invoice', async () => {
    const oldInvoice = deferred<Invoice>()
    const oldPayments = deferred<(typeof priorPayment)[]>()
    const currentInvoice = deferred<Invoice>()
    const currentPayments = deferred<(typeof priorPayment)[]>()
    window.api.listInvoices = vi.fn(async () => ({
      items: [invoiceListItem, generatedInvoiceListItem],
      page: 1,
      limit: 10,
      total: 2
    }))
    window.api.getInvoice = vi.fn((id: string) =>
      id === invoice.id ? oldInvoice.promise : currentInvoice.promise
    )
    window.api.listInvoicePayments = vi.fn((id: string) =>
      id === invoice.id ? oldPayments.promise : currentPayments.promise
    )
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )

    const firstButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )!
    const secondButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(generatedInvoice.invoiceNumber)
    )!
    await act(async () => {
      firstButton.click()
      secondButton.click()
    })

    currentInvoice.resolve(generatedInvoice)
    currentPayments.resolve([])
    await act(async () => currentInvoice.promise)
    oldInvoice.resolve(invoice)
    oldPayments.resolve([priorPayment])
    await act(async () => oldInvoice.promise)

    expect(container.textContent).toContain(generatedInvoice.invoiceNumber)
    expect(container.textContent).not.toContain(priorPayment.amount)
    expect(
      (container.querySelector('input[aria-label="Payment amount"]') as HTMLInputElement).value
    ).toBe(generatedInvoice.balance)
  })

  it.each(['unpaid', 'overdue', 'partially_paid'] as const)(
    'shows %s outstanding collection results across billing months',
    async (status) => {
      await act(async () =>
        root.render(
          React.createElement(Billing, {
            permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
          })
        )
      )
      const filter = container.querySelector(
        'select[aria-label="Filter invoices by status"]'
      ) as HTMLSelectElement
      await act(async () => {
        filter.value = status
        filter.dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(window.api.listInvoices).toHaveBeenLastCalledWith({
        page: 1,
        limit: 10,
        status
      })
      expect(container.textContent).toContain('Outstanding invoices across all billing months')
    }
  )

  it('shows a readable error when summary or invoice loading fails', async () => {
    window.api.getBillingSummary = vi.fn(async () => {
      throw new Error('Billing unavailable')
    })
    window.api.listInvoices = vi.fn(async () => {
      throw new Error('Billing unavailable')
    })
    await act(async () =>
      root.render(
        React.createElement(Billing, {
          permissions: ['invoices.read', 'invoices.manage', 'service_accounts.read']
        })
      )
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Billing unavailable')
  })
})
