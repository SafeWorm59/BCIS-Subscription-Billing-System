import {
  billingSummaryQuerySchema,
  billingSummarySchema,
  invoiceGenerateSchema,
  invoiceListQuerySchema,
  invoiceListResponseSchema,
  invoiceSchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentSchema
} from '@bcis/shared'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createAuthenticationHook, requirePermission } from '../auth/routes.js'
import type { AuthService } from '../auth/service.js'
import { BusinessError } from '../business/errors.js'
import type { BillingServices } from './service.js'

const idParamsSchema = z.object({ id: z.uuid() }).strict()

async function respond<T>(reply: FastifyReply, action: () => Promise<T>) {
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

export async function registerBillingRoutes(
  app: FastifyInstance,
  {
    services,
    authService,
    secureCookies = false
  }: {
    services: BillingServices
    authService: AuthService
    secureCookies?: boolean
  }
): Promise<void> {
  const authenticate = createAuthenticationHook(authService, secureCookies)

  app.get(
    '/payments',
    {
      preHandler: [authenticate, requirePermission('invoices.read')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = paymentListQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        const result = await services.listPaymentsPage(parsed.data)
        return reply.send(
          paymentListResponseSchema.parse({
            ...result,
            page: parsed.data.page,
            limit: parsed.data.limit
          })
        )
      })
  )

  app.get(
    '/invoices',
    { preHandler: [authenticate, requirePermission('invoices.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = invoiceListQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        const result = await services.list(parsed.data)
        return reply.send(
          invoiceListResponseSchema.parse({
            ...result,
            page: parsed.data.page,
            limit: parsed.data.limit
          })
        )
      })
  )

  app.get(
    '/invoices/:id',
    { preHandler: [authenticate, requirePermission('invoices.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        return reply.send(
          invoiceSchema.parse(await services.get(parsed.data.id))
        )
      })
  )

  app.get(
    '/invoices/:id/payments',
    {
      preHandler: [authenticate, requirePermission('invoices.read')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = idParamsSchema.safeParse(request.params)
        if (!parsed.success) return invalid(reply)
        await services.get(parsed.data.id)
        return reply.send(
          z
            .array(paymentSchema)
            .parse(await services.listPayments(parsed.data.id))
        )
      })
  )

  app.post(
    '/invoices/:id/payments',
    {
      preHandler: [authenticate, requirePermission('invoices.manage')]
    },
    async (request, reply) =>
      respond(reply, async () => {
        const params = idParamsSchema.safeParse(request.params)
        const body = paymentCreateSchema.safeParse(request.body)
        if (!params.success || !body.success) return invalid(reply)
        return reply
          .status(201)
          .send(
            paymentSchema.parse(
              await services.recordPayment(params.data.id, body.data)
            )
          )
      })
  )

  app.post(
    '/invoices/generate',
    { preHandler: [authenticate, requirePermission('invoices.manage')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = invoiceGenerateSchema.safeParse(request.body)
        if (!parsed.success) return invalid(reply)
        return reply
          .status(201)
          .send(invoiceSchema.parse(await services.generate(parsed.data)))
      })
  )

  app.get(
    '/billing/summary',
    { preHandler: [authenticate, requirePermission('invoices.read')] },
    async (request, reply) =>
      respond(reply, async () => {
        const parsed = billingSummaryQuerySchema.safeParse(request.query)
        if (!parsed.success) return invalid(reply)
        return reply.send(
          billingSummarySchema.parse(await services.summary(parsed.data))
        )
      })
  )
}
