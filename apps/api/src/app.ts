import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from 'fastify'
import type { HealthResponse } from '@bcis/shared'
import {
  checkDatabaseConnection,
  closeDatabaseConnection
} from './db/client.js'
import { createDatabaseAuthRepository } from './auth/repository.js'
import { registerAuthRoutes } from './auth/routes.js'
import { registerAdminRoutes } from './auth/admin-routes.js'
import {
  createDatabaseLoginRateLimitStore,
  createLoginRateLimiter,
  type LoginRateLimiter,
  type LoginRateLimitOptions
} from './auth/rate-limit.js'
import { createAuthService, type AuthService } from './auth/service.js'
import { env } from './config/env.js'
import { database } from './db/client.js'
import { registerBusinessRoutes } from './business/routes.js'
import { createBusinessRepository } from './business/repository.js'
import { registerBillingRoutes } from './billing/routes.js'
import { createBillingRepository } from './billing/repository.js'
import {
  createBillingServices,
  type BillingServices
} from './billing/service.js'
import {
  createBusinessServices,
  type BusinessServices
} from './business/service.js'

function redactSensitiveErrorText(value: string): string {
  return value
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(
      /\b(password|passwd|pwd)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[REDACTED]'
    )
}

function errorLogDetails(error: unknown): {
  errorName: string
  errorMessage: string
  errorStack: string
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: redactSensitiveErrorText(error.message),
      errorStack: redactSensitiveErrorText(error.stack ?? '')
    }
  }

  return {
    errorName: 'UnknownError',
    errorMessage: redactSensitiveErrorText(String(error)),
    errorStack: ''
  }
}

interface AppOptions {
  logger?: FastifyServerOptions['logger']
  databaseCheck?: () => Promise<void>
  closeDatabase?: () => Promise<void>
  authService?: AuthService
  loginRateLimiter?: LoginRateLimiter
  secureCookies?: boolean
  loginRateLimit?: LoginRateLimitOptions
  businessServices?: BusinessServices
  billingServices?: BillingServices
}

export function buildApp({
  logger = true,
  databaseCheck = checkDatabaseConnection,
  closeDatabase = closeDatabaseConnection,
  authService = createAuthService(createDatabaseAuthRepository(database)),
  loginRateLimiter,
  secureCookies = env.NODE_ENV === 'production',
  loginRateLimit,
  businessServices = createBusinessServices(createBusinessRepository(database)),
  billingServices = createBillingServices(createBillingRepository(database))
}: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger })
  const rateLimiter =
    loginRateLimiter ??
    createLoginRateLimiter(
      createDatabaseLoginRateLimitStore(database),
      loginRateLimit
    )

  app.addHook('onClose', closeDatabase)
  app.addHook('onReady', async () => authService.initialize())
  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      { requestId: request.id, ...errorLogDetails(error) },
      'Request failed'
    )
    const statusCode =
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
        ? error.statusCode
        : 500

    return reply.status(statusCode).send({
      error:
        statusCode === 500
          ? 'Internal Server Error'
          : error instanceof Error
            ? error.message
            : 'Request failed'
    })
  })

  app.register(
    async (routes) => {
      routes.get<{ Reply: HealthResponse }>(
        '/health',
        async (_request, reply) => reply.send({ status: 'healthy' })
      )

      routes.get('/health/database', async (_request, reply) => {
        try {
          await databaseCheck()
          return reply.send({ status: 'connected' })
        } catch {
          app.log.error('Database connectivity check failed')
          return reply.status(503).send({ status: 'unavailable' })
        }
      })

      await registerAuthRoutes(routes, {
        authService,
        loginRateLimiter: rateLimiter,
        secureCookies
      })
      await registerAdminRoutes(routes, authService, secureCookies)
      await registerBusinessRoutes(routes, {
        services: businessServices,
        authService,
        secureCookies
      })
      await registerBillingRoutes(routes, {
        services: billingServices,
        authService,
        secureCookies
      })
    },
    { prefix: '/api/v1' }
  )

  return app
}
