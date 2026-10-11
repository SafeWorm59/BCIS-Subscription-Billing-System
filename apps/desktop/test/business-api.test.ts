import { describe, expect, it, vi } from 'vitest'
import { createBusinessApi } from '../src/main/business-api'

describe('business API client', () => {
  it('requests and validates the paginated payment list contract', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                invoiceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                invoiceNumber: 'INV-202610-0001',
                accountIdentifier: 'ACCT-1',
                subscriberName: 'Jamie Subscriber',
                amount: '100.00',
                receivedAt: '2026-10-11T12:00:00.000Z'
              }
            ],
            page: 1,
            limit: 25,
            total: 1
          }),
          { status: 200 }
        )
    )
    const api = createBusinessApi(fetcher)
    const result = await api.listPayments({
      page: 1,
      limit: 25,
      q: 'Jamie',
      receivedAtStart: '2026-10-01',
      receivedAtEnd: '2026-10-31'
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/v1/payments?page=1&limit=25&q=Jamie&receivedAtStart=2026-10-01&receivedAtEnd=2026-10-31',
      expect.objectContaining({ credentials: 'include', method: 'GET' })
    )
    expect(result.items[0]?.subscriberName).toBe('Jamie Subscriber')
  })

  it('signals expired sessions when a protected API call receives 401', async () => {
    const onUnauthorized = vi.fn()
    const api = createBusinessApi(
      async () =>
        new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 }),
      onUnauthorized
    )
    await expect(api.listPayments({ page: 1, limit: 25 })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
