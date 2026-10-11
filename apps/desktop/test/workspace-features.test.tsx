// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary, Invoice, InvoiceListItem, PaymentListItem } from '@bcis/shared'
import Billing from '../src/renderer/src/Billing'
import Payments from '../src/renderer/src/Payments'
import Reports from '../src/renderer/src/Reports'
import Settings from '../src/renderer/src/Settings'

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
  subtotal: '1000.00',
  total: '1000.00',
  amountPaid: '250.00',
  balance: '750.00',
  status: 'partially_paid',
  lineItems: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      description: 'Monthly plan',
      quantity: 1,
      unitPrice: '1000.00',
      lineTotal: '1000.00'
    }
  ],
  createdAt: '2026-10-01T00:00:00.000Z'
}
const invoiceItem: InvoiceListItem = Object.fromEntries(
  Object.entries(invoice).filter(([key]) => key !== 'lineItems')
) as InvoiceListItem
const payment: PaymentListItem = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  accountIdentifier: invoice.accountIdentifier,
  subscriberName: invoice.subscriberName,
  amount: '250.00',
  receivedAt: '2026-10-11T12:00:00.000Z'
}
const summary: BillingSummary = {
  billingPeriodStart: '2026-10-01',
  billingPeriodEnd: '2026-10-31',
  totalBilled: '1000.00',
  totalCollected: '250.00',
  totalOutstanding: '750.00',
  unpaidInvoiceCount: 1,
  overdueInvoiceCount: 0,
  recentInvoices: [invoiceItem]
}
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  loginIdentifier: 'person@example.test',
  status: 'active' as const,
  roles: ['Administrator' as const],
  permissions: ['invoices.read' as const]
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
    getRuntimeVersions: () => ({ electron: '44', chrome: '140', node: '22' }),
    getApiEndpoint: vi.fn(async () => 'http://127.0.0.1:3000'),
    listAdminUsers: vi.fn(async () => ({
      users: [{ ...user, createdAt: '2026-10-01T00:00:00.000Z' }]
    })),
    listAdminRoles: vi.fn(async () => ({
      roles: [{ name: 'Administrator' as const, permissions: ['users.read'] }]
    })),
    getCurrentUser: vi.fn(async () => user),
    listPayments: vi.fn(async () => ({ items: [payment], page: 1, limit: 25, total: 1 })),
    getBillingSummary: vi.fn(async () => summary),
    listInvoices: vi.fn(async () => ({ items: [invoiceItem], page: 1, limit: 25, total: 1 })),
    getInvoice: vi.fn(async () => invoice),
    listInvoicePayments: vi.fn(async () => [
      {
        id: payment.id,
        invoiceId: invoice.id,
        amount: payment.amount,
        receivedAt: payment.receivedAt
      }
    ]),
    listServiceAccounts: vi.fn(async () => ({ items: [], page: 1, limit: 100, total: 0 }))
  } as unknown as typeof window.api
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('connected billing workspace screens', () => {
  it('shows real paginated payments and opens invoice payment history', async () => {
    await act(async () => root.render(React.createElement(Payments)))
    expect(container.textContent).toContain('250.00')
    const invoiceButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(invoice.invoiceNumber)
    )!
    await act(async () => invoiceButton.click())
    expect(container.textContent).toContain('Payment history')
    expect(window.api.listInvoicePayments).toHaveBeenCalledWith(invoice.id)
  })

  it('uses the shared outstanding filter for Collections and has no invoice creation action', async () => {
    await act(async () =>
      root.render(
        React.createElement(Billing, { mode: 'collections', permissions: ['invoices.read'] })
      )
    )
    expect(window.api.listInvoices).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      status: 'outstanding'
    })
    expect(container.textContent).toContain('Outstanding invoices')
    expect(container.textContent).not.toContain('Generate invoice')
  })

  it('shows reconciled monthly report totals and invoice amounts', async () => {
    await act(async () => root.render(React.createElement(Reports)))
    expect(container.textContent).toContain('Payments received')
    expect(container.textContent).toContain('750.00')
    expect(container.textContent).toContain(invoice.invoiceNumber)
    expect(window.api.getBillingSummary).toHaveBeenCalled()
  })

  it('persists the payment confirmation preference locally and reports API availability', async () => {
    await act(async () => root.render(React.createElement(Settings, { user })))
    expect(container.textContent).toContain('connected')
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => checkbox.click())
    expect(window.localStorage.getItem('bcis.confirm-payments.v1')).toBe('true')
  })

  it('shows server-backed user administration only with granted permissions', async () => {
    const administrator = {
      ...user,
      permissions: ['users.read', 'users.manage', 'roles.manage', 'permissions.manage'] as const
    }
    await act(async () => root.render(React.createElement(Settings, { user: administrator })))
    expect(container.textContent).toContain('Users and roles')
    expect(container.textContent).toContain('person@example.test')
    expect(window.api.listAdminUsers).toHaveBeenCalled()
    expect(window.api.listAdminRoles).toHaveBeenCalled()
    expect(
      [...container.querySelectorAll('button')].some((button) =>
        ['Disable', 'Enable'].includes(button.textContent ?? '')
      )
    ).toBe(false)
  })

  it('shows account creation to a user manager without granting user-list access', async () => {
    const userManager = { ...user, permissions: ['users.manage'] as const }
    await act(async () => root.render(React.createElement(Settings, { user: userManager })))

    expect(container.textContent).toContain('Create user')
    expect(container.textContent).not.toContain('Search login identifier')
    expect(window.api.listAdminUsers).not.toHaveBeenCalled()
  })
})
