// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SafeAuthenticatedUser } from '@bcis/shared'
import App from '../src/renderer/src/App'

const user: SafeAuthenticatedUser = {
  id: '4fd7c2e5-ff69-41f5-b0ef-0018a10eab42',
  loginIdentifier: 'person@example.test',
  status: 'active',
  roles: ['Registrar / Staff'],
  permissions: ['plans.read', 'subscribers.read']
}

let container: HTMLDivElement
let root: Root
let expireSession: (() => void) | undefined

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  expireSession = undefined
  window.api = {
    onSessionExpired: (listener) => {
      expireSession = listener
      return () => {
        expireSession = undefined
      }
    },
    getRuntimeVersions: () => ({ electron: '44', chrome: '140', node: '22' }),
    getCurrentUser: vi.fn(async () => null),
    login: vi.fn(async () => user),
    logout: vi.fn(async () => {}),
    listSubscribers: vi.fn(async () => ({ items: [], page: 1, limit: 1, total: 8 })),
    listPlans: vi.fn(async () => ({ items: [], page: 1, limit: 1, total: 3 }))
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function enterLoginAndSubmit(): Promise<void> {
  await act(async () => {
    setInputValue(
      container.querySelector<HTMLInputElement>('#loginIdentifier')!,
      'person@example.test'
    )
    setInputValue(container.querySelector<HTMLInputElement>('#password')!, 'secret')
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('desktop authentication UI', () => {
  it('waits for the current-user check and shows login when there is no session', async () => {
    let resolveCurrentUser!: (currentUser: SafeAuthenticatedUser | null) => void
    window.api.getCurrentUser = vi.fn(
      () =>
        new Promise<SafeAuthenticatedUser | null>((resolve) => {
          resolveCurrentUser = resolve
        })
    )

    await act(async () => root.render(React.createElement(App)))
    expect(container.textContent).toContain('Checking your session')
    expect(container.querySelector('form')).toBeNull()

    await act(async () => resolveCurrentUser(null))
    expect(container.querySelector('form')).not.toBeNull()
    expect(container.textContent).toContain('Sign in to BCIS')
    expect(container.textContent).not.toContain('Welcome to your workspace')
  })

  it('opens the dashboard when the current-user endpoint confirms a session', async () => {
    window.api.getCurrentUser = vi.fn(async () => user)

    await act(async () => root.render(React.createElement(App)))

    expect(container.textContent).toContain('Workspace overview')
    expect(container.textContent).toContain('8')
    expect(container.textContent).toContain('person@example.test')
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('button[title="Plans"]')).not.toBeNull()
    expect(container.querySelector('button[title="Billing"]')).toBeNull()
    expect(container.textContent).not.toContain('SOON')
  })

  it('shows the authenticated dashboard after login and returns to login on logout', async () => {
    const login = vi.fn(async () => user)
    const logout = vi.fn(async () => {})
    window.api.login = login
    window.api.logout = logout

    await act(async () => root.render(React.createElement(App)))
    await enterLoginAndSubmit()

    expect(login).toHaveBeenCalledWith({
      loginIdentifier: 'person@example.test',
      password: 'secret'
    })
    expect(container.textContent).toContain('Workspace overview')
    expect(container.textContent).toContain('person@example.test')
    expect(container.querySelector('form')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Sign out"]')!.click()
    })

    expect(logout).toHaveBeenCalledOnce()
    expect(container.querySelector('form')).not.toBeNull()
    expect(container.textContent).not.toContain('Welcome to your workspace')
  })

  it('returns to sign-in when a protected API request reports an expired session', async () => {
    window.api.getCurrentUser = vi.fn(async () => user)
    await act(async () => root.render(React.createElement(App)))
    expect(container.textContent).toContain('Workspace overview')
    await act(async () => expireSession?.())
    expect(container.textContent).toContain('Your session expired. Sign in again to continue.')
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('displays login errors without showing the dashboard', async () => {
    window.api.login = vi.fn(async () => {
      throw new Error('Invalid login credentials')
    })

    await act(async () => root.render(React.createElement(App)))
    await enterLoginAndSubmit()

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid login credentials')
    expect(container.textContent).not.toContain('Welcome to your workspace')
  })
})
