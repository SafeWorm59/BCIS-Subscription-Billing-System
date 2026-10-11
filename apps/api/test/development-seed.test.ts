import { describe, expect, it } from 'vitest'
import {
  assertDevelopmentDatabaseUrl,
  getDemoAdminCredentials
} from '../src/db/development-seed.js'

describe('development seed safeguards', () => {
  it('accepts only the local development database name', () => {
    expect(() =>
      assertDevelopmentDatabaseUrl(
        'postgresql://demo:placeholder@127.0.0.1:5432/bcis_db'
      )
    ).not.toThrow()
  })

  it('rejects the integration-test database', () => {
    expect(() =>
      assertDevelopmentDatabaseUrl(
        'postgresql://demo:placeholder@127.0.0.1:5432/bcis_subscription_billing_test'
      )
    ).toThrow('Development seed refuses the integration-test database')
  })

  it.each([
    'postgresql://demo:placeholder@127.0.0.1:5432/other_db',
    'postgresql://demo:placeholder@other-host:5432/bcis_db',
    'postgresql://demo:placeholder@127.0.0.1:5432/bcis_db?database=bcis_subscription_billing_test',
    'postgresql://demo:placeholder@127.0.0.1:5432/bcis_db?host=other-host',
    'not a database URL'
  ])('rejects any other database target', (databaseUrl) => {
    expect(() => assertDevelopmentDatabaseUrl(databaseUrl)).toThrow()
  })

  it('accepts localhost as a development database host', () => {
    expect(() =>
      assertDevelopmentDatabaseUrl(
        'postgresql://demo:placeholder@localhost:5432/bcis_db'
      )
    ).not.toThrow()
  })

  it('rejects non-PostgreSQL URLs', () => {
    expect(() =>
      assertDevelopmentDatabaseUrl('https://example.test/bcis_db')
    ).toThrow('Development seed requires a PostgreSQL DATABASE_URL')
  })

  it('requires explicit valid demo credentials and normalizes the email', () => {
    expect(
      getDemoAdminCredentials({
        BCIS_DEMO_ADMIN_EMAIL: ' Demo.Admin@Example.test ',
        BCIS_DEMO_ADMIN_PASSWORD: 'test-only-password'
      })
    ).toEqual({
      loginIdentifier: 'demo.admin@example.test',
      password: 'test-only-password'
    })
  })

  it('rejects missing or invalid demo credentials without including their values', () => {
    expect(() =>
      getDemoAdminCredentials({
        BCIS_DEMO_ADMIN_EMAIL: 'not-an-email',
        BCIS_DEMO_ADMIN_PASSWORD: 'test-only-password'
      })
    ).toThrow(
      'BCIS_DEMO_ADMIN_EMAIL must be a valid email and BCIS_DEMO_ADMIN_PASSWORD must be set'
    )
  })
})
