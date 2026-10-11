import {
  entityListQuerySchema,
  planCreateSchema,
  planListQuerySchema,
  planListResponseSchema,
  planSchema,
  planUpdateSchema,
  serviceAccountCreateSchema,
  serviceAccountListQuerySchema,
  serviceAccountListResponseSchema,
  serviceAccountSchema,
  serviceAccountUpdateSchema,
  subscriberCreateSchema,
  subscriberListResponseSchema,
  subscriberSchema,
  subscriberUpdateSchema
} from '@bcis/shared'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createAuthenticationHook, requirePermission } from '../auth/routes.js'
import type { AuthService } from '../auth/service.js'
import { BusinessError } from './errors.js'
import type { BusinessServices } from './service.js'

const idParamsSchema = z.object({ id: z.uuid() }).strict()

async function respond<T>(
  reply: FastifyReply,
  action: () => Promise<T>
): Promise<T | FastifyReply> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof BusinessError) {
      return reply.status(error.statusCode).send({ error: error.message })
    }
    throw error
  }
}

function invalid(reply: FastifyReply): FastifyReply {
  return reply.status(400).send({ error: 'Invalid request' })
}

export async function registerBusinessRoutes(
  app: FastifyInstance,
  {
    services,
    authService,
    secureCookies = false
  }: {
    services: BusinessServices
    authService: AuthService
    secureCookies?: boolean
  }
): Promise<void> {
  const authenticate = createAuthenticationHook(authService, secureCookies)

  app.get(
    '/plans',
    { preHandler: [authenticate, requirePermission('plans.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = planListQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        const result = await services.plans.list(parsed.data)
        return reply.send(
          planListResponseSchema.parse({
            ...result,
            page: parsed.data.page,
            limit: parsed.data.limit
          })
        )
      })
  )
  app.get(
    '/plans/:id',
    { preHandler: [authenticate, requirePermission('plans.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        return reply.send(
          planSchema.parse(await services.plans.get(parsed.data.id))
        )
      })
  )
  app.post(
    '/plans',
    { preHandler: [authenticate, requirePermission('plans.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = planCreateSchema.safeParse(request.body)
        if (!parsed.success) return invalid(reply)
        return reply
          .status(201)
          .send(planSchema.parse(await services.plans.create(parsed.data)))
      })
  )
  app.patch(
    '/plans/:id',
    { preHandler: [authenticate, requirePermission('plans.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const params = idParamsSchema.safeParse(request.params)
        const body = planUpdateSchema.safeParse(request.body)
        if (!params.success || !body.success) return invalid(reply)
        return reply.send(
          planSchema.parse(
            await services.plans.update(params.data.id, body.data)
          )
        )
      })
  )
  app.delete(
    '/plans/:id',
    { preHandler: [authenticate, requirePermission('plans.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        await services.plans.delete(parsed.data.id)
        return reply.code(204).send()
      })
  )

  app.get(
    '/subscribers',
    { preHandler: [authenticate, requirePermission('subscribers.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = entityListQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        const result = await services.subscribers.list(parsed.data)
        return reply.send(
          subscriberListResponseSchema.parse({
            ...result,
            page: parsed.data.page,
            limit: parsed.data.limit
          })
        )
      })
  )
  app.get(
    '/subscribers/:id',
    { preHandler: [authenticate, requirePermission('subscribers.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        return reply.send(
          subscriberSchema.parse(await services.subscribers.get(parsed.data.id))
        )
      })
  )
  app.post(
    '/subscribers',
    { preHandler: [authenticate, requirePermission('subscribers.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = subscriberCreateSchema.safeParse(request.body)
        if (!parsed.success) return invalid(reply)
        return reply
          .status(201)
          .send(
            subscriberSchema.parse(
              await services.subscribers.create(parsed.data)
            )
          )
      })
  )
  app.patch(
    '/subscribers/:id',
    { preHandler: [authenticate, requirePermission('subscribers.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const params = idParamsSchema.safeParse(request.params)
        const body = subscriberUpdateSchema.safeParse(request.body)
        if (!params.success || !body.success) return invalid(reply)
        return reply.send(
          subscriberSchema.parse(
            await services.subscribers.update(params.data.id, body.data)
          )
        )
      })
  )
  app.delete(
    '/subscribers/:id',
    { preHandler: [authenticate, requirePermission('subscribers.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        await services.subscribers.delete(parsed.data.id)
        return reply.code(204).send()
      })
  )

  app.get(
    '/service-accounts',
    {
      preHandler: [authenticate, requirePermission('service_accounts.read')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = serviceAccountListQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        const result = await services.serviceAccounts.list(parsed.data)
        return reply.send(
          serviceAccountListResponseSchema.parse({
            ...result,
            page: parsed.data.page,
            limit: parsed.data.limit
          })
        )
      })
  )
  app.get(
    '/service-accounts/:id',
    {
      preHandler: [authenticate, requirePermission('service_accounts.read')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        return reply.send(
          serviceAccountSchema.parse(
            await services.serviceAccounts.get(parsed.data.id)
          )
        )
      })
  )
  app.post(
    '/service-accounts',
    {
      preHandler: [authenticate, requirePermission('service_accounts.manage')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = serviceAccountCreateSchema.safeParse(request.body)
        if (!parsed.success) return invalid(reply)
        return reply
          .status(201)
          .send(
            serviceAccountSchema.parse(
              await services.serviceAccounts.create(parsed.data)
            )
          )
      })
  )
  app.patch(
    '/service-accounts/:id',
    {
      preHandler: [authenticate, requirePermission('service_accounts.manage')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const params = idParamsSchema.safeParse(request.params)
        const body = serviceAccountUpdateSchema.safeParse(request.body)
        if (!params.success || !body.success) return invalid(reply)
        return reply.send(
          serviceAccountSchema.parse(
            await services.serviceAccounts.update(params.data.id, body.data)
          )
        )
      })
  )
  app.delete(
    '/service-accounts/:id',
    {
      preHandler: [authenticate, requirePermission('service_accounts.manage')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        await services.serviceAccounts.delete(parsed.data.id)
        return reply.code(204).send()
      })
  )
}
