import { isIP } from 'node:net'
import {
  authenticationErrorResponseSchema,
  currentUserResponseSchema,
  loginRequestSchema,
  type PermissionKey
} from '@bcis/shared'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler
} from 'fastify'
import type { LoginRateLimiter } from './rate-limit.js'
import type { AuthService } from './service.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth: Awaited<ReturnType<AuthService['getSession']>>
  }
}

const developmentCookieName = 'bcis_session'
const productionCookieName = '__Host-bcis_session'
const tokenPattern = /^[A-Za-z0-9_-]{43}$/
const sessionLifetimeSeconds = 12 * 60 * 60
const invalidCredentials = { error: 'Invalid login credentials' }
const authenticationRequired = { error: 'Authentication required' }

export interface AuthRoutesOptions {
  authService: AuthService
  loginRateLimiter: LoginRateLimiter
  secureCookies?: boolean
}

function escapeCookieValue(value: string): string {
  return encodeURIComponent(value)
}

function readSessionToken(
  cookieHeader: string | undefined,
  name: string
): string | null {
  if (!cookieHeader) {
    return null
  }

  const matches = cookieHeader.split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator === -1 || part.slice(0, separator).trim() !== name) {
      return []
    }
    return [part.slice(separator + 1).trim()]
  })

  if (matches.length !== 1 || !tokenPattern.test(matches[0] ?? '')) {
    return null
  }

  return matches[0] ?? null
}

function cookieHeader(
  name: string,
  value: string,
  secure: boolean,
  maxAge: number,
  expires?: Date
): string {
  const parts = [
    `${name}=${escapeCookieValue(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ]
  if (secure) {
    parts.push('Secure')
  }
  if (expires) {
    parts.push(`Expires=${expires.toUTCString()}`)
  }
  return parts.join('; ')
}

function sendAuthError(
  reply: FastifyReply,
  status: number,
  body: { error: string }
): FastifyReply {
  const response = authenticationErrorResponseSchema.parse(body)
  return reply.code(status).send(response)
}

function isAllowedOrigin(request: FastifyRequest, secure: boolean): boolean {
  const origin = request.headers.origin
  if (!origin) {
    return request.headers['sec-fetch-site'] !== 'cross-site'
  }
  if (origin === 'null' || !request.headers.host) {
    return false
  }

  try {
    const parsedOrigin = new URL(origin)
    return (
      parsedOrigin.host === request.headers.host &&
      parsedOrigin.protocol === (secure ? 'https:' : 'http:')
    )
  } catch {
    return false
  }
}

function isLoopbackAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return address.startsWith('127.')
  }
  if (isIP(address) !== 6) {
    return false
  }

  const normalizedAddress = address.toLowerCase()
  if (normalizedAddress === '::1') {
    return true
  }
  if (normalizedAddress.startsWith('::ffff:')) {
    return isLoopbackAddress(normalizedAddress.slice('::ffff:'.length))
  }
  return false
}

function logAuthFailure(request: FastifyRequest, action: string): void {
  request.log.error(
    { requestId: request.id, action },
    'Authentication operation failed'
  )
}

export function requirePermission(
  permission: PermissionKey
): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.auth) {
      return sendAuthError(reply, 401, authenticationRequired)
    }
    if (!request.auth.permissions.includes(permission)) {
      return sendAuthError(reply, 403, { error: 'Forbidden' })
    }
  }
}

export function createAuthenticationHook(
  authService: AuthService,
  secureCookies = false
): preHandlerHookHandler {
  return async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!secureCookies && !isLoopbackAddress(request.ip)) {
      return sendAuthError(reply, 403, {
        error: 'Authentication is limited to localhost in development'
      })
    }
    const token = readSessionToken(
      request.headers.cookie,
      secureCookies ? productionCookieName : developmentCookieName
    )
    if (!token) {
      return sendAuthError(reply, 401, authenticationRequired)
    }

    try {
      request.auth = await authService.getSession(token)
    } catch {
      logAuthFailure(request, 'session_lookup')
      return sendAuthError(reply, 500, { error: 'Authentication unavailable' })
    }

    if (!request.auth) {
      return sendAuthError(reply, 401, authenticationRequired)
    }
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  { authService, loginRateLimiter, secureCookies = false }: AuthRoutesOptions
): Promise<void> {
  const cookieName = secureCookies
    ? productionCookieName
    : developmentCookieName
  app.decorateRequest('auth', null)

  app.post('/auth/login', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!secureCookies && !isLoopbackAddress(request.ip)) {
      return sendAuthError(reply, 403, {
        error: 'Authentication is limited to localhost in development'
      })
    }
    if (!isAllowedOrigin(request, secureCookies)) {
      return sendAuthError(reply, 403, { error: 'Request origin not allowed' })
    }

    const parsed = loginRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendAuthError(reply, 400, { error: 'Invalid request' })
    }

    let retryAfter: number | null
    try {
      retryAfter = await loginRateLimiter.check(
        request.ip,
        parsed.data.loginIdentifier
      )
    } catch {
      logAuthFailure(request, 'login_rate_limit')
      return sendAuthError(reply, 503, {
        error: 'Authentication temporarily unavailable'
      })
    }
    if (retryAfter !== null) {
      reply.header('Retry-After', String(retryAfter))
      return sendAuthError(reply, 429, { error: 'Too many login attempts' })
    }

    try {
      const result = await authService.login(parsed.data)
      if (!result) {
        return sendAuthError(reply, 401, invalidCredentials)
      }

      reply.header(
        'Set-Cookie',
        cookieHeader(
          cookieName,
          result.token,
          secureCookies,
          sessionLifetimeSeconds,
          new Date(Date.now() + sessionLifetimeSeconds * 1000)
        )
      )
      return reply.send(currentUserResponseSchema.parse({ user: result.user }))
    } catch {
      logAuthFailure(request, 'login')
      return sendAuthError(reply, 500, { error: 'Authentication unavailable' })
    }
  })

  app.post('/auth/logout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!secureCookies && !isLoopbackAddress(request.ip)) {
      return sendAuthError(reply, 403, {
        error: 'Authentication is limited to localhost in development'
      })
    }
    if (!isAllowedOrigin(request, secureCookies)) {
      return sendAuthError(reply, 403, { error: 'Request origin not allowed' })
    }

    const token = readSessionToken(request.headers.cookie, cookieName)
    let revocationFailed = false
    try {
      if (token) {
        await authService.revokeSession(token)
      }
    } catch {
      logAuthFailure(request, 'logout')
      revocationFailed = true
    }

    reply.header(
      'Set-Cookie',
      cookieHeader(cookieName, '', secureCookies, 0, new Date(0))
    )
    if (revocationFailed) {
      return sendAuthError(reply, 500, { error: 'Authentication unavailable' })
    }
    return reply.code(204).send()
  })

  app.get(
    '/auth/me',
    { preHandler: createAuthenticationHook(authService, secureCookies) },
    async (request, reply) => {
      if (!request.auth) {
        return sendAuthError(reply, 401, authenticationRequired)
      }
      return reply.send(
        currentUserResponseSchema.parse({ user: request.auth.user })
      )
    }
  )
}

export { developmentCookieName, productionCookieName, readSessionToken }
