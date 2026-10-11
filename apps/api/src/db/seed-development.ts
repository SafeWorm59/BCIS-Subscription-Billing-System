import { eq, inArray } from 'drizzle-orm'
import { roleNames, type PermissionKey } from '@bcis/shared'
import { hashPassword } from '../auth/password.js'
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users
} from './schema.js'
import {
  assertDevelopmentDatabaseUrl,
  getDemoAdminCredentials
} from './development-seed.js'

const phaseThreePermissionKeys = [
  'users.read',
  'users.manage',
  'roles.manage',
  'permissions.manage',
  'plans.read',
  'plans.manage',
  'subscribers.read',
  'subscribers.manage',
  'service_accounts.read',
  'service_accounts.manage',
  'invoices.read',
  'invoices.manage'
] as const satisfies readonly PermissionKey[]

async function seedDevelopmentDatabase(): Promise<void> {
  const demoAdmin = getDemoAdminCredentials()
  const { env } = await import('../config/env.js')
  assertDevelopmentDatabaseUrl(env.DATABASE_URL)

  const { database, closeDatabaseConnection } = await import('./client.js')

  try {
    await database.transaction(async (transaction) => {
      await transaction
        .insert(roles)
        .values(roleNames.map((name) => ({ name })))
        .onConflictDoNothing({ target: roles.name })

      await transaction
        .insert(permissions)
        .values(phaseThreePermissionKeys.map((key) => ({ key })))
        .onConflictDoNothing({ target: permissions.key })

      const [administratorRole] = await transaction
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'Administrator'))
        .limit(1)

      if (!administratorRole) {
        throw new Error('Administrator role was not available after insertion')
      }

      const permissionRows = await transaction
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, phaseThreePermissionKeys))

      if (permissionRows.length !== phaseThreePermissionKeys.length) {
        throw new Error(
          'Phase 3 permissions were not available after insertion'
        )
      }

      await transaction
        .insert(rolePermissions)
        .values(
          permissionRows.map(({ id }) => ({
            roleId: administratorRole.id,
            permissionId: id
          }))
        )
        .onConflictDoNothing()

      const [existingUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.loginIdentifier, demoAdmin.loginIdentifier))
        .limit(1)

      let demoUserId = existingUser?.id

      if (!demoUserId) {
        const passwordHash = await hashPassword(demoAdmin.password)
        const [insertedUser] = await transaction
          .insert(users)
          .values({
            loginIdentifier: demoAdmin.loginIdentifier,
            passwordHash
          })
          .onConflictDoNothing({ target: users.loginIdentifier })
          .returning({ id: users.id })

        demoUserId = insertedUser?.id
      }

      if (!demoUserId) {
        const [concurrentUser] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.loginIdentifier, demoAdmin.loginIdentifier))
          .limit(1)

        demoUserId = concurrentUser?.id
      }

      if (!demoUserId) {
        throw new Error(
          'Demo Administrator user was not available after insertion'
        )
      }

      await transaction
        .insert(userRoles)
        .values({ userId: demoUserId, roleId: administratorRole.id })
        .onConflictDoNothing()
    })
  } finally {
    await closeDatabaseConnection()
  }
}

try {
  await seedDevelopmentDatabase()
  console.log('Development seed completed for bcis_db.')
} catch (error) {
  if (error instanceof Error && error.message.startsWith('BCIS_DEMO_ADMIN_')) {
    console.error(error.message)
  } else if (
    error instanceof Error &&
    error.message.startsWith('Development seed')
  ) {
    console.error(error.message)
  } else {
    console.error(
      'Development seed failed. Check that DATABASE_URL targets bcis_db and that migrations are applied. Error details are withheld to avoid exposing configuration or credentials.'
    )
  }
  process.exitCode = 1
}
