import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../db/schema.js'
import { loginRateLimitBuckets } from '../db/schema.js'

export interface LoginRateLimiter {
  check(ipAddress: string, loginIdentifier: string): Promise<number | null>
}

export interface LoginRateLimitOptions {
  maxAttempts?: number
  windowMs?: number
  now?: () => number
}

export interface RateLimitBucket {
  keyHash: string
  maximum: number
  windowStartedAt: Date
}

export interface LoginRateLimitStore {
  incrementBuckets(buckets: RateLimitBucket[]): Promise<number[]>
}

type Database = NodePgDatabase<typeof schema>

function hashBucketKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function createDatabaseLoginRateLimitStore(
  database: Database
): LoginRateLimitStore {
  return {
    async incrementBuckets(buckets) {
      return database.transaction(async (transaction) => {
        const windowStartedAt = buckets[0]?.windowStartedAt
        if (!windowStartedAt) {
          return []
        }

        await transaction
          .delete(loginRateLimitBuckets)
          .where(
            sql`${loginRateLimitBuckets.windowStartedAt} < ${windowStartedAt}`
          )

        const counts: number[] = []
        for (const bucket of buckets) {
          const [result] = await transaction
            .insert(loginRateLimitBuckets)
            .values({
              keyHash: bucket.keyHash,
              windowStartedAt: bucket.windowStartedAt,
              attemptCount: 1
            })
            .onConflictDoUpdate({
              target: loginRateLimitBuckets.keyHash,
              set: {
                windowStartedAt: sql`greatest(${loginRateLimitBuckets.windowStartedAt}, excluded.window_started_at)`,
                attemptCount: sql`case when ${loginRateLimitBuckets.windowStartedAt} = excluded.window_started_at then least(${loginRateLimitBuckets.attemptCount} + 1, ${bucket.maximum} + 1) when ${loginRateLimitBuckets.windowStartedAt} < excluded.window_started_at then 1 else ${loginRateLimitBuckets.attemptCount} end`,
                updatedAt: new Date()
              }
            })
            .returning({ attemptCount: loginRateLimitBuckets.attemptCount })

          counts.push(result?.attemptCount ?? 0)
        }
        return counts
      })
    }
  }
}

export function createLoginRateLimiter(
  store: LoginRateLimitStore,
  {
    maxAttempts = 5,
    windowMs = 15 * 60 * 1000,
    now = Date.now
  }: LoginRateLimitOptions = {}
): LoginRateLimiter {
  return {
    async check(ipAddress, loginIdentifier) {
      const timestamp = now()
      const windowStartedAt = new Date(
        Math.floor(timestamp / windowMs) * windowMs
      )
      const ipHash = hashBucketKey(`ip\0${ipAddress}`)
      const identifierHash = hashBucketKey(
        `identifier\0${ipAddress}\0${loginIdentifier}`
      )
      const buckets: RateLimitBucket[] = [
        { keyHash: ipHash, maximum: maxAttempts * 5, windowStartedAt },
        {
          keyHash: identifierHash,
          maximum: maxAttempts,
          windowStartedAt
        }
      ]

      const counts = await store.incrementBuckets(buckets)
      const isLimited = buckets.some(
        (bucket, index) => (counts[index] ?? 0) > bucket.maximum
      )
      if (!isLimited) {
        return null
      }

      const windowEnd = windowStartedAt.getTime() + windowMs
      return Math.max(1, Math.ceil((windowEnd - timestamp) / 1000))
    }
  }
}
