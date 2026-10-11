import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.DATABASE_URL ??=
    'postgresql://bcis_app:placeholder@127.0.0.1:5432/bcis_db'
  const { buildApp } = await import('../src/app.js')
  app = buildApp({
    logger: false,
    databaseCheck: async () => {
      throw new Error('Database check intentionally unavailable in this test')
    }
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('health routes', () => {
  it('returns application health without requiring a database connection', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'healthy' })
  })

  it('reports database connectivity separately', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/database'
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'unavailable' })
  })
}, 30000)
