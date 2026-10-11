import { describe, expect, it, vi } from 'vitest'
import { createAdminApi } from '../src/main/admin-api'

describe('admin API session handling', () => {
  it('notifies the application when an administrative request has an expired session', async () => {
    const onSessionExpired = vi.fn()
    const api = createAdminApi(
      async () =>
        new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }),
      () => 'http://127.0.0.1:3000',
      onSessionExpired
    )

    await expect(api.listUsers()).rejects.toThrow('Your session expired.')
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('does not treat a permission denial as an expired session', async () => {
    const onSessionExpired = vi.fn()
    const api = createAdminApi(
      async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      () => 'http://127.0.0.1:3000',
      onSessionExpired
    )

    await expect(api.listUsers()).rejects.toThrow('Administrative access is required.')
    expect(onSessionExpired).not.toHaveBeenCalled()
  })
})
