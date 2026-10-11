import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { serviceAccountStatusSchema } from '@bcis/shared'
import type {
  EntityListQuery,
  Plan,
  PlanCreate,
  PlanListQuery,
  PlanUpdate,
  ServiceAccount,
  ServiceAccountCreate,
  ServiceAccountListQuery,
  ServiceAccountUpdate,
  Subscriber,
  SubscriberCreate,
  SubscriberUpdate
} from '@bcis/shared'
import * as schema from '../db/schema.js'
import { plans, serviceAccounts, subscribers } from '../db/schema.js'
import { BusinessError, translateDatabaseError } from './errors.js'

type Database = NodePgDatabase<typeof schema>

export interface BusinessRepository {
  listPlans(query: PlanListQuery): Promise<{ items: Plan[]; total: number }>
  getPlan(id: string): Promise<Plan | null>
  createPlan(input: PlanCreate): Promise<Plan>
  updatePlan(id: string, input: PlanUpdate): Promise<Plan | null>
  deletePlan(id: string): Promise<boolean>
  listSubscribers(
    query: EntityListQuery
  ): Promise<{ items: Subscriber[]; total: number }>
  getSubscriber(id: string): Promise<Subscriber | null>
  createSubscriber(input: SubscriberCreate): Promise<Subscriber>
  updateSubscriber(
    id: string,
    input: SubscriberUpdate
  ): Promise<Subscriber | null>
  deleteSubscriber(id: string): Promise<boolean>
  listServiceAccounts(
    query: ServiceAccountListQuery
  ): Promise<{ items: ServiceAccount[]; total: number }>
  getServiceAccount(id: string): Promise<ServiceAccount | null>
  createServiceAccount(input: ServiceAccountCreate): Promise<ServiceAccount>
  updateServiceAccount(
    id: string,
    input: ServiceAccountUpdate
  ): Promise<ServiceAccount | null>
  deleteServiceAccount(id: string): Promise<boolean>
}

function toPlan(row: typeof plans.$inferSelect): Plan {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function toSubscriber(row: typeof subscribers.$inferSelect): Subscriber {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function toServiceAccount(
  row: typeof serviceAccounts.$inferSelect
): ServiceAccount {
  return {
    ...row,
    status: serviceAccountStatusSchema.parse(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function searchTerm(value: string): string {
  return `${value.replace(/[\\%_]/g, '\\$&')}%`
}

async function persist<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    const translated = translateDatabaseError(error)
    if (translated) {
      throw translated
    }
    throw error
  }
}

export function createBusinessRepository(
  database: Database
): BusinessRepository {
  return {
    async listPlans(query) {
      const filters: SQL[] = []
      if (query.q) {
        const term = searchTerm(query.q)
        filters.push(
          or(ilike(plans.name, term), ilike(plans.description, term))!
        )
      }
      if (query.enabled !== undefined) {
        filters.push(eq(plans.enabled, query.enabled === 'true'))
      }
      const where = filters.length ? and(...filters) : undefined
      const [rows, [totalRow]] = await Promise.all([
        database
          .select()
          .from(plans)
          .where(where)
          .orderBy(asc(plans.name), asc(plans.id))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        database.select({ total: count() }).from(plans).where(where)
      ])
      return { items: rows.map(toPlan), total: totalRow?.total ?? 0 }
    },

    async getPlan(id) {
      const [row] = await database.select().from(plans).where(eq(plans.id, id))
      return row ? toPlan(row) : null
    },

    async createPlan(input) {
      const [row] = await database.insert(plans).values(input).returning()
      if (!row) throw new Error('Plan insert returned no row')
      return toPlan(row)
    },

    async updatePlan(id, input) {
      const [row] = await database
        .update(plans)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(plans.id, id))
        .returning()
      return row ? toPlan(row) : null
    },

    async deletePlan(id) {
      return persist(
        async () =>
          (
            await database
              .delete(plans)
              .where(eq(plans.id, id))
              .returning({ id: plans.id })
          ).length > 0
      )
    },

    async listSubscribers(query) {
      const filters: SQL[] = []
      if (query.q) {
        const term = searchTerm(query.q)
        filters.push(
          or(
            ilike(subscribers.name, term),
            ilike(subscribers.email, term),
            ilike(subscribers.phone, term)
          )!
        )
      }
      const where = filters.length ? and(...filters) : undefined
      const [rows, [totalRow]] = await Promise.all([
        database
          .select()
          .from(subscribers)
          .where(where)
          .orderBy(asc(subscribers.name), asc(subscribers.id))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        database.select({ total: count() }).from(subscribers).where(where)
      ])
      return { items: rows.map(toSubscriber), total: totalRow?.total ?? 0 }
    },

    async getSubscriber(id) {
      const [row] = await database
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, id))
      return row ? toSubscriber(row) : null
    },

    async createSubscriber(input) {
      const [row] = await database.insert(subscribers).values(input).returning()
      if (!row) throw new Error('Subscriber insert returned no row')
      return toSubscriber(row)
    },

    async updateSubscriber(id, input) {
      const [row] = await database
        .update(subscribers)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(subscribers.id, id))
        .returning()
      return row ? toSubscriber(row) : null
    },

    async deleteSubscriber(id) {
      return persist(
        async () =>
          (
            await database
              .delete(subscribers)
              .where(eq(subscribers.id, id))
              .returning({ id: subscribers.id })
          ).length > 0
      )
    },

    async listServiceAccounts(query) {
      const filters: SQL[] = []
      if (query.q) {
        filters.push(
          ilike(serviceAccounts.accountIdentifier, searchTerm(query.q))
        )
      }
      if (query.status) filters.push(eq(serviceAccounts.status, query.status))
      if (query.subscriberId) {
        filters.push(eq(serviceAccounts.subscriberId, query.subscriberId))
      }
      if (query.planId) filters.push(eq(serviceAccounts.planId, query.planId))
      const where = filters.length ? and(...filters) : undefined
      const [rows, [totalRow]] = await Promise.all([
        database
          .select()
          .from(serviceAccounts)
          .where(where)
          .orderBy(asc(serviceAccounts.accountIdentifier))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit),
        database.select({ total: count() }).from(serviceAccounts).where(where)
      ])
      return {
        items: rows.map(toServiceAccount),
        total: totalRow?.total ?? 0
      }
    },

    async getServiceAccount(id) {
      const [row] = await database
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, id))
      return row ? toServiceAccount(row) : null
    },

    async createServiceAccount(input) {
      return persist(async () => {
        const [row] = await database
          .insert(serviceAccounts)
          .values(input)
          .returning()
        if (!row) throw new Error('Service-account insert returned no row')
        return toServiceAccount(row)
      })
    },

    async updateServiceAccount(id, input) {
      return persist(async () => {
        const [row] = await database
          .update(serviceAccounts)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(serviceAccounts.id, id))
          .returning()
        return row ? toServiceAccount(row) : null
      })
    },

    async deleteServiceAccount(id) {
      return persist(
        async () =>
          (
            await database
              .delete(serviceAccounts)
              .where(eq(serviceAccounts.id, id))
              .returning({ id: serviceAccounts.id })
          ).length > 0
      )
    }
  }
}

export function assertRecordFound<T>(record: T | null, entity: string): T {
  if (!record) {
    throw new BusinessError(`${entity} not found`, 404)
  }
  return record
}
