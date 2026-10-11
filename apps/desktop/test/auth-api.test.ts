import { describe, expect, it, vi } from 'vitest'
import { AuthenticationApiError, createAuthenticationApi } from '../src/main/auth-api'
import type { SafeAuthenticatedUser } from '@bcis/shared'

const user: SafeAuthenticatedUser = {
  id: '4fd7c2e5-ff69-41f5-b0ef-0018a10eab42',
  loginIdentifier: 'person@example.test',
  status: 'active',
  roles: ['Registrar / Staff'],
  permissions: ['plans.read', 'subscribers.read']
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('desktop authentication API', () => {
  it('posts the shared login contract and returns only the safe user', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ user }))
    const api = createAuthenticationApi(fetcher)

    await expect(
      api.login({
        loginIdentifier: ' PERSON@example.test ',
        password: 'secret'
      })
    ).resolves.toEqual(user)

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginIdentifier: 'person@example.test',
          password: 'secret'
        })
      })
    )
  })

  it('loads the current user with session-cookie credentials', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ user }))
    const api = createAuthenticationApi(fetcher)

    await expect(api.getCurrentUser()).resolves.toEqual(user)
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/auth/me',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    )
  })

  it('treats an unauthenticated current-user response as no session', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'Authentication required' }, 401))
    const onSessionExpired = vi.fn()
    const api = createAuthenticationApi(fetcher, () => 'http://127.0.0.1:3000', onSessionExpired)

    await expect(api.getCurrentUser()).resolves.toBeNull()
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('posts logout with session-cookie credentials and expects 204', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const api = createAuthenticationApi(fetcher)

    await expect(api.logout()).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    )
  })

  it('surfaces the API authentication error message', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'Invalid login credentials' }, 401))
    const api = createAuthenticationApi(fetcher)

    await expect(
      api.login({ loginIdentifier: 'person@example.test', password: 'wrong' })
    ).rejects.toMatchObject({
      name: 'AuthenticationApiError',
      message: 'Invalid login credentials',
      status: 401
    } satisfies Partial<AuthenticationApiError>)
  })

  it('rejects responses that do not match the shared current-user contract', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ user: { id: 'invalid' } }))
    const api = createAuthenticationApi(fetcher)

    await expect(api.getCurrentUser()).rejects.toThrow(
      'BCIS API returned an invalid authentication response.'
    )
  })

  it('does not send malformed login requests', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ user }))
    const api = createAuthenticationApi(fetcher)
    const invalidRequest = {
      loginIdentifier: '',
      password: ''
    }

    await expect(api.login(invalidRequest)).rejects.toThrow(
      'Enter a valid login identifier and password.'
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
