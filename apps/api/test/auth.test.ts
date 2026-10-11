import { createHash } from 'node:crypto'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthService, AuthRepository } from '../src/auth/service.js'
import { createAuthService } from '../src/auth/service.js'
import {
  createDatabaseLoginRateLimitStore,
  createLoginRateLimiter,
  type LoginRateLimiter,
  type LoginRateLimitOptions,
  type LoginRateLimitStore,
  type RateLimitBucket
} from '../src/auth/rate-limit.js'
import {
  developmentCookieName,
  productionCookieName,
  requirePermission
} from '../src/auth/routes.js'
import { buildApp } from '../src/app.js'
import type { SafeAuthenticatedUser } from '@bcis/shared'

const testToken = 'a'.repeat(43)
const testPasswordHash = '$argon2id$test-hash'
const safeUser: SafeAuthenticatedUser = {
  id: '4fd7c2e5-ff69-41f5-b0ef-0018a10eab42',
  loginIdentifier: 'person@example.test',
  status: 'active',
  roles: ['Registrar / Staff'],
  permissions: ['plans.read', 'subscribers.read']
}

function createFakeAuthService(
  overrides: Partial<AuthService> = {}
): AuthService & { revoked: string[] } {
  const revoked: string[] = []
  return {
    revoked,
    initialize: async () => {},
    login: async () => ({ token: testToken, user: safeUser }),
    getSession: async (token) =>
      token === testToken
        ? { user: safeUser, permissions: ['users.read'] }
        : null,
    revokeSession: async (token) => {
      revoked.push(token)
    },
    ...overrides
  }
}

function createApp(
  authService: AuthService,
  options: {
    secureCookies?: boolean
    rateLimit?: LoginRateLimitOptions
    loginRateLimiter?: LoginRateLimiter
    logger?:
      false | { level: string; stream: { write: (chunk: string) => void } }
  } = {}
) {
  return buildApp({
    logger: options.logger ?? false,
    authService,
    loginRateLimiter:
      options.loginRateLimiter ?? createTestRateLimiter(options.rateLimit),
    ...(options.secureCookies === undefined
      ? {}
      : { secureCookies: options.secureCookies }),
    databaseCheck: async () => {},
    closeDatabase: async () => {}
  })
}

function createTestRateLimiter(
  options: LoginRateLimitOptions = {}
): LoginRateLimiter {
  return createLoginRateLimiter(createTestRateLimitStore(), options)
}

function createTestRateLimitStore(): LoginRateLimitStore {
  const counts = new Map<string, { windowStartedAt: Date; count: number }>()
  return {
    async incrementBuckets(buckets: RateLimitBucket[]) {
      return buckets.map((bucket) => {
        const current = counts.get(bucket.keyHash)
        const currentWindow = current?.windowStartedAt.getTime()
        const requestedWindow = bucket.windowStartedAt.getTime()
        let count = 1
        let windowStartedAt = bucket.windowStartedAt
        if (current && currentWindow !== undefined) {
          if (currentWindow > requestedWindow) {
            count = current.count
            windowStartedAt = current.windowStartedAt
          } else if (currentWindow === requestedWindow) {
            count = Math.min(current.count + 1, bucket.maximum + 1)
          }
        }
        counts.set(bucket.keyHash, {
          windowStartedAt,
          count
        })
        return count
      })
    }
  }
}

