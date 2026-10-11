import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type {
  AuthService,
  AuthenticatedPrincipal
} from '../src/auth/service.js'
import { registerBusinessRoutes } from '../src/business/routes.js'
import {
  BusinessError,
  translateDatabaseError
} from '../src/business/errors.js'
import type { BusinessRepository } from '../src/business/repository.js'
import { createBusinessServices } from '../src/business/service.js'

const now = new Date('2026-01-01T00:00:00.000Z').toISOString()
const authCookie = `bcis_session=${'a'.repeat(43)}`
const plan = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Basic',
  description: null,
  price: '999.00',
  enabled: true,
  createdAt: now,
  updatedAt: now
}
const subscriber = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Sample Subscriber',
  email: null,
  phone: null,
  addressLine1: '1 Sample Street',
  addressLine2: null,
  city: 'Malaybalay',
  province: 'Bukidnon',
  postalCode: null,
  createdAt: now,
  updatedAt: now
}
const serviceAccount = {
  id: '33333333-3333-4333-8333-333333333333',
  accountIdentifier: 'ACCT-1',
  subscriberId: subscriber.id,
  planId: plan.id,
  status: 'active' as const,
  createdAt: now,
  updatedAt: now
}

function createRepository(
  overrides: Partial<BusinessRepository> = {}
): BusinessRepository {
  return {
    listPlans: async () => ({ items: [plan], total: 1 }),
    getPlan: async (id) => (id === plan.id ? plan : null),
    createPlan: async (input) => ({
      ...plan,
      ...input,
      description: input.description ?? null
    }),
    updatePlan: async (id, input) =>
      id === plan.id
        ? {
            ...plan,
            ...input,
            name: input.name ?? plan.name,
            description: input.description ?? plan.description,
            price: input.price ?? plan.price,
            enabled: input.enabled ?? plan.enabled
          }
        : null,
    deletePlan: async (id) => id === plan.id,
    listSubscribers: async () => ({ items: [subscriber], total: 1 }),
    getSubscriber: async (id) => (id === subscriber.id ? subscriber : null),
    createSubscriber: async (input) => ({
      ...subscriber,
      ...input,
      email: input.email ?? null,
      phone: input.phone ?? null,
      addressLine2: input.addressLine2 ?? null,
      postalCode: input.postalCode ?? null
    }),
    updateSubscriber: async (id, input) =>
      id === subscriber.id
        ? {
            ...subscriber,
            ...input,
            name: input.name ?? subscriber.name,
            email: input.email ?? subscriber.email,
            phone: input.phone ?? subscriber.phone,
            addressLine1: input.addressLine1 ?? subscriber.addressLine1,
            addressLine2: input.addressLine2 ?? subscriber.addressLine2,
            city: input.city ?? subscriber.city,
            province: input.province ?? subscriber.province,
            postalCode: input.postalCode ?? subscriber.postalCode
          }
        : null,
    deleteSubscriber: async (id) => id === subscriber.id,
    listServiceAccounts: async () => ({ items: [serviceAccount], total: 1 }),
    getServiceAccount: async (id) =>
      id === serviceAccount.id ? serviceAccount : null,
    createServiceAccount: async (input) => ({
      ...serviceAccount,
      ...input,
      accountIdentifier: input.accountIdentifier,
      subscriberId: input.subscriberId,
      planId: input.planId,
      status: input.status ?? serviceAccount.status
    }),
    updateServiceAccount: async (id, input) =>
      id === serviceAccount.id
        ? {
            ...serviceAccount,
            ...input,
            accountIdentifier:
              input.accountIdentifier ?? serviceAccount.accountIdentifier,
            subscriberId: input.subscriberId ?? serviceAccount.subscriberId,
            planId: input.planId ?? serviceAccount.planId,
            status: input.status ?? serviceAccount.status
          }
        : null,
    deleteServiceAccount: async (id) => id === serviceAccount.id,
    ...overrides
  }
}

function createAuthService(
  permissions: AuthenticatedPrincipal['permissions'] | null
): AuthService {
  return {
    initialize: async () => {},
    login: async () => null,
    getSession: async () =>
      permissions
        ? {
            user: {
              id: '44444444-4444-4444-8444-444444444444',
              loginIdentifier: 'tester@example.test',
              status: 'active',
              roles: ['Administrator'],
              permissions
            },
            permissions
          }
        : null,
    revokeSession: async () => {}
  }
}

