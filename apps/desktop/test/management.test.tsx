// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan, ServiceAccount, Subscriber } from '@bcis/shared'
import Management from '../src/renderer/src/Management'

const plan: Plan = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Fiber 100',
  description: null,
  price: '1000.00',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const subscriber: Subscriber = {
  id: '88888888-8888-4888-8888-888888888888',
  name: 'Jamie Subscriber',
  email: null,
  phone: null,
  addressLine1: '1 Main Street',
  addressLine2: null,
  city: 'Malaybalay',
  province: 'Bukidnon',
  postalCode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const account: ServiceAccount = {
  id: '99999999-9999-4999-8999-999999999999',
  accountIdentifier: 'ACCT-001',
  subscriberId: subscriber.id,
  planId: plan.id,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.api = {
    listPlans: vi.fn(async () => ({ items: [plan], page: 1, limit: 100, total: 1 })),
    listSubscribers: vi.fn(async () => ({ items: [subscriber], page: 1, limit: 100, total: 1 })),
    listServiceAccounts: vi.fn(async () => ({ items: [account], page: 1, limit: 25, total: 1 })),
    getServiceAccount: vi.fn(async () => account),
    getPlan: vi.fn(async () => plan),
    getSubscriber: vi.fn(async () => subscriber),
    createServiceAccount: vi.fn(async () => account),
    updateServiceAccount: vi.fn(async (_id, input) => ({
      ...account,
      ...input,
      accountIdentifier: input.accountIdentifier ?? account.accountIdentifier
    })),
    getRuntimeVersions: () => ({ electron: '44', chrome: '140', node: '22' })
  } as unknown as typeof window.api
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('service account management form', () => {
  it('loads and preserves edit selections and submits the selected IDs', async () => {
    await act(async () =>
      root.render(
        React.createElement(Management, {
          section: 'Service Accounts',
          permissions: ['service_accounts.read', 'service_accounts.manage']
        })
      )
    )
    await act(async () => container.querySelector<HTMLButtonElement>('tbody button')!.click())
    expect(container.textContent).toContain(subscriber.name)
    expect(container.textContent).toContain(plan.name)

    const editButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Edit'
    )!
    await act(async () => editButton.click())

    const selects = [...container.querySelectorAll('select[name]')] as HTMLSelectElement[]
    const subscriberSelect = selects.find((select) => select.name === 'subscriberId')!
    const planSelect = selects.find((select) => select.name === 'planId')!
    expect(subscriberSelect.options.length).toBe(1)
    expect(planSelect.options.length).toBe(1)
    expect(subscriberSelect.value).toBe(subscriber.id)
    expect(planSelect.value).toBe(plan.id)

    const accountInput = container.querySelector<HTMLInputElement>(
      'input[name="accountIdentifier"]'
    )!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(accountInput, 'ACCT-001-UPDATED')
      accountInput.dispatchEvent(new Event('input', { bubbles: true }))
      accountInput.dispatchEvent(new Event('change', { bubbles: true }))
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(window.api.updateServiceAccount).toHaveBeenCalledWith(account.id, {
      accountIdentifier: 'ACCT-001-UPDATED',
      subscriberId: subscriber.id,
      planId: plan.id,
      status: 'active'
    })
    expect(container.textContent).toContain('ACCT-001-UPDATED')
    expect(container.textContent).toContain('Service account updated successfully.')
  })

  it('keeps read-only management screens free of create and edit actions', async () => {
    await act(async () =>
      root.render(
        React.createElement(Management, {
          section: 'Subscribers',
          permissions: ['subscribers.read']
        })
      )
    )
    expect(
      [...container.querySelectorAll('button')].some((button) =>
        button.textContent?.includes('Add Subscriber')
      )
    ).toBe(false)
    await act(async () => container.querySelector<HTMLButtonElement>('tbody button')!.click())
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Edit')
    ).toBe(false)
  })
})

describe('management list request ordering', () => {
  it('keeps results from the newest search when an older request finishes last', async () => {
    let resolveFirst!: (value: {
      items: Subscriber[]
      page: number
      limit: number
      total: number
    }) => void
    let resolveSecond!: (value: {
      items: Subscriber[]
      page: number
      limit: number
      total: number
    }) => void
    vi.mocked(window.api.listSubscribers)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )

    await act(async () =>
      root.render(
        React.createElement(Management, {
          section: 'Subscribers',
          permissions: ['subscribers.read']
        })
      )
    )
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search subscribers"]'
    )!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(search, 'Jamie')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      search.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const newerSubscriber = {
      ...subscriber,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Jamie Current Result'
    }
    await act(async () => resolveSecond({ items: [newerSubscriber], page: 1, limit: 25, total: 1 }))
    await act(async () =>
      resolveFirst({
        items: [{ ...subscriber, name: 'Stale Result' }],
        page: 1,
        limit: 25,
        total: 1
      })
    )

    expect(container.textContent).toContain('Jamie Current Result')
    expect(container.textContent).not.toContain('Stale Result')
  })

  it('keeps the latest selected record when an earlier detail request finishes last', async () => {
    const first = { ...account, accountIdentifier: 'ACCT-FIRST' }
    const second = {
      ...account,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      accountIdentifier: 'ACCT-SECOND'
    }
    let resolveFirst!: (value: ServiceAccount) => void
    let resolveSecond!: (value: ServiceAccount) => void
    window.api.listServiceAccounts = vi.fn(async () => ({
      items: [first, second],
      page: 1,
      limit: 25,
      total: 2
    }))
    window.api.getServiceAccount = vi.fn(
      (id: string) =>
        new Promise((resolve) => {
          if (id === first.id) resolveFirst = resolve
          else resolveSecond = resolve
        })
    )

    await act(async () =>
      root.render(
        React.createElement(Management, {
          section: 'Service Accounts',
          permissions: ['service_accounts.read']
        })
      )
    )
    const firstButton = [...container.querySelectorAll('tbody button')].find(
      (button) => button.textContent === first.accountIdentifier
    )!
    const secondButton = [...container.querySelectorAll('tbody button')].find(
      (button) => button.textContent === second.accountIdentifier
    )!
    await act(async () => {
      firstButton.click()
      secondButton.click()
    })

    await act(async () => resolveSecond(second))
    await act(async () => resolveFirst(first))

    expect(container.textContent).toContain('ACCT-SECOND')
    expect(container.textContent).not.toContain('ACCT-FIRST')
  })
})
