const expectedTestDatabase = 'bcis_subscription_billing_test'
const expectedTestRole = 'bcis_subscription_billing_test'
const expectedTestHost = '127.0.0.1'
const allowedQueryParameters = new Set([
  'application_name',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert'
])

export function getBcisTestDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const databaseUrl = environment.BCIS_TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('BCIS_TEST_DATABASE_URL is required')
  }

  let parsedUrl: URL
  let databaseName: string
  let roleName: string
  try {
    parsedUrl = new URL(databaseUrl)
    databaseName = decodeURIComponent(parsedUrl.pathname.slice(1))
    roleName = decodeURIComponent(parsedUrl.username)
  } catch {
    throw new Error('BCIS_TEST_DATABASE_URL must be a valid PostgreSQL URL')
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    parsedUrl.hostname !== expectedTestHost ||
    !parsedUrl.port ||
    !parsedUrl.password ||
    databaseName !== expectedTestDatabase ||
    roleName !== expectedTestRole ||
    [...parsedUrl.searchParams.keys()].some(
      (parameter) => !allowedQueryParameters.has(parameter)
    )
  ) {
    throw new Error(
      'BCIS_TEST_DATABASE_URL must target the approved local integration database and role'
    )
  }

  return databaseUrl
}
