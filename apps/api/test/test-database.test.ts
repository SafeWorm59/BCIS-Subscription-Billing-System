import { describe, expect, it } from 'vitest'
import { getBcisTestDatabaseUrl } from '../src/db/test-database.js'

const approvedUrl =
  'postgresql://bcis_subscription_billing_test:temporary-password@127.0.0.1:5432/bcis_subscription_billing_test'

describe('integration database target validation', () => {
  it('requires the explicit integration connection variable', () => {
    expect(() =>
      getBcisTestDatabaseUrl({
        DATABASE_URL: approvedUrl
      })
    ).toThrow('BCIS_TEST_DATABASE_URL is required')
  })

  it('accepts only the fixed local integration database and role', () => {
    expect(
      getBcisTestDatabaseUrl({ BCIS_TEST_DATABASE_URL: approvedUrl })
    ).toBe(approvedUrl)
  })

  it.each([
    'postgresql://bcis_subscription_billing_test:temporary-password@127.0.0.1:5432/bcis_db',
    'postgresql://development_role:temporary-password@127.0.0.1:5432/bcis_subscription_billing_test',
    'postgresql://bcis_subscription_billing_test:temporary-password@example.com:5432/bcis_subscription_billing_test',
    'postgresql://bcis_subscription_billing_test:temporary-password@127.0.0.1:5432/bcis_subscription_billing_test?database=bcis_db',
    'postgresql://bcis_subscription_billing_test:temporary-password@127.0.0.1:5432/bcis_subscription_billing_test?user=development_role'
  ])('rejects unsafe target URLs without disclosing them', (databaseUrl) => {
    expect(() =>
      getBcisTestDatabaseUrl({ BCIS_TEST_DATABASE_URL: databaseUrl })
    ).toThrow()
  })
})
