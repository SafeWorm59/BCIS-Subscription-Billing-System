import { z } from 'zod'

const developmentDatabaseName = 'bcis_db'
const integrationTestDatabaseName = 'bcis_subscription_billing_test'
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const allowedDatabaseUrlParameters = new Set([
  'application_name',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert'
])

const demoAdminCredentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024)
})

export interface DemoAdminCredentials {
  loginIdentifier: string
  password: string
}

export function getDemoAdminCredentials(
  environment: NodeJS.ProcessEnv = process.env
): DemoAdminCredentials {
  const parsed = demoAdminCredentialsSchema.safeParse({
    email: environment.BCIS_DEMO_ADMIN_EMAIL,
    password: environment.BCIS_DEMO_ADMIN_PASSWORD
  })

  if (!parsed.success) {
    throw new Error(
      'BCIS_DEMO_ADMIN_EMAIL must be a valid email and BCIS_DEMO_ADMIN_PASSWORD must be set'
    )
  }

  return {
    loginIdentifier: parsed.data.email.toLowerCase(),
    password: parsed.data.password
  }
}

export function assertDevelopmentDatabaseUrl(databaseUrl: string): void {
  let parsedUrl: URL
  let databaseName: string

  try {
    parsedUrl = new URL(databaseUrl)
    databaseName = decodeURIComponent(parsedUrl.pathname.slice(1))
  } catch {
    throw new Error('Development seed requires a valid DATABASE_URL')
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('Development seed requires a PostgreSQL DATABASE_URL')
  }

  if (databaseName === integrationTestDatabaseName) {
    throw new Error('Development seed refuses the integration-test database')
  }

  if (
    databaseName !== developmentDatabaseName ||
    !localDatabaseHosts.has(parsedUrl.hostname) ||
    [...parsedUrl.searchParams.keys()].some(
      (parameter) => !allowedDatabaseUrlParameters.has(parameter)
    )
  ) {
    throw new Error(
      'Development seed may only target the local bcis_db database'
    )
  }
}
