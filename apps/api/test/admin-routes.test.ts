import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type {
  AuthService,
  AuthenticatedPrincipal
} from '../src/auth/service.js'
import {
  hasCompleteAdministratorPermissions,
  registerAdminRoutes
} from '../src/auth/admin-routes.js'

const cookie = `bcis_session=${'a'.repeat(43)}`

function authService(
  permissions: AuthenticatedPrincipal['permissions'] | null
): AuthService {
  return {
    initialize: async () => {},
    login: async () => null,
    revokeSession: async () => {},
    getSession: async () =>
      permissions
        ? {
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              loginIdentifier: 'test@example.org',
              status: 'active',
              roles: ['Student'],
              permissions
            },
            permissions
          }
        : null
  }
}

async function appFor(
  permissions: AuthenticatedPrincipal['permissions'] | null
) {
  const app = Fastify({ logger: false })
  app.decorateRequest('auth', null)
  await registerAdminRoutes(app, authService(permissions), false)
  await app.ready()
  return app
}

describe('administrator API authorization', () => {
  it('requires one active account to retain the complete administration permission set', () => {
    const required = [
      'users.read',
      'users.manage',
      'roles.manage',
      'permissions.manage'
    ] as const

    expect(hasCompleteAdministratorPermissions([new Set(required)])).toBe(true)
    expect(
      hasCompleteAdministratorPermissions([
        new Set(required.slice(0, 3)),
        new Set(required.slice(3))
      ])
    ).toBe(false)
    expect(
      hasCompleteAdministratorPermissions([new Set(required.slice(1))])
    ).toBe(false)
  })

  it('requires a session and server permissions for user and role operations', async () => {
    const unauthenticated = await appFor(null)
    const forbidden = await appFor([])
    const paths = [
      { method: 'GET', url: '/admin/users', permission: 'users.read' },
      {
        method: 'POST',
        url: '/admin/users',
        permission: 'users.manage',
        payload: {}
      },
      { method: 'GET', url: '/admin/roles', permission: 'roles.manage' },
      {
        method: 'PUT',
        url: '/admin/roles/Student/permissions',
        permission: 'permissions.manage',
        payload: { permissions: [] }
      }
    ] as const

    for (const route of paths) {
      expect(
        (await unauthenticated.inject({ method: route.method, url: route.url }))
          .statusCode
      ).toBe(401)
      expect(
        (
          await forbidden.inject({
            method: route.method,
            url: route.url,
            headers: { cookie },
            ...(route.payload ? { payload: route.payload } : {})
          })
        ).statusCode
      ).toBe(403)
    }
    await unauthenticated.close()
    await forbidden.close()
  })
})