describe('authentication API', () => {
  it('logs in with a safe response and a host-only HttpOnly cookie', async () => {
    const app = createApp(createFakeAuthService())
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { loginIdentifier: ' PERSON@example.test ', password: 'secret' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: safeUser })
    expect(response.body).not.toContain(testToken)
    expect(response.body).not.toContain(testPasswordHash)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['set-cookie']).toContain(
      `${developmentCookieName}=${testToken}`
    )
    expect(response.headers['set-cookie']).toContain('Path=/')
    expect(response.headers['set-cookie']).toContain('HttpOnly')
    expect(response.headers['set-cookie']).toContain('SameSite=Strict')
    expect(response.headers['set-cookie']).not.toContain('Domain=')
    expect(response.headers['set-cookie']).not.toContain('; Secure')

    await app.close()
  })

  it('uses the Secure __Host- cookie in production mode', async () => {
    const app = createApp(createFakeAuthService(), { secureCookies: true })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { loginIdentifier: 'person@example.test', password: 'secret' }
    })

    expect(response.headers['set-cookie']).toContain(
      `${productionCookieName}=${testToken}`
    )
    expect(response.headers['set-cookie']).toContain('; Secure')
    expect(response.headers['set-cookie']).not.toContain('Domain=')

    await app.close()
  })

  it('rejects invalid strict login request bodies', async () => {
    const login = vi.fn(async () => ({ token: testToken, user: safeUser }))
    const app = createApp(createFakeAuthService({ login }))
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        loginIdentifier: 'person@example.test',
        password: 'secret',
        extra: 'not permitted'
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'Invalid request' })
    expect(login).not.toHaveBeenCalled()

    await app.close()
  })

  it.each([
    ['unknown user', null, false],
    [
      'incorrect password',
      {
        id: safeUser.id,
        loginIdentifier: safeUser.loginIdentifier,
        passwordHash: testPasswordHash,
        status: 'active' as const
      },
      false
    ],
    [
      'disabled account',
      {
        id: safeUser.id,
        loginIdentifier: safeUser.loginIdentifier,
        passwordHash: testPasswordHash,
        status: 'disabled' as const
      },
      true
    ]
  ])(
    'returns the same generic response for %s',
    async (_label, user, passwordValid) => {
      const verify = vi.fn(async () => passwordValid)
      const authService = createAuthService(
        {
          findUserByLoginIdentifier: async () => user,
          createSession: async () => {},
          findSessionByTokenHash: async () => null,
          listRoleNames: async () => [],
          listPermissionKeys: async () => [],
          revokeSession: async () => {}
        },
        {
          verify,
          hashDummyPassword: async () => 'dummy-password-hash'
        }
      )
      const app = createApp(authService)
      await app.ready()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { loginIdentifier: 'person@example.test', password: 'secret' }
      })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: 'Invalid login credentials'
      })
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(verify).toHaveBeenCalledOnce()
      if (user === null) {
        expect(verify).toHaveBeenCalledWith('dummy-password-hash', 'secret')
      }
      await app.close()
    }
  )

  it('waits for dummy-hash initialization before app readiness', async () => {
    let completeHash!: (hash: string) => void
    const hashDummyPassword = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          completeHash = resolve
        })
    )
    const verify = vi.fn(async () => false)
    const service = createAuthService(
      {
        findUserByLoginIdentifier: async () => null,
        createSession: async () => {},
        findSessionByTokenHash: async () => null,
        listRoleNames: async () => [],
        listPermissionKeys: async () => [],
        revokeSession: async () => {}
      },
      { hashDummyPassword, verify }
    )
    const app = createApp(service)
    let appIsReady = false
    const ready = app.ready().then(() => {
      appIsReady = true
    })

    await vi.waitFor(() => expect(hashDummyPassword).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(appIsReady).toBe(false)

    completeHash('dummy-password-hash')
    await ready
    expect(appIsReady).toBe(true)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { loginIdentifier: 'person@example.test', password: 'secret' }
    })

    expect(response.statusCode).toBe(401)
    expect(verify).toHaveBeenCalledWith('dummy-password-hash', 'secret')
    await app.close()
  })

  it('does not become ready when dummy-hash initialization fails', async () => {
    const findUserByLoginIdentifier = vi.fn(async () => null)
    const service = createAuthService(
      {
        findUserByLoginIdentifier,
        createSession: async () => {},
        findSessionByTokenHash: async () => null,
        listRoleNames: async () => [],
        listPermissionKeys: async () => [],
        revokeSession: async () => {}
      },
      {
        hashDummyPassword: async () => {
          throw new Error('hash initialization failed')
        }
      }
    )
    const app = createApp(service)

    await expect(
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { loginIdentifier: 'person@example.test', password: 'secret' }
      })
    ).rejects.toThrow('hash initialization failed')
    expect(findUserByLoginIdentifier).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns the current user for a valid session only', async () => {
    const app = createApp(createFakeAuthService())
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `${developmentCookieName}=${testToken}` }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: safeUser })
    expect(response.body).not.toContain(testToken)
    expect(response.body).not.toContain(testPasswordHash)
    expect(response.headers['cache-control']).toBe('no-store')

    await app.close()
  })

  it.each([
    ['missing', undefined],
    ['malformed', `${developmentCookieName}=invalid!`],
    ['expired', `${developmentCookieName}=${'b'.repeat(43)}`],
    ['revoked', `${developmentCookieName}=${'c'.repeat(43)}`],
    ['disabled user', `${developmentCookieName}=${'d'.repeat(43)}`]
  ])('rejects a %s session', async (_label, cookie) => {
    const getSession = async () => null
    const app = createApp(createFakeAuthService({ getSession }))
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      ...(cookie ? { headers: { cookie } } : {})
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Authentication required' })
    await app.close()
  })

  it('revokes a session, clears its cookie, and permits repeated logout', async () => {
    const auth = createFakeAuthService()
    const app = createApp(auth)
    await app.ready()

    const headers = { cookie: `${developmentCookieName}=${testToken}` }
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers
    })

    expect(first.statusCode).toBe(204)
    expect(first.headers['set-cookie']).toContain(`${developmentCookieName}=`)
    expect(first.headers['set-cookie']).toContain('Max-Age=0')
    expect(first.headers['set-cookie']).toContain('HttpOnly')
    expect(first.headers['set-cookie']).not.toContain('Domain=')
    expect(second.statusCode).toBe(204)
    expect(auth.revoked).toEqual([testToken, testToken])
    await app.close()
  })

  it('limits repeated login attempts for an IP and normalized identifier', async () => {
    const app = createApp(createFakeAuthService({ login: async () => null }), {
      rateLimit: { maxAttempts: 2, windowMs: 60_000 }
    })
    await app.ready()

    const sendLogin = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { loginIdentifier: ' PERSON@example.test ', password: 'wrong' }
      })
    const first = await sendLogin()
    const second = await sendLogin()
    const third = await sendLogin()

    expect(first.statusCode).toBe(401)
    expect(second.statusCode).toBe(401)
    expect(third.statusCode).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
    await app.close()
  })

  it('also limits attempts across different login identifiers from one IP', async () => {
    const app = createApp(createFakeAuthService({ login: async () => null }), {
      rateLimit: { maxAttempts: 2, windowMs: 60_000 }
    })
    await app.ready()

    const responses = []
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            loginIdentifier: `person${attempt}@example.test`,
            password: 'wrong'
          }
        })
      )
    }

    expect(
      responses.slice(0, 10).every(({ statusCode }) => statusCode === 401)
    ).toBe(true)
    expect(responses[10]?.statusCode).toBe(429)
    await app.close()
  })

  it('rejects cross-origin state-changing requests', async () => {
    const app = createApp(createFakeAuthService())
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://attacker.example' },
      payload: { loginIdentifier: 'person@example.test', password: 'secret' }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'Request origin not allowed' })
    await app.close()
  })

  it('refuses insecure development authentication from non-loopback clients', async () => {
    const app = createApp(createFakeAuthService())
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '192.0.2.10',
      payload: { loginIdentifier: 'person@example.test', password: 'secret' }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: 'Authentication is limited to localhost in development'
    })
    await app.close()
  })

  it('does not include supplied secrets in authentication error logs', async () => {
    let logs = ''
    const auth = createFakeAuthService({
      login: async () => {
        throw new Error(
          `failure ${testToken} ${testPasswordHash} password=secret`
        )
      }
    })
    const app = createApp(auth, {
      logger: {
        level: 'error',
        stream: {
          write(chunk) {
            logs += chunk
          }
        }
      }
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        loginIdentifier: 'person@example.test',
        password: 'secret'
      }
    })

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain(testToken)
    expect(logs).not.toContain(testToken)
    expect(logs).not.toContain(testPasswordHash)
    expect(logs).not.toContain('secret')
    await app.close()
  })
})