async function createApp(
  repository: BusinessRepository,
  permissions: AuthenticatedPrincipal['permissions'] | null
) {
  const app = Fastify({ logger: false })
  app.decorateRequest('auth', null)
  const services = createBusinessServices(repository)
  await registerBusinessRoutes(app, {
    services,
    authService: createAuthService(permissions)
  })
  await app.ready()
  return app
}

describe('business services', () => {
  it('maps database uniqueness and foreign-key failures to client conflicts', () => {
    expect(translateDatabaseError({ code: '23505' })).toMatchObject({
      statusCode: 409
    })
    expect(translateDatabaseError({ code: '23503' })).toMatchObject({
      statusCode: 409
    })
    expect(translateDatabaseError(new Error('unexpected'))).toBeNull()
  })

  it('creates a plan and preserves decimal prices as strings', async () => {
    const services = createBusinessServices(
      createRepository({
        createPlan: async (input) => ({
          ...plan,
          ...input,
          description: input.description ?? null
        })
      })
    )

    await expect(
      services.plans.create({
        name: 'Basic',
        price: '999.00',
        enabled: true
      })
    ).resolves.toMatchObject({ price: '999.00' })
  })

  it('creates and updates subscribers through the service', async () => {
    const services = createBusinessServices(createRepository())
    await expect(
      services.subscribers.create({
        name: 'Sample Subscriber',
        addressLine1: '1 Sample Street',
        city: 'Malaybalay',
        province: 'Bukidnon'
      })
    ).resolves.toMatchObject({ name: 'Sample Subscriber' })
    await expect(
      services.subscribers.update(subscriber.id, { phone: '123456789' })
    ).resolves.toMatchObject({ phone: '123456789' })
  })

  it('creates linked service accounts through the service', async () => {
    const services = createBusinessServices(createRepository())
    await expect(
      services.serviceAccounts.create({
        accountIdentifier: 'ACCT-1',
        subscriberId: subscriber.id,
        planId: plan.id,
        status: 'active'
      })
    ).resolves.toMatchObject({
      subscriberId: subscriber.id,
      planId: plan.id,
      status: 'active'
    })
  })

  it('rejects service accounts with missing subscriber or plan relationships', async () => {
    const services = createBusinessServices(
      createRepository({ getSubscriber: async () => null })
    )

    await expect(
      services.serviceAccounts.create({
        accountIdentifier: 'ACCT-1',
        subscriberId: subscriber.id,
        planId: plan.id,
        status: 'active'
      })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns not found for missing records', async () => {
    const services = createBusinessServices(
      createRepository({ getPlan: async () => null })
    )
    await expect(services.plans.get(plan.id)).rejects.toMatchObject({
      statusCode: 404
    })
  })

  it('propagates duplicate-identifier conflicts from the repository', async () => {
    const services = createBusinessServices(
      createRepository({
        createServiceAccount: async () => {
          throw new BusinessError('Duplicate identifier', 409)
        }
      })
    )
    await expect(
      services.serviceAccounts.create({
        accountIdentifier: 'ACCT-1',
        subscriberId: subscriber.id,
        planId: plan.id,
        status: 'active'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('business API routes', () => {
  it('requires manage permissions and returns conflicts when linked records cannot be deleted', async () => {
    const forbidden = await createApp(createRepository(), [])
    const denied = await forbidden.inject({
      method: 'DELETE',
      url: `/plans/${plan.id}`,
      headers: { cookie: authCookie }
    })
    expect(denied.statusCode).toBe(403)
    await forbidden.close()

    const app = await createApp(
      createRepository({
        deletePlan: async () => {
          throw new BusinessError(
            'A referenced record does not exist or is in use',
            409
          )
        }
      }),
      ['plans.manage']
    )
    const conflict = await app.inject({
      method: 'DELETE',
      url: `/plans/${plan.id}`,
      headers: { cookie: authCookie }
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({
      error: 'A referenced record does not exist or is in use'
    })
    await app.close()
  })

  it('requires authentication and the explicit read permission', async () => {
    const unauthenticated = await createApp(createRepository(), null)
    const noPermission = await createApp(createRepository(), [])

    expect((await unauthenticated.inject('/plans')).statusCode).toBe(401)
    expect(
      (
        await noPermission.inject({
          url: '/plans',
          headers: { cookie: authCookie }
        })
      ).statusCode
    ).toBe(403)

    await unauthenticated.close()
    await noPermission.close()
  })

  it('serves a paginated plan list with an approved permission', async () => {
    const app = await createApp(createRepository(), ['plans.read'])
    const response = await app.inject({
      url: '/plans?page=1&limit=10',
      headers: { cookie: authCookie }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      items: [{ id: plan.id, price: '999.00' }],
      page: 1,
      limit: 10,
      total: 1
    })
    await app.close()
  })

  it('serves subscriber and service-account list and detail operations', async () => {
    const app = await createApp(createRepository(), [
      'subscribers.read',
      'service_accounts.read'
    ])
    const headers = { cookie: authCookie }
    const responses = await Promise.all([
      app.inject({ url: '/subscribers?page=1&limit=10', headers }),
      app.inject({ url: '/subscribers?page=1&limit=10&q=Jamie', headers }),
      app.inject({ url: `/subscribers/${subscriber.id}`, headers }),
      app.inject({
        url: `/service-accounts?status=active&subscriberId=${subscriber.id}`,
        headers
      }),
      app.inject({ url: `/service-accounts/${serviceAccount.id}`, headers })
    ])

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([
      200, 200, 200, 200, 200
    ])
    expect(responses[1]?.json()).toMatchObject({
      items: [{ id: subscriber.id }],
      page: 1,
      limit: 10,
      total: 1
    })
    await app.close()
  })

  it('rejects strict-schema violations and reports missing records consistently', async () => {
    const app = await createApp(createRepository(), [
      'plans.manage',
      'plans.read'
    ])
    const invalid = await app.inject({
      method: 'POST',
      url: '/plans',
      headers: { cookie: authCookie },
      payload: { name: 'Basic', price: '1.001', unexpected: true }
    })
    const missing = await app.inject({
      url: '/plans/55555555-5555-4555-8555-555555555555',
      headers: { cookie: authCookie }
    })

    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toEqual({ error: 'Invalid request' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'Plan not found' })
    await app.close()
  })

  it('creates linked service accounts with explicit manage permission', async () => {
    const app = await createApp(createRepository(), ['service_accounts.manage'])
    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: { cookie: authCookie },
      payload: {
        accountIdentifier: 'ACCT-1',
        subscriberId: subscriber.id,
        planId: plan.id
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      accountIdentifier: 'ACCT-1',
      subscriberId: subscriber.id,
      planId: plan.id,
      status: 'active'
    })
    await app.close()
  })

  it('creates a subscriber with explicit manage permission', async () => {
    const app = await createApp(createRepository(), ['subscribers.manage'])
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: { cookie: authCookie },
      payload: {
        name: 'Sample Subscriber',
        addressLine1: '1 Sample Street',
        city: 'Malaybalay',
        province: 'Bukidnon'
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      name: 'Sample Subscriber',
      addressLine1: '1 Sample Street'
    })
    await app.close()
  })

  it('updates plans, subscribers, and service accounts with their manage permissions', async () => {
    const app = await createApp(createRepository(), [
      'plans.manage',
      'subscribers.manage',
      'service_accounts.manage'
    ])
    const headers = { cookie: authCookie }
    const responses = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/plans/${plan.id}`,
        headers,
        payload: { price: '1200.50' }
      }),
      app.inject({
        method: 'PATCH',
        url: `/subscribers/${subscriber.id}`,
        headers,
        payload: { phone: '123456789' }
      }),
      app.inject({
        method: 'PATCH',
        url: `/service-accounts/${serviceAccount.id}`,
        headers,
        payload: { status: 'suspended' }
      })
    ])

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([
      200, 200, 200
    ])
    expect(responses[0]?.json()).toMatchObject({ price: '1200.50' })
    expect(responses[2]?.json()).toMatchObject({ status: 'suspended' })
    await app.close()
  })

  it('returns a consistent conflict for duplicate service-account identifiers', async () => {
    const app = await createApp(
      createRepository({
        createServiceAccount: async () => {
          throw new BusinessError(
            'A record with this identifier already exists',
            409
          )
        }
      }),
      ['service_accounts.manage']
    )
    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: { cookie: authCookie },
      payload: {
        accountIdentifier: 'ACCT-1',
        subscriberId: subscriber.id,
        planId: plan.id
      }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: 'A record with this identifier already exists'
    })
    await app.close()
  })
})