describe('login rate limiter window ordering', () => {
  it('generates an upsert that preserves the newest window and its count', async () => {
    let conflictUpdate: { windowStartedAt: SQL; attemptCount: SQL } | undefined
    const transaction = {
      delete: () => ({
        where: async () => undefined
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: ({
            set
          }: {
            set: { windowStartedAt: SQL; attemptCount: SQL }
          }) => {
            conflictUpdate = set
            return {
              returning: async () => [{ attemptCount: 1 }]
            }
          }
        })
      })
    }
    const database = {
      transaction: async (
        callback: (transaction: never) => Promise<number[]>
      ) => callback(transaction as never)
    } as unknown as Parameters<typeof createDatabaseLoginRateLimitStore>[0]

    await createDatabaseLoginRateLimitStore(database).incrementBuckets([
      {
        keyHash: 'a'.repeat(64),
        maximum: 5,
        windowStartedAt: new Date(120_000)
      }
    ])

    expect(conflictUpdate).toBeDefined()
    if (!conflictUpdate) {
      throw new Error('Rate-limit upsert conflict update was not captured')
    }
    const dialect = new PgDialect()
    const windowSql = dialect.sqlToQuery(conflictUpdate.windowStartedAt).sql
    const countSql = dialect
      .sqlToQuery(conflictUpdate.attemptCount)
      .sql.toLowerCase()
    expect(windowSql.toLowerCase()).toContain('greatest(')
    expect(windowSql.toLowerCase()).toContain('excluded.window_started_at')
    expect(countSql).toContain('= excluded.window_started_at then least(')
    expect(countSql).toContain('< excluded.window_started_at then 1')
    expect(countSql).toContain(
      'else "login_rate_limit_buckets"."attempt_count" end'
    )
  })

  it('does not let a delayed older-window request reset the current counter', async () => {
    const store = createTestRateLimitStore()
    const olderWindowStartedAt = 60_000
    const currentWindowStartedAt = 120_000
    let now = olderWindowStartedAt + 1
    let releaseOlderRequest: (() => void) | undefined
    const olderRequestGate = new Promise<void>((resolve) => {
      releaseOlderRequest = resolve
    })
    const delayedStore: LoginRateLimitStore = {
      async incrementBuckets(buckets) {
        if (buckets[0]?.windowStartedAt.getTime() === olderWindowStartedAt) {
          await olderRequestGate
        }
        return store.incrementBuckets(buckets)
      }
    }
    const limiter = createLoginRateLimiter(delayedStore, {
      maxAttempts: 1,
      windowMs: 60_000,
      now: () => now
    })

    const delayedOlderRequest = limiter.check(
      '127.0.0.1',
      'person@example.test'
    )
    now = currentWindowStartedAt + 1
    await expect(
      limiter.check('127.0.0.1', 'person@example.test')
    ).resolves.toBeNull()
    releaseOlderRequest?.()
    await expect(delayedOlderRequest).resolves.toBeNull()
    await expect(
      limiter.check('127.0.0.1', 'person@example.test')
    ).resolves.toBeGreaterThan(0)
  })

  it('resets the counter when a newer time window begins', async () => {
    let now = 60_001
    const limiter = createLoginRateLimiter(createTestRateLimitStore(), {
      maxAttempts: 1,
      windowMs: 60_000,
      now: () => now
    })

    await expect(
      limiter.check('127.0.0.1', 'person@example.test')
    ).resolves.toBeNull()
    now = 120_001
    await expect(
      limiter.check('127.0.0.1', 'person@example.test')
    ).resolves.toBeNull()
    await expect(
      limiter.check('127.0.0.1', 'person@example.test')
    ).resolves.toBeGreaterThan(0)
  })

  it('counts concurrent checks without exceeding the configured allowance', async () => {
    const limiter = createLoginRateLimiter(createTestRateLimitStore(), {
      maxAttempts: 5,
      windowMs: 60_000,
      now: () => 120_001
    })

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.check('127.0.0.1', 'person@example.test')
      )
    )

    expect(results.filter((result) => result === null)).toHaveLength(5)
    expect(results.filter((result) => result !== null)).toHaveLength(15)
  })
})

describe('authentication service', () => {
  it('hashes generated session tokens and applies the 12-hour absolute expiry', async () => {
    let storedSession:
      { userId: string; tokenHash: string; expiresAt: Date } | undefined
    const createSession = vi.fn(async (session) => {
      storedSession = session
    })
    const repository: AuthRepository = {
      findUserByLoginIdentifier: async () => ({
        id: safeUser.id,
        loginIdentifier: safeUser.loginIdentifier,
        passwordHash: 'stored-hash',
        status: 'active'
      }),
      createSession,
      findSessionByTokenHash: async () => null,
      listRoleNames: async () => safeUser.roles,
      listPermissionKeys: async () => [],
      revokeSession: async () => {}
    }
    const fixedNow = new Date('2026-10-09T12:00:00.000Z')
    const service = createAuthService(repository, {
      now: () => fixedNow,
      verify: async () => true
    })

    const result = await service.login({
      loginIdentifier: safeUser.loginIdentifier,
      password: 'test-only'
    })

    expect(result).not.toBeNull()
    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(storedSession?.tokenHash).toBe(
      createHash('sha256')
        .update(result?.token ?? '')
        .digest('hex')
    )
    expect(storedSession?.tokenHash).not.toBe(result?.token)
    expect(storedSession?.expiresAt.getTime()).toBe(
      fixedNow.getTime() + 12 * 60 * 60 * 1000
    )
    expect(createSession).toHaveBeenCalledOnce()
  })

  it('checks expiry, revocation, and disabled status before resolving a session', async () => {
    let sessionStatus: 'active' | 'disabled' = 'active'
    let revokedAt: Date | null = null
    let expiresAt = new Date('2026-10-09T13:00:00.000Z')
    const findSessionByTokenHash = vi.fn(async () => ({
      userId: safeUser.id,
      loginIdentifier: safeUser.loginIdentifier,
      status: sessionStatus,
      expiresAt,
      revokedAt
    }))
    const repository: AuthRepository = {
      findUserByLoginIdentifier: async () => null,
      createSession: async () => {},
      findSessionByTokenHash,
      listRoleNames: async () => safeUser.roles,
      listPermissionKeys: async () => [],
      revokeSession: async () => {}
    }
    const service = createAuthService(repository, {
      now: () => new Date('2026-10-09T12:00:00.000Z')
    })

    expect(await service.getSession(testToken)).not.toBeNull()
    expect(findSessionByTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update(testToken).digest('hex')
    )
    expiresAt = new Date('2026-10-09T12:00:00.000Z')
    expect(await service.getSession(testToken)).toBeNull()
    expiresAt = new Date('2026-10-09T13:00:00.000Z')
    revokedAt = new Date('2026-10-09T11:00:00.000Z')
    expect(await service.getSession(testToken)).toBeNull()
    revokedAt = null
    sessionStatus = 'disabled'
    expect(await service.getSession(testToken)).toBeNull()
    expect(await service.getSession('invalid')).toBeNull()
  })
})

describe('permission enforcement', () => {
  it('allows only explicitly assigned permissions and rejects unauthenticated users', async () => {
    const app = Fastify({ logger: false })
    app.decorateRequest('auth', null)
    app.addHook('onRequest', async (request) => {
      if (request.headers.authorization === 'Bearer permitted') {
        request.auth = { user: safeUser, permissions: ['users.read'] }
      } else if (request.headers.authorization === 'Bearer denied') {
        request.auth = { user: safeUser, permissions: [] }
      }
    })
    app.get(
      '/protected',
      { preHandler: requirePermission('users.read') },
      async () => ({
        ok: true
      })
    )
    await app.ready()

    const allowed = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer permitted' }
    })
    const denied = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer denied' }
    })
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/protected'
    })

    expect(allowed.statusCode).toBe(200)
    expect(denied.statusCode).toBe(403)
    expect(unauthenticated.statusCode).toBe(401)
    await app.close()
  })
})
